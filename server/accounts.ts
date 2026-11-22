/**
 * Player accounts: a permanent username plus the Solana address that
 * receives prize payouts. No passwords: a random session token is issued
 * and only its hash is stored. A player who lost their token logs back in
 * with their username and full payout address; winnings can only ever go
 * to the address registered with the account.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Store, UserRecord } from './store';
import { USERNAME_RE } from '../src/shared/protocol';

const require = createRequire(import.meta.url);
const { PublicKey } = require('@solana/web3.js') as typeof import('@solana/web3.js');

const RESERVED = ['admin', 'moderator', 'support', 'official', 'heistmas', 'pumpfun', 'system', 'server', 'staff', 'dev', 'developer', 'anthropic', 'claude'];
const extraBlocked = (process.env.BLOCKED_NAME_WORDS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export class AccountError extends Error {
  constructor(
    readonly code: 'username-invalid' | 'username-taken' | 'username-blocked' | 'wallet-invalid' | 'wallet-taken' | 'terms' | 'rate' | 'not-found' | 'mismatch' | 'banned',
    msg: string,
  ) {
    super(msg);
  }
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** A normal wallet address: base58, 32 bytes, on the ed25519 curve (not a program-derived address). */
export function isValidWallet(addr: string) {
  if (typeof addr !== 'string' || addr.length < 32 || addr.length > 44) return false;
  try {
    const pk = new PublicKey(addr);
    return pk.toBase58() === addr && PublicKey.isOnCurve(pk.toBytes());
  } catch {
    return false;
  }
}

export function usernameProblem(name: string): AccountError | null {
  if (!USERNAME_RE.test(name)) return new AccountError('username-invalid', 'Use 3–16 letters, numbers or underscores.');
  const low = name.toLowerCase();
  if (RESERVED.some((w) => low === w || low.startsWith(w + '_') || low.endsWith('_' + w)) || extraBlocked.some((w) => low.includes(w)))
    return new AccountError('username-blocked', 'That name is reserved. Pick another one.');
  return null;
}

export class Accounts {
  private regByIp = new Map<string, number[]>();

  constructor(
    private store: Store,
    private registrationsPerIpPerHour: number,
  ) {}

  available(username: string) {
    return !usernameProblem(username) && !this.store.userById(username);
  }

  register(username: string, wallet: string, agreed: boolean, ip: string) {
    username = String(username ?? '').trim();
    wallet = String(wallet ?? '').trim();
    const bad = usernameProblem(username);
    if (bad) throw bad;
    if (this.store.userById(username)) throw new AccountError('username-taken', 'That name is taken. Pick another one.');
    if (!isValidWallet(wallet)) throw new AccountError('wallet-invalid', 'That is not a valid Solana wallet address.');
    if (this.store.userByWallet(wallet)) throw new AccountError('wallet-taken', 'That address already belongs to a player. Log in instead.');
    if (!agreed) throw new AccountError('terms', 'Please confirm you are 18+ and accept the rules.');
    const now = Date.now();
    const recent = (this.regByIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.registrationsPerIpPerHour) throw new AccountError('rate', 'Too many new accounts from this network. Try again later.');
    recent.push(now);
    this.regByIp.set(ip, recent);

    const user: UserRecord = {
      id: username.toLowerCase(),
      username,
      wallet,
      tokens: [],
      createdAt: now,
      wins: 0,
      podiums: 0,
      wonLamports: 0,
      bestTimeMs: null,
      roundsPlayed: 0,
    };
    this.store.addUser(user);
    return { user, token: this.issue(user) };
  }

  login(username: string, wallet: string) {
    const user = this.store.userById(String(username ?? '').trim());
    if (!user) throw new AccountError('not-found', 'No player with that name.');
    if (user.wallet !== String(wallet ?? '').trim()) throw new AccountError('mismatch', 'That address does not match this player.');
    if (user.banned) throw new AccountError('banned', 'This account is suspended.');
    return { user, token: this.issue(user) };
  }

  byToken(token: string | undefined | null) {
    if (!token || typeof token !== 'string' || token.length > 200) return null;
    const u = this.store.userByTokenHash(hashToken(token));
    return u && !u.banned ? u : null;
  }

  private issue(user: UserRecord) {
    const token = randomBytes(32).toString('base64url');
    this.store.addToken(user, hashToken(token));
    return token;
  }
}
