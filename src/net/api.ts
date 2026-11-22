import type { InfoResponse, LeaderboardResponse, Profile } from '../shared/protocol';

/**
 * Where the game server lives. By default the page's own origin (the server
 * serves the game). Set VITE_GAME_SERVER_URL at build time when the site is
 * hosted separately, e.g. VITE_GAME_SERVER_URL=https://play.example.com
 */
const BASE = ((import.meta.env.VITE_GAME_SERVER_URL as string | undefined) ?? '').replace(/\/$/, '');

export const apiBase = () => BASE || location.origin;
export const wsUrl = () => apiBase().replace(/^http/, 'ws') + '/ws';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    msg: string,
  ) {
    super(msg);
  }
}

async function call<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.token ? { authorization: `Bearer ${init.token}` } : {}) },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ApiError('offline', 'Could not reach the game servers.');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON: the static host has no game server */
  }
  if (!res.ok || body === null) {
    const b = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(b.error ?? (body === null ? 'offline' : 'error'), b.message ?? 'The game servers are offline right now.');
  }
  return body as T;
}

export const api = {
  info: () => call<InfoResponse>('/api/info'),
  usernameAvailable: (u: string) => call<{ available: boolean }>(`/api/username?u=${encodeURIComponent(u)}`),
  register: (username: string, wallet: string, agree: boolean) => call<{ token: string; profile: Profile }>('/api/register', { method: 'POST', body: JSON.stringify({ username, wallet, agree }) }),
  login: (username: string, wallet: string) => call<{ token: string; profile: Profile }>('/api/login', { method: 'POST', body: JSON.stringify({ username, wallet }) }),
  me: (token: string) => call<Profile>('/api/me', { token }),
  leaderboard: () => call<LeaderboardResponse>('/api/leaderboard'),
};

// ------------------------------------------------------------ wallet check
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Quick client-side check: base58 that decodes to 32 bytes. The server also checks it is a real wallet. */
export function looksLikeSolanaAddress(s: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  let bytes = [0];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  while (s[zeros] === '1') zeros++;
  bytes = bytes.reverse();
  while (bytes.length > 1 && bytes[0] === 0) bytes.shift();
  const len = zeros + (bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length);
  return len === 32;
}
