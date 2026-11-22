/**
 * Messages and shapes shared by the browser client and the game server.
 * All timestamps are server epoch milliseconds unless noted.
 * All SOL amounts are in lamports (1 SOL = 1,000,000,000 lamports).
 */

export const PROTOCOL_VERSION = 2;
export const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Round lifecycle:
 *   waiting  → countdown before the round goes live (players load in and ready up)
 *   live     → the race is on; everyone's clock started at `startsAt`
 *   settling → the round is over; fees are swept and the top 3 are being paid
 *   results  → winners announced; counting down to the next round
 */
export type Phase = 'waiting' | 'live' | 'settling' | 'results';

export interface RoundState {
  id: number;
  phase: Phase;
  /** When this round goes (or went) live. */
  startsAt: number;
  /** When this round's race ends. */
  endsAt: number;
  /** Joining after this moment means waiting for the next round. */
  lateJoinUntil: number;
  /** When the following round goes live (known once this one ends). */
  nextStartsAt: number | null;
}

export interface PotState {
  /** Round this pot will be paid to. */
  round: number;
  /** Claimed into the dev wallet and ready to pay (includes rollover). */
  lamports: number;
  /** Creator fees still in the pump.fun vault; the server claims them automatically. */
  pendingLamports: number;
  /** Part of `lamports` rolled over from earlier rounds. */
  carriedLamports: number;
  /** Percent of the pot per place, e.g. [50, 30, 20]. */
  split: number[];
  /** Percent of each pot the site keeps (0 by default). */
  houseCutPercent: number;
  solUsd: number | null;
  lastClaimAt: number | null;
  lastClaimLamports: number;
  /** All-time creator fees claimed by the server. */
  claimedTotalLamports: number;
  /** All-time SOL sent to winners. */
  paidTotalLamports: number;
  mode: 'mock' | 'live';
  status: 'ok' | 'degraded';
}

export interface StandingEntry {
  rank: number;
  username: string;
  timeMs: number;
  server: number;
}

export interface Standings {
  round: number;
  top: StandingEntry[];
  finishers: number;
  players: number;
}

export type PayoutStatus = 'sending' | 'sent' | 'failed' | 'rolled-over';

export interface Winner {
  place: number;
  username: string;
  /** Shortened for display, e.g. 7xKX…9fQa. */
  wallet: string;
  timeMs: number;
  lamports: number;
  status: PayoutStatus;
  signature: string | null;
}

export interface RoundResults {
  round: number;
  potLamports: number;
  winners: Winner[];
  rolledOverLamports: number;
  finishers: number;
  players: number;
  endedAt: number;
}

export interface ServerInfo {
  id: number;
  name: string;
  players: number;
  capacity: number;
}

export interface TokenInfo {
  name: string;
  symbol: string;
  /** Contract address (mint). Null until launch. */
  mint: string | null;
  pumpUrl: string | null;
  links: { label: string; url: string }[];
}

export interface PublicConfig {
  token: TokenInfo;
  devWallet: string | null;
  split: number[];
  houseCutPercent: number;
  roundSeconds: number;
  intermissionSeconds: number;
  lateJoinSeconds: number;
  capacity: number;
  serverCount: number;
  chain: 'mock' | 'mainnet-beta' | 'devnet';
  /** Explorer link templates with {sig} / {addr} placeholders. */
  explorerTx: string;
  explorerAccount: string;
  minFinishSeconds: number;
}

export interface InfoResponse {
  config: PublicConfig;
  servers: ServerInfo[];
  round: RoundState;
  pot: PotState;
  standings: Standings;
  lastResults: RoundResults | null;
  now: number;
  playersOnline: number;
}

export interface Profile {
  username: string;
  /** Full payout address. */
  wallet: string;
  createdAt: number;
  wins: number;
  podiums: number;
  wonLamports: number;
  bestTimeMs: number | null;
  roundsPlayed: number;
}

export interface LeaderboardResponse {
  allTime: { username: string; wallet: string; wonLamports: number; wins: number; podiums: number; bestTimeMs: number | null }[];
  recent: RoundResults[];
}

// ----------------------------------------------------------- client → server

export type ClientEvent =
  | { k: 'pickup'; ms: number; v: number; x: number; y: number; z: number }
  | { k: 'drop'; ms: number; v: number }
  | { k: 'crack'; ms: number }
  | { k: 'respawn'; ms: number; x: number; y: number; z: number };

export type ClientMsg =
  | { t: 'hello'; token: string; server: number; v: number }
  /** A new attempt starts at the spawn point (first, or after being busted). */
  | { t: 'attempt'; a: number }
  /** Position samples as a flat list: [ms, x, y, z, ms, x, y, z, …], ms since the attempt began (client clock). */
  | { t: 'trace'; a: number; s: number[] }
  | ({ t: 'ev'; a: number } & ClientEvent)
  /** Reached the getaway ring with enough loot. */
  | { t: 'finish'; a: number; ms: number; loot: number }
  | { t: 'ping'; c: number }
  /** Shared world: your outfit, as "skin|mask|hat|sack" (sent once per heist). */
  | { t: 'look'; o: string }
  /** Shared world: your state, 10 a second. See STATE_FIELDS. */
  | { t: 'st'; s: number[] }
  /** Shared world: you fired weapon `w` (index into NET_WEAPONS) from o along d. */
  | { t: 'shot'; w: number; o: number[]; d: number[] }
  /** Shared world: your snowball hit player `v`. */
  | { t: 'hit'; v: number; w: number };

// ----------------------------------------------------------- shared world

/**
 * Players share a "bank" (an instance of the level) of up to BANK_CAPACITY
 * robbers. Each client streams its state; the server relays the nearest
 * robbers back. Guards, loot and weapons stay local to every client.
 *
 * State fields (all integers): x·10, y·10, z·10, yaw·100, anim, speed·10, weapon+1 (0 = none), flags.
 */
export const STATE_FIELDS = 8;
/** Per-player stride in a 'pl' snapshot: id + STATE_FIELDS. */
export const SNAP_STRIDE = 1 + STATE_FIELDS;
export const STATE_HZ = 10;
export const FLAG_FROZEN = 1;
export const FLAG_SPRINT = 2;
/** Animation codes in the state stream. */
export const ANIMS = ['idle', 'run', 'air', 'dive', 'slide', 'knocked', 'getup', 'interact', 'celebrate', 'caught', 'hang'] as const;
/** Snowball weapons in network order, with how many players one shot may freeze. */
export const NET_WEAPONS = [
  { id: 'frosty', hits: 1, range: 90 },
  { id: 'carbine', hits: 1, range: 90 },
  { id: 'jingle', hits: 7, range: 30 },
  { id: 'nutcracker', hits: 1, range: 140 },
  { id: 'globe', hits: 12, range: 70 },
  { id: 'peppermint', hits: 1, range: 100 },
  { id: 'tinsel', hits: 1, range: 70 },
  { id: 'aurora', hits: 6, range: 80 },
  { id: 'icicle', hits: 6, range: 140 },
  { id: 'yule', hits: 16, range: 90 },
] as const;
export const PLAYER_FREEZE_MS = 5000;

// ----------------------------------------------------------- server → client

export type ServerMsg =
  | {
      t: 'welcome';
      you: { username: string; wallet: string };
      server: ServerInfo;
      round: RoundState;
      pot: PotState;
      standings: Standings;
      config: PublicConfig;
      now: number;
      /** Your accepted time this round, if any. */
      bestMs: number | null;
    }
  | { t: 'round'; round: RoundState }
  | { t: 'pot'; pot: PotState; flash?: number }
  | { t: 'standings'; standings: Standings }
  | { t: 'servers'; list: ServerInfo[]; online: number }
  | { t: 'finish'; a: number; accepted: boolean; timeMs: number; rank: number | null; note?: string }
  | { t: 'results'; results: RoundResults; you: { rank: number | null; timeMs: number | null } }
  | { t: 'payout'; round: number; winners: Winner[] }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; code: ErrorCode; msg: string }
  /** Shared world: the bank you were placed in. `you` is your player id. */
  | { t: 'bank'; id: number; name: string; you: number; players: number; capacity: number }
  /** Shared world: players entering your view [id, username, look], and leaving the bank. */
  | { t: 'ros'; add: [number, string, string][]; del: number[] }
  /** Shared world: nearest robbers, flat [id, …state] × n; ts = server ms. */
  | { t: 'pl'; ts: number; n: number; p: number[] }
  /** Shared world: someone nearby fired. */
  | { t: 'shot'; id: number; w: number; o: number[]; d: number[] }
  /** Shared world: you were hit; (dx, dz) points away from the shooter. */
  | { t: 'hitby'; id: number; by: string; w: number; dx: number; dz: number };

export type ErrorCode = 'version' | 'auth' | 'full' | 'bad-server' | 'replaced' | 'phase' | 'rate' | 'internal' | 'ip-limit';

// ------------------------------------------------------------------ helpers

export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export function shortWallet(w: string) {
  return w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
}

export function formatSol(lamports: number, digits = 3) {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol > 0 && sol < 0.001) return '<0.001';
  return sol.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Splits a pot between places. Shares below `minLamports` are not paid
 * (they roll over), and every amount is a whole number of lamports.
 */
export function splitPot(potLamports: number, splitPercent: readonly number[], finishers: number, minLamports: number) {
  const amounts: number[] = [];
  let paid = 0;
  for (let i = 0; i < splitPercent.length; i++) {
    if (i >= finishers) {
      amounts.push(0);
      continue;
    }
    const a = Math.floor((potLamports * splitPercent[i]) / 100);
    if (a < minLamports) {
      amounts.push(0);
      continue;
    }
    amounts.push(a);
    paid += a;
  }
  return { amounts, paid, rolledOver: potLamports - paid };
}
