/**
 * The prize pot.
 *
 *  - Claims creator fees into the dev wallet around the clock: on every
 *    trade notification (debounced) and on a fixed poll as a fallback,
 *    whenever at least CLAIM_MIN_SOL is waiting.
 *  - Keeps a ledger: what was claimed since the last round settled, what
 *    rolled over, what is owed to winners whose payout failed.
 *  - At the end of each round it sweeps any remaining fees, splits the pot
 *    between the top finishers (50/30/20 by default) and sends one
 *    transaction that pays all of them. Shares nobody won roll over.
 */
import type { ChainAdapter } from './chain/types';
import type { PayoutRecord, Store } from './store';
import { splitPot, type PotState, type Winner, type PayoutStatus, shortWallet } from '../src/shared/protocol';
import type { Config } from './config';

export interface WinnerInput {
  userId: string;
  username: string;
  wallet: string;
  timeMs: number;
}

export interface SettleResult {
  potLamports: number;
  houseLamports: number;
  rolledOverLamports: number;
  winners: Winner[];
}

export class Treasury {
  private pending = 0;
  private claiming = false;
  private lastCheck = 0;
  private debounce: NodeJS.Timeout | null = null;
  private poll: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private degraded = false;
  private solUsd: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  currentRound = 1;
  /** Called whenever the pot changes; `flash` is a fresh claim to celebrate. */
  onChange: (pot: PotState, flash?: number) => void = () => {};
  onPayoutUpdate: (round: number, winners: Winner[]) => void = () => {};

  constructor(
    private chain: ChainAdapter,
    private store: Store,
    private cfg: Config,
    private log: (m: string) => void,
  ) {}

  get ledger() {
    return this.store.treasury.data;
  }

  async start() {
    this.chain.onActivity(() => this.nudge());
    await this.check(true);
    this.poll = setInterval(() => void this.check(), this.cfg.claimPollSeconds * 1000);
    this.retryTimer = setInterval(() => void this.retryFailed(), 60_000);
    void this.retryFailed();
  }

  stop() {
    if (this.poll) clearInterval(this.poll);
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.debounce) clearTimeout(this.debounce);
  }

  setPrice(usd: number | null) {
    this.solUsd = usd;
  }

  /** A trade touched the fee accounts: look again shortly. */
  private nudge() {
    if (this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.check();
    }, 1500);
  }

  /** Serializes chain work so claims and payouts never interleave. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Reads waiting fees and claims them when worth it. */
  async check(force = false) {
    if (this.claiming) return;
    const now = Date.now();
    if (!force && now - this.lastCheck < 2000) return;
    this.lastCheck = now;
    try {
      this.pending = await this.chain.pendingFees();
      this.degraded = false;
    } catch (e) {
      this.degraded = true;
      this.log(`fees: could not read pending fees: ${(e as Error).message}`);
      this.emit();
      return;
    }
    const since = this.ledger.lastClaim ? now - this.ledger.lastClaim.at : Infinity;
    if (this.pending >= this.cfg.claimMinLamports && (force || since >= this.cfg.claimMinIntervalSeconds * 1000)) await this.claim();
    else this.emit();
  }

  private async claim() {
    if (this.cfg.dryRun) {
      this.log(`fees: DRY_RUN — would claim ${(this.pending / 1e9).toFixed(6)} SOL now`);
      this.emit();
      return;
    }
    this.claiming = true;
    try {
      const r = await this.exclusive(() => this.chain.claimFees());
      if (r && r.lamports > 0) {
        const L = this.ledger;
        L.accruedLamports += r.lamports;
        L.claimedTotalLamports += r.lamports;
        L.lastClaim = { at: Date.now(), lamports: r.lamports, signature: r.signature };
        L.claims.push(L.lastClaim);
        if (L.claims.length > 300) L.claims.splice(0, L.claims.length - 300);
        this.store.treasury.touch();
        this.pending = 0;
        this.log(`fees: claimed ${(r.lamports / 1e9).toFixed(6)} SOL (${r.signature})`);
        this.emit(r.lamports);
      } else this.emit();
      this.degraded = false;
    } catch (e) {
      this.degraded = true;
      this.log(`fees: claim failed: ${(e as Error).message}`);
      this.emit();
    } finally {
      this.claiming = false;
    }
  }

  /** Pot currently headed to the next settlement (before the house cut). */
  potLamports() {
    return this.ledger.carryLamports + this.ledger.accruedLamports;
  }

  state(): PotState {
    const L = this.ledger;
    return {
      round: this.currentRound,
      lamports: this.potLamports(),
      pendingLamports: Math.max(0, this.pending),
      carriedLamports: L.carryLamports,
      split: this.cfg.split,
      houseCutPercent: this.cfg.houseCutPercent,
      solUsd: this.solUsd,
      lastClaimAt: L.lastClaim?.at ?? null,
      lastClaimLamports: L.lastClaim?.lamports ?? 0,
      claimedTotalLamports: L.claimedTotalLamports,
      paidTotalLamports: L.paidTotalLamports,
      mode: this.chain.mode,
      status: this.degraded ? 'degraded' : 'ok',
    };
  }

  private emit(flash?: number) {
    this.onChange(this.state(), flash);
  }

  /**
   * Ends a round: sweeps the last fees, splits the pot between the ranked
   * finishers (fastest first) and pays them in one transaction.
   */
  async settle(round: number, ranked: WinnerInput[]): Promise<SettleResult> {
    // Sweep whatever arrived during the round so it counts for this pot.
    try {
      this.pending = await this.chain.pendingFees();
      if (this.pending >= Math.min(this.cfg.claimMinLamports, 1_000_000) && !this.cfg.dryRun) {
        while (this.claiming) await new Promise((r) => setTimeout(r, 200));
        await this.claim();
      }
    } catch (e) {
      this.log(`round ${round}: final fee sweep skipped: ${(e as Error).message}`);
    }

    const L = this.ledger;
    const pot = L.carryLamports + L.accruedLamports;
    L.carryLamports = 0;
    L.accruedLamports = 0;
    const house = Math.floor((pot * this.cfg.houseCutPercent) / 100);
    const distributable = pot - house;
    const top = ranked.slice(0, this.cfg.split.length);
    const { amounts, paid, rolledOver } = splitPot(distributable, this.cfg.split, top.length, this.cfg.minPayoutLamports);

    const transfers = top
      .map((w, i) => ({ place: i + 1, userId: w.userId, username: w.username, wallet: w.wallet, lamports: amounts[i], timeMs: w.timeMs }))
      .filter((t) => t.lamports > 0);
    L.carryLamports += rolledOver;
    L.houseTotalLamports += house;
    this.store.treasury.touch();

    const winners: Winner[] = top.map((w, i) => ({
      place: i + 1,
      username: w.username,
      wallet: shortWallet(w.wallet),
      timeMs: w.timeMs,
      lamports: amounts[i],
      status: amounts[i] > 0 ? 'sending' : 'rolled-over',
      signature: null,
    }));

    if (!transfers.length) {
      this.log(`round ${round}: no payouts (pot ${(pot / 1e9).toFixed(6)} SOL, ${(rolledOver / 1e9).toFixed(6)} SOL rolls over)`);
      this.emit();
      return { potLamports: pot, houseLamports: house, rolledOverLamports: rolledOver, winners };
    }

    const rec: PayoutRecord = { round, createdAt: Date.now(), transfers, status: 'sending', signature: null, attempts: 0 };
    L.payouts.push(rec);
    if (L.payouts.length > 1000) L.payouts.splice(0, L.payouts.length - 1000);
    L.owedLamports += paid;
    this.store.treasury.touch();
    this.emit();

    await this.pay(rec);
    for (const w of winners) if (w.lamports > 0) Object.assign(w, { status: rec.status, signature: rec.signature });
    return { potLamports: pot, houseLamports: house, rolledOverLamports: rolledOver, winners };
  }

  /** Sends (or re-sends) one payout record. Never pays a record twice. */
  private async pay(rec: PayoutRecord) {
    const total = rec.transfers.reduce((a, t) => a + t.lamports, 0);
    if (this.cfg.dryRun) {
      this.log(`round ${rec.round}: DRY_RUN — would pay ${rec.transfers.map((t) => `${t.username} ${(t.lamports / 1e9).toFixed(6)} SOL`).join(', ')}`);
      rec.status = 'failed';
      rec.lastError = 'DRY_RUN';
      return;
    }
    await this.exclusive(async () => {
      // A signature we sent before may still land: check it first.
      if (rec.signature) {
        const st = await this.chain.signatureStatus(rec.signature).catch(() => 'unknown' as const);
        if (st === 'confirmed') return this.markPaid(rec, total);
        // Unknown and recent: it may still land, so do not send a second one yet.
        if (st === 'unknown' && Date.now() - (rec.sentAt ?? 0) < 120_000) return;
      }
      try {
        const balance = await this.chain.walletBalance();
        if (balance - total - 20_000 < this.cfg.walletReserveLamports) throw new Error(`dev wallet balance ${(balance / 1e9).toFixed(6)} SOL is too low to pay ${(total / 1e9).toFixed(6)} SOL and keep the reserve`);
        rec.attempts++;
        const memo = `Heistmas round ${rec.round} prizes`;
        const p = await this.chain.preparePayout(
          rec.transfers.map((t) => ({ to: t.wallet, lamports: t.lamports })),
          memo,
        );
        rec.signature = p.signature;
        rec.sentAt = Date.now();
        rec.status = 'sending';
        this.store.treasury.flush(); // record the signature before it can land
        await p.send();
        this.markPaid(rec, total);
      } catch (e) {
        rec.status = 'failed';
        rec.lastError = (e as Error).message;
        this.degraded = true;
        this.store.treasury.touch();
        this.log(`round ${rec.round}: payout attempt ${rec.attempts} failed: ${rec.lastError}`);
      }
    });
  }

  private markPaid(rec: PayoutRecord, total: number) {
    const L = this.ledger;
    rec.status = 'sent';
    rec.lastError = undefined;
    L.owedLamports = Math.max(0, L.owedLamports - total);
    L.paidTotalLamports += total;
    for (const t of rec.transfers) {
      const u = this.store.userById(t.userId);
      if (!u) continue;
      u.wonLamports += t.lamports;
      u.podiums++;
      if (t.place === 1) u.wins++;
    }
    this.store.touchUsers();
    this.store.treasury.touch();
    this.log(`round ${rec.round}: paid ${rec.transfers.map((t) => `${t.username} ${(t.lamports / 1e9).toFixed(6)} SOL`).join(', ')} (${rec.signature})`);
    this.emit();
  }

  /** Retries failed payouts for up to a day, oldest first. */
  private async retryFailed() {
    const due = this.ledger.payouts.filter((p) => (p.status === 'failed' || p.status === 'sending') && Date.now() - p.createdAt < 86_400_000 && p.lastError !== 'DRY_RUN');
    for (const rec of due) {
      if (rec.status === 'sending' && Date.now() - (rec.sentAt ?? rec.createdAt) < 60_000) continue; // still in flight
      await this.pay(rec);
      this.onPayoutUpdate(rec.round, this.winnersOf(rec));
    }
  }

  private winnersOf(rec: PayoutRecord): Winner[] {
    return rec.transfers.map((t) => ({ place: t.place, username: t.username, wallet: shortWallet(t.wallet), timeMs: t.timeMs, lamports: t.lamports, status: rec.status as PayoutStatus, signature: rec.signature }));
  }

  adminStatus() {
    const L = this.ledger;
    return {
      chain: this.chain.status(),
      pot: this.state(),
      owedLamports: L.owedLamports,
      houseTotalLamports: L.houseTotalLamports,
      recentClaims: L.claims.slice(-20),
      unpaid: L.payouts.filter((p) => p.status !== 'sent').slice(-20),
      recentPayouts: L.payouts.slice(-20),
      dryRun: this.cfg.dryRun,
    };
  }
}
