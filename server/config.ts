/**
 * Every setting the site's developers can change, read from environment
 * variables (or a .env file next to package.json). See .env.example.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAMPORTS_PER_SOL } from '../src/shared/protocol';

loadDotEnv(resolve(process.cwd(), '.env'));

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const env = (k: string, d: string) => (process.env[k] ?? '').trim() || d;
const num = (k: string, d: number, min = -Infinity, max = Infinity) => {
  const raw = process.env[k];
  if (raw === undefined || raw.trim() === '') return d;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`${k} must be a number (got "${raw}")`);
  if (v < min || v > max) throw new Error(`${k} must be between ${min} and ${max} (got ${v})`);
  return v;
};
const bool = (k: string, d: boolean) => {
  const raw = (process.env[k] ?? '').trim().toLowerCase();
  if (!raw) return d;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};
const sol = (k: string, d: number) => Math.round(num(k, d, 0) * LAMPORTS_PER_SOL);

const serverCount = num('SERVER_COUNT', 10, 1, 100);
const names = env('SERVER_NAMES', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const split = env('PAYOUT_SPLIT', '50,30,20')
  .split(',')
  .map((s) => Number(s.trim()));
if (!split.length || split.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error('PAYOUT_SPLIT must be positive numbers, e.g. 50,30,20');
if (split.reduce((a, b) => a + b, 0) > 100.0001) throw new Error('PAYOUT_SPLIT must add up to 100 or less');
for (let i = 1; i < split.length; i++) if (split[i] > split[i - 1]) throw new Error('PAYOUT_SPLIT must not increase: 1st place gets the most');

const chainMode = env('CHAIN_MODE', 'mock');
if (chainMode !== 'mock' && chainMode !== 'live') throw new Error('CHAIN_MODE must be "mock" or "live"');
const cluster = env('SOLANA_CLUSTER', 'mainnet-beta');
if (cluster !== 'mainnet-beta' && cluster !== 'devnet') throw new Error('SOLANA_CLUSTER must be "mainnet-beta" or "devnet"');

const links = env('TOKEN_LINKS', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((pair) => {
    const [label, url] = pair.split('|').map((x) => x.trim());
    if (!label || !url || !/^https:\/\//.test(url)) throw new Error(`TOKEN_LINKS entries look like Label|https://… (got "${pair}")`);
    return { label, url };
  });

const tokenMint = env('TOKEN_MINT', '') || null;

export const config = {
  port: num('PORT', 8080, 1, 65535),
  host: env('HOST', '0.0.0.0'),
  publicDir: resolve(process.cwd(), env('PUBLIC_DIR', 'dist')),
  dataDir: resolve(process.cwd(), env('DATA_DIR', 'data')),
  trustProxy: bool('TRUST_PROXY', false),
  allowedOrigins: env('ALLOWED_ORIGINS', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  adminToken: env('ADMIN_TOKEN', ''),

  // ---- servers & capacity
  serverCount,
  maxPlayersPerServer: num('MAX_PLAYERS_PER_SERVER', 2000, 1, 100000),
  /** Robbers sharing one copy of the bank (a server holds several banks). */
  bankCapacity: num('BANK_CAPACITY', 200, 1, 2000),
  serverNames: Array.from({ length: serverCount }, (_, i) => names[i] ?? `Server ${i + 1}`),
  maxConnectionsPerIp: num('MAX_CONNECTIONS_PER_IP', 6, 1, 100000),
  registrationsPerIpPerHour: num('REGISTRATIONS_PER_IP_PER_HOUR', 5, 1, 1_000_000),
  authRequestsPerIpPerMinute: num('AUTH_REQUESTS_PER_IP_PER_MINUTE', 20, 1, 1_000_000),

  // ---- rounds
  roundSeconds: num('ROUND_SECONDS', 300, 20, 3600),
  intermissionSeconds: num('INTERMISSION_SECONDS', 30, 5, 600),
  lateJoinSeconds: num('LATE_JOIN_SECONDS', 60, 0, 3600),

  // ---- prize pot
  split,
  houseCutPercent: num('HOUSE_CUT_PERCENT', 0, 0, 100),
  minPayoutLamports: sol('MIN_PAYOUT_SOL', 0.001),
  walletReserveLamports: sol('WALLET_RESERVE_SOL', 0.02),

  // ---- chain
  chainMode: chainMode as 'mock' | 'live',
  cluster: cluster as 'mainnet-beta' | 'devnet',
  rpcUrl: env('SOLANA_RPC_URL', cluster === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com'),
  wsUrl: env('SOLANA_WS_URL', ''),
  devWalletSecret: env('DEV_WALLET_SECRET_KEY', ''),
  claimPollSeconds: num('CLAIM_POLL_SECONDS', 10, 2, 3600),
  claimMinLamports: sol('CLAIM_MIN_SOL', 0.002),
  claimMinIntervalSeconds: num('CLAIM_MIN_INTERVAL_SECONDS', 15, 0, 3600),
  priorityFeeMicroLamports: num('PRIORITY_FEE_MICROLAMPORTS', 50000, 0, 50_000_000),
  /** Log what would be claimed and paid, but send nothing. */
  dryRun: bool('DRY_RUN', false),
  mockFeeLamportsPerMinute: sol('MOCK_FEE_SOL_PER_MINUTE', 0.6),
  priceUrl: env('PRICE_URL', 'https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112'),

  // ---- token
  token: {
    name: env('TOKEN_NAME', 'Heistmas'),
    symbol: env('TOKEN_SYMBOL', 'HEISTMAS'),
    mint: tokenMint,
    pumpUrl: tokenMint ? `https://pump.fun/coin/${tokenMint}` : null,
    links,
  },

  // ---- run checks
  antiCheat: env('ANTICHEAT', 'on') !== 'off',
  minFinishSeconds: num('MIN_FINISH_SECONDS', 40, 0, 3600),
  maxSpeed: num('MAX_SPEED', 24, 1, 1000),
  maxAvgSpeed: num('MAX_AVG_SPEED', 13.5, 1, 1000),
  /** Fairness: subtract up to this much of a player's measured one-way latency from their time. */
  maxLatencyCompMs: num('MAX_LATENCY_COMP_MS', 100, 0, 1000),
};

export type Config = typeof config;

export function explorerTx(sig: string) {
  if (config.chainMode === 'mock') return '';
  return `https://solscan.io/tx/${sig}${config.cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}

export function explorerTemplates() {
  const q = config.cluster === 'devnet' ? '?cluster=devnet' : '';
  return {
    tx: config.chainMode === 'mock' ? '' : `https://solscan.io/tx/{sig}${q}`,
    account: config.chainMode === 'mock' ? '' : `https://solscan.io/account/{addr}${q}`,
  };
}

export function validateLiveConfig() {
  const problems: string[] = [];
  if (!config.devWalletSecret) problems.push('DEV_WALLET_SECRET_KEY is empty');
  if (!config.token.mint) problems.push('TOKEN_MINT is empty');
  return problems;
}
