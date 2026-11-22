/**
 * Shared world: robbers on a server are split into banks of up to
 * BANK_CAPACITY. Inside a bank everyone runs the same Christmas Bank: each
 * client streams its state 10 times a second and the server relays, to every
 * player, the robbers nearest to them (interest management keeps traffic
 * flat however full the bank is). Snowball shots are relayed so nearby
 * players see them, and hits on players are checked here before the victim
 * is frozen.
 *
 * Guards, loot and weapon pickups stay local to each client.
 */
import {
  FLAG_FROZEN,
  NET_WEAPONS,
  PLAYER_FREEZE_MS,
  SNAP_STRIDE,
  STATE_FIELDS,
  type ServerMsg,
} from '../src/shared/protocol';

/** Players visible to each robber, nearest first. */
export const VIEW_MAX = 40;
/** …within this many metres. */
export const VIEW_RADIUS = 95;
/** A state older than this hides the robber (tab in background, lag). */
const STALE_MS = 3000;
const LOOK_RE = /^[a-z0-9._-]{1,32}(\|[a-z0-9._-]{1,32}){3}$/;

export interface WorldMember {
  /** Player id inside the shared world (never reused while the process runs). */
  pid: number;
  username: string;
  look: string;
  bank: Bank | null;
  /** Latest state (STATE_FIELDS ints) and when it arrived. */
  st: Int32Array;
  stAt: number;
  /** Ids this client has been sent a roster entry for. */
  known: Set<number>;
  /** Snowballs fired recently (server ms) with the hits each may still cause. */
  shots: { at: number; w: number; left: number }[];
  shotWindow: number;
  shotsInWindow: number;
  frozenUntil: number;
  send: (m: ServerMsg | string) => void;
}

export interface Bank {
  id: number;
  name: string;
  capacity: number;
  members: Set<WorldMember>;
}

export class World {
  private nextPid = 1;
  private nextBankId = 1;
  /** Banks per server room id. */
  private banks = new Map<number, Bank[]>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private bankCapacity: number) {}

  start() {
    this.timer = setInterval(() => this.tick(), 100);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  member(username: string, send: WorldMember['send']): WorldMember {
    return {
      pid: this.nextPid++,
      username,
      look: '',
      bank: null,
      st: new Int32Array(STATE_FIELDS),
      stAt: 0,
      known: new Set(),
      shots: [],
      shotWindow: 0,
      shotsInWindow: 0,
      frozenUntil: 0,
      send,
    };
  }

  /** Puts a member in the fullest bank of the room that still has space (so banks fill up). */
  join(room: number, roomName: string, m: WorldMember) {
    this.leave(m);
    let list = this.banks.get(room);
    if (!list) this.banks.set(room, (list = []));
    let bank: Bank | null = null;
    for (const b of list) if (b.members.size < b.capacity && (!bank || b.members.size > bank.members.size)) bank = b;
    if (!bank) {
      const n = list.length + 1;
      bank = { id: this.nextBankId++, name: `${roomName} · Bank ${n}`, capacity: this.bankCapacity, members: new Set() };
      list.push(bank);
    }
    bank.members.add(m);
    m.bank = bank;
    m.known.clear();
    m.stAt = 0;
    m.send({ t: 'bank', id: bank.id, name: bank.name, you: m.pid, players: bank.members.size, capacity: bank.capacity });
    return bank;
  }

  leave(m: WorldMember) {
    const bank = m.bank;
    if (!bank) return;
    bank.members.delete(m);
    m.bank = null;
    const msg = JSON.stringify({ t: 'ros', add: [], del: [m.pid] } satisfies ServerMsg);
    for (const o of bank.members) {
      if (o.known.delete(m.pid)) o.send(msg);
    }
  }

  setLook(m: WorldMember, look: unknown) {
    if (typeof look === 'string' && LOOK_RE.test(look)) m.look = look;
    // a new heist on the client: send the roster again
    m.known.clear();
  }

  setState(m: WorldMember, s: unknown, now: number) {
    if (!m.bank || !Array.isArray(s) || s.length !== STATE_FIELDS) return;
    for (let i = 0; i < STATE_FIELDS; i++) {
      const v = s[i];
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e6) return;
    }
    for (let i = 0; i < STATE_FIELDS; i++) m.st[i] = Math.round(s[i] as number);
    // the server, not the client, decides who is frozen
    if (now < m.frozenUntil) m.st[7] |= FLAG_FROZEN;
    else m.st[7] &= ~FLAG_FROZEN;
    m.stAt = now;
  }

  /** A shot: rate-limited, then shown to nearby robbers. */
  shot(m: WorldMember, w: unknown, o: unknown, d: unknown, now: number) {
    if (!m.bank || m.stAt === 0) return void this.reject('shot before any state');
    const wi = Number(w);
    const wd = NET_WEAPONS[wi];
    if (!wd || !vec3(o) || !vec3(d)) return void this.reject('bad shot');
    if (now - m.shotWindow > 1000) {
      m.shotWindow = now;
      m.shotsInWindow = 0;
    }
    if (++m.shotsInWindow > 16) return;
    const ox = (o as number[])[0];
    const oz = (o as number[])[2];
    // the muzzle must be where the shooter is
    if (Math.hypot(ox - m.st[0] / 10, oz - m.st[2] / 10) > 6) return void this.reject(`shot muzzle ${ox},${oz} far from shooter ${m.st[0] / 10},${m.st[2] / 10}`);
    m.shots.push({ at: now, w: wi, left: wd.hits });
    while (m.shots.length > 24) m.shots.shift();
    const msg = JSON.stringify({
      t: 'shot',
      id: m.pid,
      w: wi,
      o: (o as number[]).map(r2),
      d: (d as number[]).map(r3),
    } satisfies ServerMsg);
    const r2max = VIEW_RADIUS * VIEW_RADIUS;
    for (const other of m.bank.members) {
      if (other === m || now - other.stAt > STALE_MS) continue;
      const dx = (other.st[0] - m.st[0]) / 10;
      const dz = (other.st[2] - m.st[2]) / 10;
      if (dx * dx + dz * dz < r2max) other.send(msg);
    }
  }

  /**
   * The shooter's client says its snowball hit `v`. Accepted if the shooter
   * fired that weapon in the last few seconds with hits to spare, the victim
   * is in the same bank, within the weapon's range, and not already frozen.
   */
  /** Last rejected hit and why (debugging). */
  lastReject = '';

  hit(m: WorldMember, v: unknown, w: unknown, now: number): boolean {
    const bank = m.bank;
    if (!bank) return false;
    const victim = [...bank.members].find((x) => x.pid === Number(v));
    if (!victim || victim === m || now - victim.stAt > STALE_MS) return this.reject('victim missing or stale');
    const wi = Number(w);
    const shot = m.shots.find((s) => s.w === wi && s.left > 0 && now - s.at < 6000);
    if (!shot) return this.reject(`no matching shot (shots: ${m.shots.map((s) => `${s.w}@${now - s.at}ms`).join(',') || 'none'})`);
    const range = NET_WEAPONS[wi].range;
    const dx = victim.st[0] / 10 - m.st[0] / 10;
    const dy = victim.st[1] / 10 - m.st[1] / 10;
    const dz = victim.st[2] / 10 - m.st[2] / 10;
    if (Math.hypot(dx, dy, dz) > range + 8) return this.reject('out of range');
    // frozen players can't be frozen again, and get a short grace period afterwards
    if (now < victim.frozenUntil + 1500) return this.reject('already frozen');
    shot.left--;
    victim.frozenUntil = now + PLAYER_FREEZE_MS;
    victim.st[7] |= FLAG_FROZEN;
    const len = Math.hypot(dx, dz) || 1;
    if (process.env.DEBUG_WORLD) console.log(`[world] ${m.username} froze ${victim.username} (pid ${victim.pid})`);
    victim.send({ t: 'hitby', id: m.pid, by: m.username, w: wi, dx: r3(dx / len), dz: r3(dz / len) });
    return true;
  }

  private reject(why: string) {
    this.lastReject = why;
    if (process.env.DEBUG_WORLD) console.log(`[world] hit rejected: ${why}`);
    return false;
  }

  private tick() {
    const now = Date.now();
    for (const list of this.banks.values()) {
      for (const bank of list) if (bank.members.size) this.tickBank(bank, now);
    }
  }

  private tickBank(bank: Bank, now: number) {
    const live: WorldMember[] = [];
    for (const m of bank.members) {
      if (now >= m.frozenUntil) m.st[7] &= ~FLAG_FROZEN;
      if (m.stAt && now - m.stAt < STALE_MS) live.push(m);
    }
    const r2max = VIEW_RADIUS * VIEW_RADIUS;
    const near: { m: WorldMember; d: number }[] = [];
    for (const me of live) {
      near.length = 0;
      const x = me.st[0] / 10;
      const z = me.st[2] / 10;
      for (const o of live) {
        if (o === me) continue;
        const dx = o.st[0] / 10 - x;
        const dz = o.st[2] / 10 - z;
        const d = dx * dx + dz * dz;
        if (d < r2max) near.push({ m: o, d });
      }
      if (near.length > VIEW_MAX) {
        near.sort((a, b) => a.d - b.d);
        near.length = VIEW_MAX;
      }
      const add: [number, string, string][] = [];
      const flat: number[] = [];
      for (const { m: o } of near) {
        if (!me.known.has(o.pid)) {
          me.known.add(o.pid);
          add.push([o.pid, o.username, o.look]);
        }
        flat.push(o.pid);
        for (let i = 0; i < STATE_FIELDS; i++) flat.push(o.st[i]);
      }
      if (add.length) me.send({ t: 'ros', add, del: [] });
      me.send({ t: 'pl', ts: now, n: live.length, p: flat });
    }
    void SNAP_STRIDE;
  }

  /** For tests and the server list. */
  bankSizes(room: number) {
    return (this.banks.get(room) ?? []).map((b) => b.members.size);
  }
}

function vec3(v: unknown) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e5);
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
