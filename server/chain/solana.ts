/**
 * Live Solana adapter: claims the coin's pump.fun creator fees into the dev
 * wallet and pays winners from it.
 *
 * Two ways the fees can reach the dev wallet, detected automatically:
 *  - creator:  the dev wallet created the coin (or is its current creator).
 *              The server sweeps the curve/pool fee buckets into the creator
 *              vaults and collects both vaults (bonding curve + PumpSwap).
 *  - sharing:  the coin uses pump.fun creator-fee sharing and the dev wallet
 *              is a shareholder. The server triggers the (permissionless)
 *              distribution, which pays every shareholder their split.
 *
 * Uses the official @pump-fun/pump-sdk. It is loaded through require()
 * because its ES-module build trips over a named import in one of its
 * dependencies under Node.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import type { ChainAdapter, ChainStatus, Transfer } from './types';

const require = createRequire(import.meta.url);
const web3 = require('@solana/web3.js') as typeof import('@solana/web3.js');
const pump = require('@pump-fun/pump-sdk') as typeof import('@pump-fun/pump-sdk');
const spl = require('@solana/spl-token') as typeof import('@solana/spl-token');
const bs58 = (require('bs58') as { default?: typeof import('bs58').default } & typeof import('bs58').default);
const b58 = bs58.default ?? bs58;

type PublicKey = import('@solana/web3.js').PublicKey;
type Keypair = import('@solana/web3.js').Keypair;
type Connection = import('@solana/web3.js').Connection;
type TransactionInstruction = import('@solana/web3.js').TransactionInstruction;

const MEMO_PROGRAM = new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export interface SolanaOptions {
  rpcUrl: string;
  wsUrl?: string;
  secret: string;
  mint: string;
  priorityFeeMicroLamports: number;
  log: (msg: string) => void;
}

export function parseSecretKey(secret: string): Keypair {
  let raw = secret.trim();
  if ((raw.startsWith('/') || raw.startsWith('./') || raw.endsWith('.json')) && existsSync(raw)) raw = readFileSync(raw, 'utf8').trim();
  let bytes: Uint8Array;
  if (raw.startsWith('[')) bytes = Uint8Array.from(JSON.parse(raw) as number[]);
  else bytes = b58.decode(raw);
  if (bytes.length !== 64) throw new Error('DEV_WALLET_SECRET_KEY must be a 64-byte secret key (base58 string, JSON array, or path to a keypair .json file)');
  return web3.Keypair.fromSecretKey(bytes);
}

export class SolanaChain implements ChainAdapter {
  readonly mode = 'live' as const;
  readonly conn: Connection;
  readonly kp: Keypair;
  readonly mint: PublicKey;
  private sdk: InstanceType<typeof pump.OnlinePumpSdk>;
  private route: 'creator' | 'sharing' = 'creator';
  private shareBps = 10000;
  private graduated = false;
  private quoteMint: PublicKey = spl.NATIVE_MINT;
  private canDistribute = false;
  private notes: string[] = [];
  private subs: number[] = [];

  constructor(private opts: SolanaOptions) {
    this.conn = new web3.Connection(opts.rpcUrl, { commitment: 'confirmed', wsEndpoint: opts.wsUrl || undefined });
    this.kp = parseSecretKey(opts.secret);
    this.mint = new web3.PublicKey(opts.mint);
    this.sdk = new pump.OnlinePumpSdk(this.conn);
  }

  get dev() {
    return this.kp.publicKey;
  }

  async init(): Promise<ChainStatus> {
    const curve = await this.fetchCurve();
    if (!curve) throw new Error(`No pump.fun bonding curve found for TOKEN_MINT ${this.mint.toBase58()}. Is the mint right, and is SOLANA_RPC_URL on the right cluster?`);
    if (!pump.isSolLikeQuoteMint(curve.quoteMint)) throw new Error('This coin is quoted in a token other than SOL; only SOL-quoted coins are supported.');
    if (curve.isHolderReward) throw new Error('This is a holder-reward coin: its creator fees go to holders, so there is nothing for the dev wallet to claim.');
    this.quoteMint = curve.quoteMint;
    this.graduated = curve.complete;

    if (pump.hasCoinCreatorMigratedToSharingConfig({ mint: this.mint, creator: curve.creator })) {
      this.route = 'sharing';
      const info = await this.conn.getAccountInfo(pump.feeSharingConfigPda(this.mint));
      if (!info) throw new Error('The coin points to a fee-sharing config that could not be read.');
      const sc = pump.PUMP_SDK.decodeSharingConfig(info);
      const me = sc.shareholders.find((s) => s.address.equals(this.dev));
      if (!me || me.shareBps <= 0)
        throw new Error(`Fee sharing is on for this coin, but the dev wallet ${this.dev.toBase58()} is not one of its shareholders. Add it on pump.fun (fee sharing can only be changed once) or use a shareholder wallet.`);
      this.shareBps = me.shareBps;
      this.notes.push(`Fee sharing: the dev wallet receives ${(me.shareBps / 100).toFixed(2)}% of each distribution.`);
    } else {
      this.route = 'creator';
      if (!curve.creator.equals(this.dev))
        throw new Error(`The dev wallet ${this.dev.toBase58()} is not this coin's creator (${curve.creator.toBase58()}). Use the creator wallet, or set up pump.fun fee sharing to the dev wallet.`);
    }
    if (this.graduated) this.notes.push('Coin has graduated to PumpSwap; fees are collected from both vaults.');

    for (const pk of this.watchAccounts()) {
      try {
        this.subs.push(this.conn.onAccountChange(pk, () => this.activity.forEach((cb) => cb()), { commitment: 'confirmed' }));
      } catch (e) {
        this.opts.log(`Could not subscribe to ${pk.toBase58()} (${(e as Error).message}); falling back to polling only.`);
      }
    }
    return this.status();
  }

  status(): ChainStatus {
    return { mode: 'live', feeRoute: this.route, devWallet: this.dev.toBase58(), mint: this.mint.toBase58(), graduated: this.graduated, shareBps: this.shareBps, notes: [...this.notes] };
  }

  private watchAccounts(): PublicKey[] {
    const list = [pump.bondingCurvePda(this.mint)];
    if (this.route === 'creator') list.push(pump.creatorVaultPda(this.dev));
    else list.push(pump.creatorVaultPda(pump.feeSharingConfigPda(this.mint)));
    if (this.graduated) list.push(pump.canonicalPumpPoolPdaWithQuote(this.mint, spl.NATIVE_MINT));
    return list;
  }

  private async fetchCurve() {
    const info = await this.conn.getAccountInfo(pump.bondingCurvePda(this.mint));
    return info ? pump.PUMP_SDK.decodeBondingCurveNullable(info) : null;
  }

  /** Curve + pool fee buckets that a sweep would move into the creator vaults. */
  private async buckets() {
    const [curveInfo, poolInfo] = await this.conn.getMultipleAccountsInfo([pump.bondingCurvePda(this.mint), pump.canonicalPumpPoolPdaWithQuote(this.mint, spl.NATIVE_MINT)]);
    const curve = curveInfo ? pump.PUMP_SDK.decodeBondingCurveNullable(curveInfo) : null;
    if (curve) this.graduated = curve.complete;
    let poolCreator: PublicKey | null = null;
    let poolFees = 0n;
    if (poolInfo && poolInfo.data.length >= 243) {
      poolCreator = new web3.PublicKey(poolInfo.data.subarray(211, 243));
      if (poolInfo.data.length >= 287) poolFees = poolInfo.data.readBigUInt64LE(279);
    }
    return { curve, poolCreator, poolFees };
  }

  async pendingFees() {
    if (this.route === 'sharing') {
      const r = await this.sdk.getMinimumDistributableFee(this.mint, this.dev);
      this.canDistribute = r.canDistribute;
      return Math.floor((Number(r.distributableFees.toString()) * this.shareBps) / 10000);
    }
    const [vault, b] = await Promise.all([this.sdk.getCreatorVaultBalanceBothPrograms(this.dev), this.buckets()]);
    let total = Number(vault.toString());
    if (b.curve && b.curve.creator.equals(this.dev)) total += Number(b.curve.creatorFee.toString());
    if (b.poolCreator && b.poolCreator.equals(this.dev)) total += Number(b.poolFees);
    return total;
  }

  private budget(units: number): TransactionInstruction[] {
    const ixs = [web3.ComputeBudgetProgram.setComputeUnitLimit({ units })];
    if (this.opts.priorityFeeMicroLamports > 0) ixs.push(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.opts.priorityFeeMicroLamports }));
    return ixs;
  }

  async claimInstructions(): Promise<TransactionInstruction[] | null> {
    if (this.route === 'sharing') {
      if (!this.canDistribute) return null;
      const { instructions } = await this.sdk.buildDistributeCreatorFeesInstructions(this.mint, { payer: this.dev });
      return [...this.budget(600_000), ...instructions];
    }
    const b = await this.buckets();
    const ixs = this.budget(400_000);
    if (b.curve && b.curve.creator.equals(this.dev) && !b.curve.creatorFee.isZero())
      ixs.push(await pump.PUMP_SDK.sweepCreatorFeeInstruction({ payer: this.dev, mint: this.mint, creator: this.dev, quoteMint: this.quoteMint }));
    if (b.poolCreator && b.poolCreator.equals(this.dev) && b.poolFees > 0n)
      ixs.push(await pump.PUMP_SDK.sweepPoolCreatorFeeInstruction({ payer: this.dev, mint: this.mint, coinCreator: this.dev, quoteMint: this.quoteMint }));
    ixs.push(...(await this.sdk.collectCoinCreatorFeeInstructions(this.dev, this.dev)));
    return ixs;
  }

  /** Builds the claim transaction and runs it in simulation only (used by `npm run server:check`). */
  async simulateClaim() {
    const ixs = await this.claimInstructions();
    if (!ixs) return { ok: false, logs: ['Nothing distributable yet (below pump.fun minimum).'] };
    const { blockhash } = await this.conn.getLatestBlockhash('confirmed');
    const tx = new web3.Transaction({ feePayer: this.dev, recentBlockhash: blockhash }).add(...ixs);
    tx.sign(this.kp);
    const sim = await this.conn.simulateTransaction(tx);
    return { ok: !sim.value.err, logs: sim.value.logs ?? [], err: sim.value.err };
  }

  async claimFees() {
    const ixs = await this.claimInstructions();
    if (!ixs) return null;
    const { signature } = await this.sendAndConfirm(ixs);
    const lamports = await this.walletDelta(signature);
    return { lamports, signature };
  }

  /** Dev wallet balance change in a confirmed transaction, fee added back. */
  private async walletDelta(signature: string) {
    for (let i = 0; i < 6; i++) {
      const tx = await this.conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (tx?.meta) return Math.max(0, tx.meta.postBalances[0] - tx.meta.preBalances[0] + tx.meta.fee);
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`Claim ${signature} confirmed but its details could not be read; check it on an explorer.`);
  }

  async walletBalance() {
    return this.conn.getBalance(this.dev, 'confirmed');
  }

  private async sendAndConfirm(ixs: TransactionInstruction[]) {
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('confirmed');
    const tx = new web3.Transaction({ feePayer: this.dev, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.sign(this.kp);
    const signature = b58.encode(tx.signature!);
    await this.conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
    const res = await this.conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (res.value.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(res.value.err)}`);
    return { signature };
  }

  async preparePayout(transfers: Transfer[], memo: string) {
    const ixs = this.budget(20_000 + transfers.length * 5_000);
    for (const t of transfers) ixs.push(web3.SystemProgram.transfer({ fromPubkey: this.dev, toPubkey: new web3.PublicKey(t.to), lamports: t.lamports }));
    ixs.push(new web3.TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(memo.slice(0, 120), 'utf8') }));
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('confirmed');
    const tx = new web3.Transaction({ feePayer: this.dev, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.sign(this.kp);
    const signature = b58.encode(tx.signature!);
    const raw = tx.serialize();
    return {
      signature,
      send: async () => {
        await this.conn.sendRawTransaction(raw, { maxRetries: 5 });
        const res = await this.conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
        if (res.value.err) throw new Error(`Payout ${signature} failed: ${JSON.stringify(res.value.err)}`);
      },
    };
  }

  async signatureStatus(signature: string) {
    const r = await this.conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const s = r.value[0];
    if (!s) return 'unknown' as const;
    if (s.err) return 'failed' as const;
    return s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized' ? ('confirmed' as const) : ('unknown' as const);
  }

  private activity: (() => void)[] = [];
  onActivity(cb: () => void) {
    this.activity.push(cb);
  }

  close() {
    for (const id of this.subs) void this.conn.removeAccountChangeListener(id).catch(() => {});
  }
}
