/**
 * Simulated chain for local testing and demos: trading fees trickle into a
 * pretend creator vault and payouts get made-up signatures. No SOL moves.
 */
import { randomBytes } from 'node:crypto';
import type { ChainAdapter, ChainStatus, Transfer } from './types';

export class MockChain implements ChainAdapter {
  readonly mode = 'mock' as const;
  private vault = 0;
  private balance: number;
  private activity: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;
  private sigs = new Map<string, 'confirmed' | 'failed'>();
  /** Test hook: make the next N payouts fail. */
  failNextPayouts = 0;

  constructor(
    private lamportsPerMinute: number,
    startingBalance = 50_000_000,
  ) {
    this.balance = startingBalance;
  }

  async init(): Promise<ChainStatus> {
    // Random "trades" every 1–4 s that together average lamportsPerMinute.
    const tick = () => {
      const gap = 1000 + Math.random() * 3000;
      const fee = Math.round(((this.lamportsPerMinute * gap) / 60000) * (0.3 + Math.random() * 1.4));
      if (fee > 0) {
        this.vault += fee;
        for (const cb of this.activity) cb();
      }
      this.timer = setTimeout(tick, gap);
    };
    if (this.lamportsPerMinute > 0) this.timer = setTimeout(tick, 1000);
    return this.status();
  }

  status(): ChainStatus {
    return { mode: 'mock', feeRoute: 'mock', devWallet: 'MockDevWa11et1111111111111111111111111111111', mint: null, graduated: false, shareBps: 10000, notes: ['Simulated fees — no real SOL moves'] };
  }

  /** Test hook: add fees as if trades happened. */
  addFees(lamports: number) {
    this.vault += lamports;
    for (const cb of this.activity) cb();
  }

  async pendingFees() {
    return this.vault;
  }

  async claimFees() {
    if (this.vault <= 0) return null;
    const lamports = this.vault - 5000; // network fee
    this.vault = 0;
    if (lamports <= 0) return null;
    this.balance += lamports;
    return { lamports, signature: 'mock' + randomBytes(16).toString('hex') };
  }

  async walletBalance() {
    return this.balance;
  }

  async preparePayout(transfers: Transfer[]) {
    const signature = 'mock' + randomBytes(16).toString('hex');
    return {
      signature,
      send: async () => {
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
        if (this.failNextPayouts > 0) {
          this.failNextPayouts--;
          this.sigs.set(signature, 'failed');
          throw new Error('Simulated network failure');
        }
        const total = transfers.reduce((a, t) => a + t.lamports, 0);
        if (total + 5000 > this.balance) throw new Error('Insufficient funds');
        this.balance -= total + 5000;
        this.sigs.set(signature, 'confirmed');
      },
    };
  }

  async signatureStatus(sig: string) {
    return this.sigs.get(sig) ?? 'unknown';
  }

  onActivity(cb: () => void) {
    this.activity.push(cb);
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
  }
}
