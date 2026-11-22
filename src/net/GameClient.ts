import {
  PROTOCOL_VERSION,
  type ClientMsg,
  type ErrorCode,
  type PotState,
  type PublicConfig,
  type RoundResults,
  type RoundState,
  type ServerInfo,
  type ServerMsg,
  type Standings,
} from '../shared/protocol';
import { wsUrl } from './api';

type Listener = (m: ServerMsg) => void;

/**
 * Live connection to one game server. Keeps the latest round, pot and
 * standings, estimates the server clock, and reconnects after a dropped
 * connection (an attempt in progress continues on the server).
 */
export class GameClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private token = '';
  private wantOpen = false;
  private retries = 0;
  private pingTimer: number | null = null;
  private pings: { rtt: number; offset: number }[] = [];
  private outbox: ClientMsg[] = [];
  /** serverNow ≈ Date.now() + offset */
  offset = 0;
  connected = false;
  serverId = -1;
  round: RoundState | null = null;
  pot: PotState | null = null;
  standings: Standings | null = null;
  config: PublicConfig | null = null;
  server: ServerInfo | null = null;
  servers: ServerInfo[] = [];
  online = 0;
  you: { username: string; wallet: string } | null = null;
  results: { results: RoundResults; you: { rank: number | null; timeMs: number | null } } | null = null;
  bestMs: number | null = null;
  /** Shared world: the bank (instance) you were placed in. */
  bank: { id: number; name: string; you: number; players: number; capacity: number } | null = null;

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolves on welcome, or with the server's error code. */
  join(token: string, serverId: number): Promise<'ok' | ErrorCode | 'offline'> {
    this.close();
    this.token = token;
    this.serverId = serverId;
    this.wantOpen = true;
    this.retries = 0;
    return new Promise((resolve) => {
      let settled = false;
      const off = this.on((m) => {
        if (settled) return;
        if (m.t === 'welcome') {
          settled = true;
          off();
          resolve('ok');
        } else if (m.t === 'error') {
          settled = true;
          off();
          resolve(m.code);
        }
      });
      this.open(() => {
        if (!settled) {
          settled = true;
          off();
          resolve('offline');
        }
      });
    });
  }

  private open(onFail?: () => void) {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      onFail?.();
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      ws.send(JSON.stringify({ t: 'hello', token: this.token, server: this.serverId, v: PROTOCOL_VERSION } satisfies ClientMsg));
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      this.handle(m);
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (!opened) onFail?.();
      if (this.ws === ws) this.ws = null;
      if (this.wantOpen && (was || this.retries > 0)) {
        const delay = Math.min(10_000, 800 * 2 ** this.retries++);
        setTimeout(() => this.wantOpen && !this.ws && this.open(), delay);
        this.emit({ t: 'error', code: 'internal', msg: 'Reconnecting…' });
      }
    };
  }

  private handle(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.connected = true;
        this.retries = 0;
        this.you = m.you;
        this.server = m.server;
        this.round = m.round;
        this.pot = m.pot;
        this.standings = m.standings;
        this.config = m.config;
        this.bestMs = m.bestMs;
        this.offset = m.now - Date.now();
        this.pings = [];
        this.startPings();
        for (const msg of this.outbox.splice(0)) this.send(msg);
        break;
      case 'bank':
        this.bank = { id: m.id, name: m.name, you: m.you, players: m.players, capacity: m.capacity };
        break;
      case 'round':
        if (this.round && m.round.id !== this.round.id) this.bestMs = null;
        this.round = m.round;
        break;
      case 'pot':
        this.pot = m.pot;
        break;
      case 'standings':
        this.standings = m.standings;
        break;
      case 'servers':
        this.servers = m.list;
        this.online = m.online;
        if (this.server) this.server = m.list.find((s) => s.id === this.server!.id) ?? this.server;
        break;
      case 'results':
        this.results = { results: m.results, you: m.you };
        break;
      case 'payout':
        if (this.results && this.results.results.round === m.round) this.results.results.winners = m.winners;
        break;
      case 'finish':
        if (m.accepted) this.bestMs = m.timeMs;
        break;
      case 'pong': {
        const now = Date.now();
        const rtt = now - m.c;
        this.pings.push({ rtt, offset: m.s + rtt / 2 - now });
        if (this.pings.length > 8) this.pings.shift();
        this.offset = this.pings.reduce((best, p) => (p.rtt < best.rtt ? p : best)).offset;
        break;
      }
      case 'error':
        if (m.code === 'replaced' || m.code === 'auth' || m.code === 'version' || m.code === 'full' || m.code === 'bad-server' || m.code === 'ip-limit') this.wantOpen = false;
        break;
    }
    this.emit(m);
  }

  private emit(m: ServerMsg) {
    for (const fn of [...this.listeners]) fn(m);
  }

  private startPings() {
    const ping = () => this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ t: 'ping', c: Date.now() } satisfies ClientMsg));
    ping();
    setTimeout(ping, 1000);
    setTimeout(ping, 2500);
    this.pingTimer = window.setInterval(ping, 15_000);
  }

  /** Messages sent while reconnecting are queued (traces keep the run alive). */
  send(m: ClientMsg) {
    if (this.ws?.readyState === 1 && this.connected) this.ws.send(JSON.stringify(m));
    else if (this.wantOpen && (m.t === 'trace' || m.t === 'ev' || m.t === 'finish' || m.t === 'attempt')) {
      this.outbox.push(m);
      if (this.outbox.length > 400) this.outbox.shift();
    }
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  /** Converts a server timestamp to this tab's performance.now() clock. */
  toPerf(serverMs: number) {
    return performance.now() + (serverMs - this.serverNow());
  }

  close() {
    this.wantOpen = false;
    this.connected = false;
    this.outbox = [];
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= 1) ws.close();
  }
}
