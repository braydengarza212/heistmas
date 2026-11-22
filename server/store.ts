/**
 * Small JSON-file persistence. Each collection is one file in DATA_DIR,
 * written atomically (temp file + rename) a moment after it changes.
 * Put DATA_DIR on a persistent disk in production.
 */
import { ACCOUNTS_EPOCH, STATS_EPOCH } from '../src/shared/protocol';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PayoutStatus, RoundResults } from '../src/shared/protocol';

export interface UserRecord {
  /** Lower-case username: the key. */
  id: string;
  username: string;
  wallet: string;
  /** sha256 hashes of active session tokens (newest last). */
  tokens: string[];
  createdAt: number;
  wins: number;
  podiums: number;
  wonLamports: number;
  bestTimeMs: number | null;
  roundsPlayed: number;
  banned?: boolean;
}

export interface PayoutRecord {
  round: number;
  createdAt: number;
  transfers: { place: number; userId: string; username: string; wallet: string; lamports: number; timeMs: number }[];
  status: PayoutStatus;
  signature: string | null;
  /** When the transaction with `signature` was sent. */
  sentAt?: number;
  attempts: number;
  lastError?: string;
}

export interface ClaimRecord {
  at: number;
  lamports: number;
  signature: string;
}

export interface TreasuryLedger {
  /** Lamports rolled over into the next round's pot. */
  carryLamports: number;
  /** Lamports claimed since the last round settled (belong to the next pot). */
  accruedLamports: number;
  /** Payouts that failed and are owed to winners (retried automatically). */
  owedLamports: number;
  claimedTotalLamports: number;
  paidTotalLamports: number;
  houseTotalLamports: number;
  lastClaim: ClaimRecord | null;
  claims: ClaimRecord[];
  payouts: PayoutRecord[];
}

export interface RoundLog {
  /** STATS_EPOCH last applied (stats reset). */
  statsEpoch?: number;
  lastRoundId: number;
  results: RoundResults[];
  flagged: { round: number; username: string; reasons: string[]; at: number }[];
}

class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null;
  data: T;
  constructor(
    private path: string,
    fallback: () => T,
  ) {
    let loaded: T | null = null;
    if (existsSync(path)) {
      try {
        loaded = { ...fallback(), ...(JSON.parse(readFileSync(path, 'utf8')) as T) };
      } catch (e) {
        throw new Error(`Could not read ${path}: ${(e as Error).message}. Fix or remove the file before starting.`);
      }
    }
    this.data = loaded ?? fallback();
  }
  /** Schedule a write (coalesces bursts of changes). */
  touch(delayMs = 800) {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), delayMs);
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.path);
  }
}

export class Store {
  readonly users: JsonFile<{ list: UserRecord[]; accountsEpoch?: number }>;
  readonly treasury: JsonFile<TreasuryLedger>;
  readonly rounds: JsonFile<RoundLog>;
  private byId = new Map<string, UserRecord>();
  private byWallet = new Map<string, UserRecord>();
  private byToken = new Map<string, UserRecord>();

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.users = new JsonFile(join(dir, 'users.json'), () => ({ list: [] }));
    this.treasury = new JsonFile(join(dir, 'treasury.json'), () => ({
      carryLamports: 0,
      accruedLamports: 0,
      owedLamports: 0,
      claimedTotalLamports: 0,
      paidTotalLamports: 0,
      houseTotalLamports: 0,
      lastClaim: null,
      claims: [],
      payouts: [],
    }));
    this.rounds = new JsonFile(join(dir, 'rounds.json'), () => ({ lastRoundId: 0, results: [], flagged: [] }));
    this.applyAccountsReset();
    for (const u of this.users.data.list) this.index(u);
    this.applyStatsReset();
  }

  /** One-time wipe of every player's stats when STATS_EPOCH goes up. Accounts, wallets and the money ledger stay. */
  private applyStatsReset() {
    if ((this.rounds.data.statsEpoch ?? 0) >= STATS_EPOCH) return;
    for (const u of this.users.data.list) {
      u.wins = 0;
      u.podiums = 0;
      u.wonLamports = 0;
      u.bestTimeMs = null;
      u.roundsPlayed = 0;
    }
    this.rounds.data.results = [];
    this.rounds.data.flagged = [];
    this.rounds.data.statsEpoch = STATS_EPOCH;
    this.users.flush();
    this.rounds.flush();
    this.statsWasReset = true;
  }

  /** One-time deletion of every account (usernames + SOL addresses) when ACCOUNTS_EPOCH goes up. */
  private applyAccountsReset() {
    if ((this.users.data.accountsEpoch ?? 0) >= ACCOUNTS_EPOCH) return;
    this.accountsWiped = this.users.data.list.length;
    this.users.data.list = [];
    this.users.data.accountsEpoch = ACCOUNTS_EPOCH;
    this.users.flush();
  }

  /** How many accounts this start deleted (for the log). */
  accountsWiped = 0;

  /** True when this start wiped the stats (for the log). */
  statsWasReset = false;

  private index(u: UserRecord) {
    this.byId.set(u.id, u);
    this.byWallet.set(u.wallet, u);
    for (const t of u.tokens) this.byToken.set(t, u);
  }

  userById(id: string) {
    return this.byId.get(id.toLowerCase()) ?? null;
  }
  userByWallet(w: string) {
    return this.byWallet.get(w) ?? null;
  }
  userByTokenHash(h: string) {
    return this.byToken.get(h) ?? null;
  }
  get userCount() {
    return this.users.data.list.length;
  }
  allUsers() {
    return this.users.data.list;
  }

  addUser(u: UserRecord) {
    this.users.data.list.push(u);
    this.index(u);
    this.users.touch();
  }

  addToken(u: UserRecord, hash: string, keep = 5) {
    u.tokens.push(hash);
    this.byToken.set(hash, u);
    while (u.tokens.length > keep) this.byToken.delete(u.tokens.shift()!);
    this.users.touch();
  }

  touchUsers() {
    this.users.touch();
  }

  flushAll() {
    this.users.flush();
    this.treasury.flush();
    this.rounds.flush();
  }
}
