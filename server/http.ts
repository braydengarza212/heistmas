/**
 * HTTP side of the server: the built game (static files), a small JSON API
 * and the WebSocket endpoint at /ws.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import type { Config } from './config';
import type { Game } from './game';
import { AccountError, type Accounts } from './accounts';
import type { Store, UserRecord } from './store';
import type { Treasury } from './treasury';
import type { InfoResponse, LeaderboardResponse, Profile } from '../src/shared/protocol';
import { shortWallet } from '../src/shared/protocol';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export function createHttp(deps: { cfg: Config; game: Game; accounts: Accounts; store: Store; treasury: Treasury; log: (m: string) => void }) {
  const { cfg, game, accounts, store, treasury, log } = deps;
  const authHits = new Map<string, number[]>();

  const ipOf = (req: IncomingMessage) => {
    if (cfg.trustProxy) {
      const xf = req.headers['x-forwarded-for'];
      const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const originAllowed = (origin: string | undefined, host: string | undefined) => {
    if (!origin) return true;
    if (cfg.allowedOrigins.includes('*') || cfg.allowedOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(data);
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 8192) {
          reject(new Error('too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch {
          reject(new Error('bad json'));
        }
      });
      req.on('error', reject);
    });

  const limited = (ip: string, perMinute: number) => {
    const now = Date.now();
    const list = (authHits.get(ip) ?? []).filter((t) => now - t < 60_000);
    list.push(now);
    authHits.set(ip, list);
    return list.length > perMinute;
  };

  const profile = (u: UserRecord): Profile => ({
    username: u.username,
    wallet: u.wallet,
    createdAt: u.createdAt,
    wins: u.wins,
    podiums: u.podiums,
    wonLamports: u.wonLamports,
    bestTimeMs: u.bestTimeMs,
    roundsPlayed: u.roundsPlayed,
  });

  const bearer = (req: IncomingMessage) => {
    const h = req.headers.authorization ?? '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  };

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const ip = ipOf(req);
    if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, round: game.round.id, phase: game.round.phase, online: game.online() });
    if (req.method === 'GET' && path === '/api/info') {
      const body: InfoResponse = {
        config: game.publicConfig(),
        servers: game.serverList(),
        round: game.round,
        pot: treasury.state(),
        standings: game.standings(),
        lastResults: game.lastResults,
        now: Date.now(),
        playersOnline: game.online(),
      };
      return json(res, 200, body);
    }
    if (req.method === 'GET' && path === '/api/username') {
      const u = new URL(req.url ?? '', 'http://x').searchParams.get('u') ?? '';
      return json(res, 200, { available: accounts.available(u) });
    }
    if (req.method === 'POST' && (path === '/api/register' || path === '/api/login')) {
      if (limited(ip, cfg.authRequestsPerIpPerMinute)) return json(res, 429, { error: 'rate', message: 'Slow down a little and try again.' });
      let body: Record<string, unknown>;
      try {
        body = await readBody(req);
      } catch {
        return json(res, 400, { error: 'bad-request', message: 'Bad request.' });
      }
      try {
        const r =
          path === '/api/register'
            ? accounts.register(String(body.username ?? ''), String(body.wallet ?? ''), body.agree === true, ip)
            : accounts.login(String(body.username ?? ''), String(body.wallet ?? ''));
        if (path === '/api/register') log(`new player ${r.user.username} (${shortWallet(r.user.wallet)})`);
        return json(res, 200, { token: r.token, profile: profile(r.user) });
      } catch (e) {
        if (e instanceof AccountError) return json(res, 400, { error: e.code, message: e.message });
        throw e;
      }
    }
    if (req.method === 'GET' && path === '/api/me') {
      const u = accounts.byToken(bearer(req));
      if (!u) return json(res, 401, { error: 'auth', message: 'Please log in again.' });
      return json(res, 200, profile(u));
    }
    if (req.method === 'GET' && path === '/api/leaderboard') {
      const allTime = store
        .allUsers()
        .filter((u) => u.wonLamports > 0 || u.bestTimeMs !== null)
        .sort((a, b) => b.wonLamports - a.wonLamports || (a.bestTimeMs ?? Infinity) - (b.bestTimeMs ?? Infinity))
        .slice(0, 50)
        .map((u) => ({ username: u.username, wallet: shortWallet(u.wallet), wonLamports: u.wonLamports, wins: u.wins, podiums: u.podiums, bestTimeMs: u.bestTimeMs }));
      const body: LeaderboardResponse = { allTime, recent: store.rounds.data.results.slice(0, 20) };
      return json(res, 200, body);
    }
    if (req.method === 'GET' && path === '/api/admin/status') {
      if (!cfg.adminToken || bearer(req) !== cfg.adminToken) return json(res, 401, { error: 'auth' });
      return json(res, 200, {
        ...treasury.adminStatus(),
        round: game.round,
        servers: game.serverList(),
        flagged: store.rounds.data.flagged.slice(-50),
        users: store.userCount,
      });
    }
    return json(res, 404, { error: 'not-found' });
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    let rel = decodeURIComponent(path);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(cfg.publicDir, rel));
    if (!file.startsWith(cfg.publicDir + sep) && file !== cfg.publicDir) {
      res.writeHead(403).end();
      return;
    }
    let target = file;
    if (!existsSync(target) || !statSync(target).isFile()) {
      // single-page app: unknown paths get the game
      if (extname(rel)) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      target = join(cfg.publicDir, 'index.html');
      if (!existsSync(target)) {
        res.writeHead(503, { 'content-type': 'text/plain' }).end('The game has not been built yet. Run `npm run build`.');
        return;
      }
    }
    const immutable = rel.startsWith('/assets/');
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(target).pipe(res);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const origin = req.headers.origin;
    if (path.startsWith('/api/')) {
      if (origin && cfg.allowedOrigins.length && originAllowed(origin, req.headers.host)) {
        res.setHeader('access-control-allow-origin', cfg.allowedOrigins.includes('*') ? '*' : origin);
        res.setHeader('access-control-allow-headers', 'content-type, authorization');
        res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
        res.setHeader('vary', 'origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }
      api(req, res, path).catch((e) => {
        log(`api error on ${path}: ${(e as Error).stack ?? e}`);
        if (!res.headersSent) json(res, 500, { error: 'internal', message: 'Something went wrong.' });
      });
      return;
    }
    serveStatic(req, res, path);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws' || !originAllowed(req.headers.origin, req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => game.connect(ws, ipOf(req)));
  });

  return server;
}
