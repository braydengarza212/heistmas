/**
 * Servers, players and the round clock.
 *
 * All servers race in the same synchronized round. A "server" is a room of
 * up to MAX_PLAYERS_PER_SERVER connections; there are SERVER_COUNT of them.
 * Times are measured by this process from the moment the round goes live,
 * and the fastest verified finishes across every server win the pot.
 */
import type { WebSocket } from 'ws';
import type { Config } from './config';
import type { Store, UserRecord } from './store';
import type { Accounts } from './accounts';
import type { Treasury } from './treasury';
import { RunCheck } from './anticheat';
import {
  PROTOCOL_VERSION,
  type ClientMsg,
  type ErrorCode,
  type PublicConfig,
  type RoundResults,
  type RoundState,
  type ServerInfo,
  type ServerMsg,
  type Standings,
  type Winner,
} from '../src/shared/protocol';
import { explorerTemplates } from './config';
import { World, type WorldMember } from './world';

export interface Client {
  id: number;
  ws: WebSocket;
  ip: string;
  user: UserRecord | null;
  room: Room | null;
  rtts: number[];
  pingAt: number;
  alive: boolean;
  msgs: number;
  msgWindow: number;
  strikes: number;
  /** Shared-world presence (set on join). */
  w: WorldMember | null;
}

export interface Room {
  id: number;
  name: string;
  capacity: number;
  clients: Set<Client>;
}

interface Entry {
  userId: string;
  username: string;
  wallet: string;
  timeMs: number;
  server: number;
  at: number;
}

const SETTLE_GRACE_MS = 1500;

export class Game {
  readonly rooms: Room[];
  readonly clients = new Set<Client>();
  round!: RoundState;
  private entries = new Map<string, Entry>();
  /** Attempt in progress per player (survives a reconnect). */
  private runs = new Map<string, RunCheck>();
  private participants = new Set<string>();
  private standingsDirty = true;
  private lastStandingsJson = '';
  lastResults: RoundResults | null = null;
  private nextClientId = 1;
  private timers: NodeJS.Timeout[] = [];
  private settling: Promise<void> | null = null;
  private potTimer: NodeJS.Timeout | null = null;
  private potQueued: { msg: ServerMsg } | null = null;
  readonly world: World;

  constructor(
    private cfg: Config,
    private store: Store,
    private accounts: Accounts,
    private treasury: Treasury,
    private log: (m: string) => void,
  ) {
    this.world = new World(cfg.bankCapacity);
    this.rooms = cfg.serverNames.map((name, i) => ({ id: i, name, capacity: cfg.maxPlayersPerServer, clients: new Set() }));
    this.lastResults = store.rounds.data.results[0] ?? null;
    treasury.onChange = (pot, flash) => this.queuePot({ t: 'pot', pot, flash });
    treasury.onPayoutUpdate = (round, winners) => this.onPayoutUpdate(round, winners);
  }

  // ------------------------------------------------------------- lifecycle
  start() {
    const now = Date.now();
    const id = this.store.rounds.data.lastRoundId + 1;
    const startsAt = now + Math.min(this.cfg.intermissionSeconds, 20) * 1000;
    this.round = this.makeRound(id, 'waiting', startsAt);
    this.treasury.currentRound = id;
    this.timers.push(setInterval(() => this.tick(), 200));
    this.timers.push(setInterval(() => this.flushStandings(), 1000));
    this.timers.push(setInterval(() => this.broadcast({ t: 'servers', list: this.serverList(), online: this.online() }), 5000));
    this.timers.push(setInterval(() => this.heartbeat(), 10_000));
    this.world.start();
    this.log(`round ${id} starts in ${Math.round((startsAt - now) / 1000)}s · ${this.rooms.length} servers × ${this.cfg.maxPlayersPerServer} players`);
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.world.stop();
    for (const c of this.clients) c.ws.close(1001, 'server restarting');
  }

  private makeRound(id: number, phase: RoundState['phase'], startsAt: number): RoundState {
    return {
      id,
      phase,
      startsAt,
      endsAt: startsAt + this.cfg.roundSeconds * 1000,
      lateJoinUntil: startsAt + this.cfg.lateJoinSeconds * 1000,
      nextStartsAt: null,
    };
  }

  private tick() {
    const now = Date.now();
    const r = this.round;
    if (r.phase === 'waiting' && now >= r.startsAt) {
      r.phase = 'live';
      this.log(`round ${r.id} live`);
      this.broadcast({ t: 'round', round: r });
    } else if (r.phase === 'live' && now >= r.endsAt) {
      r.phase = 'settling';
      r.nextStartsAt = r.endsAt + this.cfg.intermissionSeconds * 1000;
      this.broadcast({ t: 'round', round: r });
      const id = r.id;
      setTimeout(() => {
        this.runs.clear();
        this.settling = this.settle(id).finally(() => (this.settling = null));
      }, SETTLE_GRACE_MS);
    } else if ((r.phase === 'settling' || r.phase === 'results') && r.nextStartsAt !== null && now >= r.nextStartsAt) {
      this.round = this.makeRound(r.id + 1, 'live', r.nextStartsAt);
      this.entries.clear();
      this.runs.clear();
      this.participants.clear();
      this.standingsDirty = true;
      this.treasury.currentRound = this.round.id;
      this.log(`round ${this.round.id} live`);
      this.broadcast({ t: 'round', round: this.round });
      this.queuePot({ t: 'pot', pot: this.treasury.state() });
    }
  }

  private ranked() {
    return [...this.entries.values()].sort((a, b) => a.timeMs - b.timeMs || a.at - b.at);
  }

  private async settle(id: number) {
    const ranked = this.ranked();
    const players = this.participants.size;
    let results: RoundResults;
    try {
      const res = await this.treasury.settle(id, ranked);
      results = {
        round: id,
        potLamports: res.potLamports,
        winners: res.winners,
        rolledOverLamports: res.rolledOverLamports,
        finishers: ranked.length,
        players,
        endedAt: Date.now(),
      };
    } catch (e) {
      this.log(`round ${id}: settlement error: ${(e as Error).message}`);
      results = { round: id, potLamports: 0, winners: [], rolledOverLamports: this.treasury.potLamports(), finishers: ranked.length, players, endedAt: Date.now() };
    }
    // player stats
    for (const uid of this.participants) {
      const u = this.store.userById(uid);
      if (u) u.roundsPlayed++;
    }
    for (const e of ranked) {
      const u = this.store.userById(e.userId);
      if (u && (u.bestTimeMs === null || e.timeMs < u.bestTimeMs)) u.bestTimeMs = e.timeMs;
    }
    this.store.touchUsers();
    const log = this.store.rounds.data;
    log.lastRoundId = Math.max(log.lastRoundId, id);
    log.results.unshift(results);
    if (log.results.length > 200) log.results.length = 200;
    this.store.rounds.touch();
    this.lastResults = results;
    if (this.round.id === id) {
      this.round.phase = 'results';
      this.broadcast({ t: 'round', round: this.round });
    }
    const rankOf = new Map(ranked.map((e, i) => [e.userId, { rank: i + 1, timeMs: e.timeMs }]));
    for (const c of this.clients) {
      if (!c.user || !c.room) continue;
      const me = rankOf.get(c.user.id);
      this.send(c, { t: 'results', results, you: { rank: me?.rank ?? null, timeMs: me?.timeMs ?? null } });
    }
    const w = results.winners.map((x) => `${x.place}. ${x.username} ${(x.lamports / 1e9).toFixed(4)} SOL ${x.status}`).join(' · ');
    this.log(`round ${id} over: ${ranked.length} finishers of ${players} · pot ${(results.potLamports / 1e9).toFixed(6)} SOL · ${w || 'no winners'}`);
  }

  private onPayoutUpdate(round: number, winners: Winner[]) {
    const res = this.store.rounds.data.results.find((r) => r.round === round);
    if (res) {
      for (const w of winners) {
        const target = res.winners.find((x) => x.place === w.place);
        if (target) Object.assign(target, { status: w.status, signature: w.signature });
      }
      this.store.rounds.touch();
    }
    this.broadcast({ t: 'payout', round, winners: res?.winners ?? winners });
  }

  // -------------------------------------------------------------- views
  serverList(): ServerInfo[] {
    return this.rooms.map((r) => ({ id: r.id, name: r.name, players: r.clients.size, capacity: r.capacity }));
  }

  online() {
    let n = 0;
    for (const r of this.rooms) n += r.clients.size;
    return n;
  }

  standings(): Standings {
    const top = this.ranked()
      .slice(0, 10)
      .map((e, i) => ({ rank: i + 1, username: e.username, timeMs: e.timeMs, server: e.server }));
    return { round: this.round.id, top, finishers: this.entries.size, players: this.participants.size };
  }

  publicConfig(): PublicConfig {
    const ex = explorerTemplates();
    const st = this.treasuryStatus();
    return {
      token: this.cfg.token,
      devWallet: st.devWallet,
      split: this.cfg.split,
      houseCutPercent: this.cfg.houseCutPercent,
      roundSeconds: this.cfg.roundSeconds,
      intermissionSeconds: this.cfg.intermissionSeconds,
      lateJoinSeconds: this.cfg.lateJoinSeconds,
      capacity: this.cfg.maxPlayersPerServer,
      serverCount: this.rooms.length,
      chain: this.cfg.chainMode === 'mock' ? 'mock' : this.cfg.cluster,
      explorerTx: ex.tx,
      explorerAccount: ex.account,
      minFinishSeconds: this.cfg.minFinishSeconds,
    };
  }

  treasuryStatus = () => ({ devWallet: null as string | null });

  // ------------------------------------------------------------ messaging
  private queuePot(msg: ServerMsg) {
    // at most ~3 pot updates a second; a claim flash always goes out
    if (this.potTimer) {
      if (!this.potQueued || (msg as { flash?: number }).flash) this.potQueued = { msg };
      return;
    }
    this.broadcast(msg);
    this.potTimer = setTimeout(() => {
      this.potTimer = null;
      if (this.potQueued) {
        const m = this.potQueued.msg;
        this.potQueued = null;
        this.queuePot(m);
      }
    }, 350);
  }

  private flushStandings() {
    if (!this.standingsDirty) return;
    this.standingsDirty = false;
    const json = JSON.stringify({ t: 'standings', standings: this.standings() } satisfies ServerMsg);
    if (json === this.lastStandingsJson) return;
    this.lastStandingsJson = json;
    for (const c of this.clients) if (c.room) c.ws.send(json);
  }

  broadcast(msg: ServerMsg) {
    const json = JSON.stringify(msg);
    for (const c of this.clients) if (c.room && c.ws.readyState === 1) c.ws.send(json);
  }

  private send(c: Client, msg: ServerMsg) {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }

  private fail(c: Client, code: ErrorCode, msg: string, close = false) {
    this.send(c, { t: 'error', code, msg });
    if (close) c.ws.close(4000, code);
  }

  // ---------------------------------------------------------- connections
  connect(ws: WebSocket, ip: string) {
    let sameIp = 0;
    for (const c of this.clients) if (c.ip === ip) sameIp++;
    const client: Client = { id: this.nextClientId++, ws, ip, user: null, room: null, rtts: [], pingAt: 0, alive: true, msgs: 0, msgWindow: Date.now(), strikes: 0, w: null };
    this.clients.add(client);
    ws.on('close', () => this.disconnect(client));
    ws.on('error', () => this.disconnect(client));
    if (sameIp >= this.cfg.maxConnectionsPerIp) {
      this.fail(client, 'ip-limit', 'Too many connections from your network.', true);
      return client;
    }
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      this.onMessage(client, data.toString());
    });
    ws.on('pong', () => {
      client.alive = true;
      if (client.pingAt) {
        client.rtts.push(Date.now() - client.pingAt);
        if (client.rtts.length > 6) client.rtts.shift();
      }
    });
    return client;
  }

  private disconnect(c: Client) {
    if (!this.clients.delete(c)) return;
    c.room?.clients.delete(c);
    c.room = null;
    if (c.w) this.world.leave(c.w);
  }

  private heartbeat() {
    const now = Date.now();
    for (const c of this.clients) {
      if (!c.alive) {
        c.ws.terminate();
        this.disconnect(c);
        continue;
      }
      c.alive = false;
      c.pingAt = now;
      try {
        c.ws.ping();
      } catch {
        /* closing */
      }
    }
  }

  private onMessage(c: Client, raw: string) {
    const now = Date.now();
    if (now - c.msgWindow > 1000) {
      if (c.msgs > 80 && ++c.strikes >= 3) return this.fail(c, 'rate', 'Too many messages.', true);
      c.msgs = 0;
      c.msgWindow = now;
    }
    c.msgs++;
    if (raw.length > 16_384) return;
    let m: ClientMsg;
    try {
      m = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'hello':
        return this.hello(c, m);
      case 'ping':
        return this.send(c, { t: 'pong', c: Number(m.c) || 0, s: now });
      case 'attempt':
        return this.attempt(c, m.a);
      case 'trace': {
        const run = c.user ? this.runs.get(c.user.id) : undefined;
        if (run && run.attempt === m.a) run.addSamples(m.s, now);
        return;
      }
      case 'ev': {
        const run = c.user ? this.runs.get(c.user.id) : undefined;
        if (run && run.attempt === m.a) run.addEvent(m);
        return;
      }
      case 'finish':
        return this.finish(c, m.a, m.ms, m.loot, now);
      case 'look':
        if (c.w) this.world.setLook(c.w, m.o);
        return;
      case 'st':
        if (c.w) this.world.setState(c.w, m.s, now);
        return;
      case 'shot':
        if (c.w) this.world.shot(c.w, m.w, m.o, m.d, now);
        return;
      case 'hit':
        if (c.w) this.world.hit(c.w, m.v, m.w, now);
        return;
    }
  }

  private hello(c: Client, m: Extract<ClientMsg, { t: 'hello' }>) {
    if (m.v !== PROTOCOL_VERSION) return this.fail(c, 'version', 'The game was updated. Refresh the page to play.', true);
    const user = this.accounts.byToken(m.token);
    if (!user) return this.fail(c, 'auth', 'Please log in again.', true);
    const room = this.rooms[Number(m.server)];
    if (!room) return this.fail(c, 'bad-server', 'That server does not exist.', true);
    for (const other of this.clients) {
      if (other !== c && other.user?.id === user.id) {
        this.fail(other, 'replaced', 'You joined from another tab or device.', true);
        this.disconnect(other);
      }
    }
    if (room.clients.size >= room.capacity && c.room !== room) return this.fail(c, 'full', `${room.name} is full. Pick another server.`, true);
    c.room?.clients.delete(c);
    c.user = user;
    c.room = room;
    room.clients.add(c);
    this.send(c, {
      t: 'welcome',
      you: { username: user.username, wallet: user.wallet },
      server: { id: room.id, name: room.name, players: room.clients.size, capacity: room.capacity },
      round: this.round,
      pot: this.treasury.state(),
      standings: this.standings(),
      config: this.publicConfig(),
      now: Date.now(),
      bestMs: this.entries.get(user.id)?.timeMs ?? null,
    });
    // shared world: join the fullest bank on this server that has room
    const w = this.world.member(user.username, (msg) => {
      if (c.ws.readyState === 1) c.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    });
    if (c.w) this.world.leave(c.w);
    c.w = w;
    this.world.join(room.id, room.name, w);
    if (this.lastResults && (this.round.phase === 'results' || this.round.phase === 'settling')) {
      const me = this.lastResults.winners.find((w) => w.username === user.username);
      this.send(c, { t: 'results', results: this.lastResults, you: { rank: me ? me.place : null, timeMs: me ? me.timeMs : null } });
    }
  }

  private attempt(c: Client, a: number) {
    const now = Date.now();
    const r = this.round;
    if (!c.user || !c.room) return this.fail(c, 'auth', 'Join a server first.');
    if (r.phase === 'waiting' && now >= r.startsAt - 1000) this.tick(); // client clock reached GO a moment before our tick
    if (this.round.phase !== 'live' || now >= this.round.endsAt) return this.fail(c, 'phase', 'The round is not running right now.');
    if (this.entries.has(c.user.id)) return this.fail(c, 'phase', 'You already escaped this round.');
    // No server-side late-join cutoff: every time counts from the round's start,
    // so starting late never helps. (LATE_JOIN_SECONDS steers the client instead.)
    this.participants.add(c.user.id);
    this.standingsDirty = true;
    const existing = this.runs.get(c.user.id);
    if (existing && existing.attempt === Number(a)) return; // re-sent after a reconnect: keep the run going
    this.runs.set(c.user.id, new RunCheck(Number(a) || 0, now, { maxSpeed: this.cfg.maxSpeed, maxAvgSpeed: this.cfg.maxAvgSpeed, minFinishMs: this.cfg.minFinishSeconds * 1000 }));
  }

  private finish(c: Client, a: number, clientMs: number, loot: number, now: number) {
    const r = this.round;
    const run = c.user ? this.runs.get(c.user.id) : undefined;
    if (!c.user || !c.room || !run || run.attempt !== a) {
      if (c.user) this.log(`round ${r.id}: finish from ${c.user.username} without a matching run (attempt ${a})`);
      return this.send(c, { t: 'finish', a, accepted: false, timeMs: 0, rank: null, note: 'No run in progress.' });
    }
    this.runs.delete(c.user.id);
    const sorted = [...c.rtts].sort((x, y) => x - y);
    const oneWay = sorted.length ? sorted[Math.floor(sorted.length / 2)] / 2 : 0;
    const elapsed = Math.round(now - r.startsAt - Math.min(oneWay, this.cfg.maxLatencyCompMs));
    if (elapsed > this.cfg.roundSeconds * 1000 || (r.phase !== 'live' && r.phase !== 'settling') || this.settling) {
      return this.send(c, { t: 'finish', a, accepted: false, timeMs: elapsed, rank: null, note: 'The round ended before you escaped.' });
    }
    const ok = this.cfg.antiCheat ? run.finish(Number(clientMs), Number(loot), elapsed) : true;
    if (!ok) {
      this.log(`round ${r.id}: run by ${c.user.username} not accepted: ${run.reasons.join('; ')}`);
      const f = this.store.rounds.data.flagged;
      f.push({ round: r.id, username: c.user.username, reasons: run.reasons, at: now });
      if (f.length > 500) f.splice(0, f.length - 500);
      this.store.rounds.touch();
      return this.send(c, { t: 'finish', a, accepted: false, timeMs: elapsed, rank: null, note: 'Your run could not be verified, so it does not count for prizes.' });
    }
    if (!this.entries.has(c.user.id)) {
      this.entries.set(c.user.id, { userId: c.user.id, username: c.user.username, wallet: c.user.wallet, timeMs: elapsed, server: c.room.id, at: now });
      this.standingsDirty = true;
    }
    const rank = this.ranked().findIndex((e) => e.userId === c.user!.id) + 1;
    this.send(c, { t: 'finish', a, accepted: true, timeMs: this.entries.get(c.user.id)!.timeMs, rank });
  }
}
