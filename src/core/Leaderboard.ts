/**
 * Leaderboards.
 *
 * The game talks to a `LeaderboardService`. Today that is `LocalLeaderboard`
 * (localStorage). To go online, deploy an API matching the contract below and
 * set `VITE_LEADERBOARD_URL` at build time — `createLeaderboard()` will then
 * return a `RemoteLeaderboard`, which falls back to local storage when offline.
 *
 * Expected API contract
 *   GET  {base}/scores?heist=christmas-bank&limit=10  -> ScoreEntry[]
 *   POST {base}/scores  body: ScoreSubmission         -> { position: number | null }
 *
 * Scores computed on the client can be forged. A real online board should
 * re-validate submissions server-side (plausible loot/time ranges, rate limits,
 * signed run tokens issued when a heist starts).
 */

export interface ScoreEntry {
  id: string;
  name: string;
  heist: string;
  score: number;
  loot: number;
  timeMs: number;
  maxStars: number;
  rank: number;
  outfit: string;
  date: number;
}

export type ScoreSubmission = Omit<ScoreEntry, 'id'> & { clientVersion: string };

export interface LeaderboardService {
  readonly kind: 'local' | 'remote';
  submit(entry: ScoreSubmission): Promise<{ position: number | null; id: string }>;
  top(heist: string, limit?: number): Promise<ScoreEntry[]>;
}

const KEY = 'heistmas.scores.v1';
const MAX_LOCAL = 50;

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export class LocalLeaderboard implements LeaderboardService {
  readonly kind = 'local' as const;

  private read(): ScoreEntry[] {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? (JSON.parse(raw) as ScoreEntry[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private write(list: ScoreEntry[]) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }

  async submit(entry: ScoreSubmission) {
    const list = this.read();
    const { clientVersion: _v, ...rest } = entry;
    const full: ScoreEntry = { ...rest, id: uid() };
    list.push(full);
    list.sort((a, b) => b.score - a.score);
    const trimmed = list.slice(0, MAX_LOCAL);
    this.write(trimmed);
    const sameHeist = trimmed.filter((e) => e.heist === entry.heist);
    const idx = sameHeist.findIndex((e) => e.id === full.id);
    return { position: idx >= 0 ? idx + 1 : null, id: full.id };
  }

  async top(heist: string, limit = 10) {
    return this.read()
      .filter((e) => e.heist === heist)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export class RemoteLeaderboard implements LeaderboardService {
  readonly kind = 'remote' as const;
  constructor(
    private baseUrl: string,
    private fallback: LocalLeaderboard,
  ) {}

  async submit(entry: ScoreSubmission) {
    const local = await this.fallback.submit(entry);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { position?: number | null };
      return { position: json.position ?? null, id: local.id };
    } catch {
      return local;
    }
  }

  async top(heist: string, limit = 10) {
    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/scores?heist=${encodeURIComponent(heist)}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const list = (await res.json()) as ScoreEntry[];
      return Array.isArray(list) ? list.slice(0, limit) : [];
    } catch {
      return this.fallback.top(heist, limit);
    }
  }
}

export function createLeaderboard(): LeaderboardService {
  const url = (import.meta.env.VITE_LEADERBOARD_URL as string | undefined) ?? '';
  const local = new LocalLeaderboard();
  return url ? new RemoteLeaderboard(url, local) : local;
}
