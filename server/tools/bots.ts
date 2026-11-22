/**
 * Load and integration test: a swarm of scripted players.
 *
 *   npx tsx server/tools/bots.ts --url http://localhost:8080 --bots 200 --server spread
 *
 * Each bot registers, joins a server, waits for the round to go live and
 * runs a plausible route through the bank (real-time position stream,
 * vault crack, loot pickups) to the getaway ring. Options make some bots
 * cheat (teleport) or give up, so the run checks can be watched too.
 *
 * For a local test, start the server with relaxed limits, e.g.:
 *   ROUND_SECONDS=60 INTERMISSION_SECONDS=10 MIN_FINISH_SECONDS=15 \
 *   REGISTRATIONS_PER_IP_PER_HOUR=100000 AUTH_REQUESTS_PER_IP_PER_MINUTE=100000 \
 *   MAX_CONNECTIONS_PER_IP=100000 npm start
 */
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMsg, type RoundState, formatSol } from '../../src/shared/protocol';
import { ROUTE, CRACK_AT, PICKUPS } from './route';

const require = createRequire(import.meta.url);
const { Keypair } = require('@solana/web3.js') as typeof import('@solana/web3.js');

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');
const URL_ = args.get('url') ?? 'http://localhost:8080';
const N = Number(args.get('bots') ?? 50);
const SERVER = args.get('server') ?? 'spread'; // spread | <id>
const CHEATERS = Number(args.get('cheaters') ?? 0);
const QUITTERS = Number(args.get('quitters') ?? 0);
const ROUNDS = Number(args.get('rounds') ?? 1);
const PREFIX = args.get('prefix') ?? 'bot' + Math.floor(Math.random() * 1e5);
const SPEED_MIN = Number(args.get('speedMin') ?? 8.2);
const SPEED_MAX = Number(args.get('speedMax') ?? 9.6);
const WS_URL = URL_.replace(/^http/, 'ws') + '/ws';
/** Shared world: stream positions 10×/s (and wander around the start line before the round). */
const WORLD = (args.get('world') ?? '1') !== '0';
/** Bots that fire a snowball every few seconds (seen by nearby robbers). */
const SHOOTERS = Number(args.get('shooters') ?? 0);
const LOOKS = ['skin.criminal', 'skin.elf', 'skin.snowman', 'skin.ninja', 'skin.humbug', 'skin.golden'];
const worldStats = { bytes: 0, pl: 0, maxSeen: 0, bankMsgs: new Map<string, number>() };

interface Bot {
  name: string;
  token: string;
  ws: WebSocket | null;
  server: number;
  kind: 'normal' | 'cheater' | 'quitter';
  speed: number;
  attempt: number;
  running: boolean;
  t0: number;
  seg: number;
  segT: number;
  pos: [number, number, number];
  buf: number[];
  sampleT: number;
  crackWait: number;
  picked: Set<number>;
  loot: number;
  finished: boolean;
  result: 'accepted' | 'rejected' | null;
  rank: number | null;
  /** Where the bot idles before the round (spread over the start line). */
  home: [number, number, number];
  yaw: number;
  shooter: boolean;
  shotT: number;
}

const stats = { registered: 0, connected: 0, full: 0, errors: new Map<string, number>(), accepted: 0, rejected: 0, results: 0, pot: 0 };
let round: RoundState | null = null;
let roundsSeen = 0;
let lastResultsRound = -1;
let startedAt = Date.now();

async function register(i: number): Promise<{ name: string; token: string }> {
  const name = `${PREFIX}_${i}`.slice(0, 16);
  const wallet = Keypair.generate().publicKey.toBase58();
  const res = await fetch(`${URL_}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, wallet, agree: true }) });
  const j = (await res.json()) as { token?: string; message?: string };
  if (!j.token) throw new Error(`register ${name}: ${j.message}`);
  stats.registered++;
  return { name, token: j.token };
}

function connect(b: Bot) {
  return new Promise<void>((resolve) => {
    const ws = new WebSocket(WS_URL);
    b.ws = ws;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', token: b.token, server: b.server, v: PROTOCOL_VERSION })));
    ws.on('message', (raw) => {
      const str = raw.toString();
      worldStats.bytes += str.length;
      const m = JSON.parse(str) as ServerMsg;
      switch (m.t) {
        case 'welcome':
          stats.connected++;
          round = m.round;
          if (WORLD) ws.send(JSON.stringify({ t: 'look', o: `${LOOKS[Math.floor(Math.random() * LOOKS.length)]}|mask.bandit|hat.auto|sack.burlap` }));
          resolve();
          break;
        case 'error':
          stats.errors.set(m.code, (stats.errors.get(m.code) ?? 0) + 1);
          if (m.code === 'full') stats.full++;
          resolve();
          break;
        case 'round':
          round = m.round;
          break;
        case 'bank':
          worldStats.bankMsgs.set(m.name, (worldStats.bankMsgs.get(m.name) ?? 0) + 1);
          break;
        case 'pl':
          worldStats.pl++;
          worldStats.maxSeen = Math.max(worldStats.maxSeen, m.p.length / 9);
          break;
        case 'pot':
          stats.pot = m.pot.lamports + m.pot.pendingLamports;
          break;
        case 'finish':
          b.result = m.accepted ? 'accepted' : 'rejected';
          b.rank = m.rank;
          if (m.accepted) stats.accepted++;
          else stats.rejected++;
          break;
        case 'results':
          if (m.results.round !== lastResultsRound) {
            lastResultsRound = m.results.round;
            stats.results++;
            const r = m.results;
            console.log(`\nROUND ${r.round} RESULTS · pot ${formatSol(r.potLamports, 6)} SOL · ${r.finishers}/${r.players} escaped · rolled over ${formatSol(r.rolledOverLamports, 6)}`);
            for (const w of r.winners) console.log(`  #${w.place} ${w.username.padEnd(16)} ${(w.timeMs / 1000).toFixed(2)}s  ${formatSol(w.lamports, 6)} SOL  ${w.status}  ${w.signature ?? ''}`);
          }
          break;
        case 'payout':
          console.log(`  payout update round ${m.round}: ${m.winners.map((w) => `${w.username} ${w.status}`).join(', ')}`);
          break;
      }
    });
    ws.on('close', () => resolve());
    ws.on('error', () => resolve());
  });
}

function sendState(b: Bot, moving: boolean) {
  if (!WORLD || b.ws?.readyState !== 1) return;
  const p = b.running ? b.pos : b.home;
  b.ws.send(JSON.stringify({ t: 'st', s: [Math.round(p[0] * 10), Math.round(p[1] * 10), Math.round(p[2] * 10), Math.round(b.yaw * 100), moving ? 1 : 0, moving ? Math.round(b.speed * 10) : 0, b.shooter ? 1 : 0, 0] }));
  if (b.shooter) {
    b.shotT -= 0.1;
    if (b.shotT <= 0) {
      b.shotT = 2 + Math.random() * 3;
      const a = Math.random() * Math.PI * 2;
      b.ws.send(JSON.stringify({ t: 'shot', w: 0, o: [p[0], p[1] + 0.6, p[2]], d: [Math.sin(a), 0.05, Math.cos(a)] }));
    }
  }
}

function startRun(b: Bot) {
  b.attempt++;
  b.running = true;
  b.finished = false;
  b.result = null;
  b.t0 = Date.now();
  b.seg = 0;
  b.segT = 0;
  b.pos = [ROUTE[0][0], ROUTE[0][1], ROUTE[0][2]];
  b.buf = [];
  b.sampleT = 0;
  b.crackWait = 0;
  b.picked = new Set();
  b.loot = 0;
  b.ws?.send(JSON.stringify({ t: 'attempt', a: b.attempt }));
}

function flush(b: Bot) {
  if (b.buf.length && b.ws?.readyState === 1) b.ws.send(JSON.stringify({ t: 'trace', a: b.attempt, s: b.buf }));
  b.buf = [];
}

function step(b: Bot, dt: number) {
  if (!b.running || !b.ws || b.ws.readyState !== 1) return;
  const ms = Date.now() - b.t0;
  if (b.kind === 'quitter' && ms > 6000) {
    b.running = false; // gave up (or got busted) — never finishes
    return;
  }
  if (b.crackWait > 0) b.crackWait -= dt;
  else if (b.seg < ROUTE.length - 1) {
    const a = ROUTE[b.seg];
    const c = ROUTE[b.seg + 1];
    const len = Math.hypot(c[0] - a[0], c[2] - a[2]);
    b.segT += (b.speed * dt) / len;
    if (b.kind === 'cheater' && b.seg === 4) {
      b.seg = ROUTE.length - 2; // teleport ahead
      b.segT = 0.99;
    }
    while (b.segT >= 1 && b.seg < ROUTE.length - 1) {
      b.segT -= 1;
      b.seg++;
      if (b.seg === CRACK_AT) {
        // report where we are right now, then the crack
        const q = ROUTE[b.seg];
        b.buf.push(ms, q[0], q[1], q[2]);
        b.sampleT = -0.25;
        flush(b);
        b.ws.send(JSON.stringify({ t: 'ev', a: b.attempt, k: 'crack', ms }));
        b.crackWait = 2.2; // the vault door swings open
        b.segT = 0;
      }
      const p = PICKUPS.find((pp) => pp.at === b.seg);
      if (p && !b.picked.has(p.at)) {
        b.picked.add(p.at);
        b.loot += p.v;
        const q = ROUTE[b.seg];
        flush(b);
        b.ws.send(JSON.stringify({ t: 'ev', a: b.attempt, k: 'pickup', ms, v: p.v, x: q[0], y: q[1], z: q[2] }));
      }
    }
    if (b.seg < ROUTE.length - 1) {
      const a2 = ROUTE[b.seg];
      const c2 = ROUTE[b.seg + 1];
      b.yaw = Math.atan2(c2[0] - a2[0], c2[2] - a2[2]);
      b.pos = [a2[0] + (c2[0] - a2[0]) * b.segT, a2[1] + (c2[1] - a2[1]) * b.segT, a2[2] + (c2[2] - a2[2]) * b.segT];
    } else b.pos = [ROUTE[ROUTE.length - 1][0], ROUTE[ROUTE.length - 1][1], ROUTE[ROUTE.length - 1][2]];
  }
  b.sampleT += dt;
  if (b.sampleT >= 0.25) {
    b.sampleT -= 0.25;
    b.buf.push(ms, +b.pos[0].toFixed(2), +b.pos[1].toFixed(2), +b.pos[2].toFixed(2));
  }
  if (b.seg >= ROUTE.length - 1 && !b.finished) {
    b.finished = true;
    b.running = false;
    flush(b);
    b.ws.send(JSON.stringify({ t: 'finish', a: b.attempt, ms, loot: b.loot }));
  }
}

async function main() {
  console.log(`registering ${N} bots…`);
  const bots: Bot[] = [];
  const batch = 50;
  for (let i = 0; i < N; i += batch) {
    const creds = await Promise.all(Array.from({ length: Math.min(batch, N - i) }, (_, k) => register(i + k)));
    for (const [k, c] of creds.entries()) {
      const idx = i + k;
      bots.push({
        ...c,
        ws: null,
        server: SERVER === 'spread' ? idx % 10 : Number(SERVER),
        kind: idx < CHEATERS ? 'cheater' : idx < CHEATERS + QUITTERS ? 'quitter' : 'normal',
        speed: SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN),
        attempt: 0,
        running: false,
        t0: 0,
        seg: 0,
        segT: 0,
        pos: [0, 0, 0],
        buf: [],
        sampleT: 0,
        crackWait: 0,
        picked: new Set(),
        loot: 0,
        finished: false,
        result: null,
        rank: null,
        home: [ROUTE[0][0] + (Math.random() - 0.5) * 14, ROUTE[0][1], ROUTE[0][2] + (Math.random() - 0.5) * 6],
        yaw: Math.PI + (Math.random() - 0.5) * 1.2,
        shooter: idx >= N - SHOOTERS,
        shotT: Math.random() * 3,
      });
    }
  }
  console.log(`connecting…`);
  startedAt = Date.now();
  for (let i = 0; i < bots.length; i += 100) await Promise.all(bots.slice(i, i + 100).map(connect));
  console.log(`connected ${stats.connected}, rejected ${[...stats.errors].map(([k, v]) => `${k}:${v}`).join(' ') || 'none'}`);

  let lastRoundStarted = -1;
  let prev = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const dt = (now - prev) / 1000;
    prev = now;
    if (round && round.phase === 'live' && round.id !== lastRoundStarted && now >= round.startsAt) {
      lastRoundStarted = round.id;
      roundsSeen++;
      console.log(`round ${round.id} live — ${bots.filter((b) => b.ws?.readyState === 1).length} bots racing`);
      for (const b of bots) if (b.ws?.readyState === 1) startRun(b);
    }
    for (const b of bots) step(b, dt);
    for (const b of bots) sendState(b, b.running);
    if (Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000)) for (const b of bots) flush(b);
  }, 100);

  const waitDone = setInterval(() => {
    if (stats.results >= ROUNDS) {
      clearInterval(waitDone);
      clearInterval(timer);
      const secs = (Date.now() - startedAt) / 1000;
      console.log(`\nshared world: ${[...worldStats.bankMsgs].map(([k, v]) => `${k}: ${v}`).join(', ')} · max robbers in view ${worldStats.maxSeen} · ${(worldStats.bytes / secs / 1024 / Math.max(1, stats.connected)).toFixed(1)} KB/s per bot downstream`);
      console.log(`\nsummary: registered ${stats.registered}, connected ${stats.connected}, finishes accepted ${stats.accepted}, rejected ${stats.rejected}, rounds ${stats.results}`);
      setTimeout(() => {
        for (const b of bots) b.ws?.close();
        process.exit(0);
      }, 1500);
    }
  }, 500);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
