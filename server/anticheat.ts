/**
 * Plausibility checks for one attempt at the heist.
 *
 * The game runs in the player's browser, so the server cannot see the run
 * itself. Instead the client streams its position (4 samples a second) and
 * key events, and this checker asks whether that report could have happened:
 *   - it starts at the spawn point and the clock is not running fast,
 *   - speeds stay within what sprinting, sliding and knockbacks allow,
 *   - no teleports except respawns at checkpoints,
 *   - zones are entered in a physically connected order, through every stage,
 *     and the roof / street only through the hatch and the zipline,
 *   - the vault was cracked at the vault door before entering the vault,
 *   - loot pickups happen where the player was and add up to the minimum,
 *   - the finish is inside the getaway ring and not faster than the floor.
 *
 * A determined cheater can still forge a consistent report, so these checks
 * raise the bar rather than make cheating impossible (see README).
 */
import { BANK, BANK_ADJACENT, BANK_CHECKPOINTS, BANK_GATES, BANK_LAST_STAGE, inBox, zoneAt } from '../src/shared/bankLayout';
import type { ClientEvent } from '../src/shared/protocol';

export interface CheckLimits {
  maxSpeed: number;
  maxAvgSpeed: number;
  minFinishMs: number;
}

interface Sample {
  ms: number;
  x: number;
  y: number;
  z: number;
}

const SPAWN = BANK.spawn.pos;
const WINDOW_MS = 4000;

export class RunCheck {
  readonly reasons: string[] = [];
  private samples = 0;
  private last: Sample | null = null;
  private window: Sample[] = [];
  private lastZone: string | null = null;
  private stageFirstMs = new Array<number>(BANK_LAST_STAGE + 1).fill(-1);
  private respawnAtMs = -1e9;
  private cracked = false;
  private crackMs = -1;
  private loot = 0;
  private speedSpikes = 0;
  private avgViolations = 0;
  private maxGapMs = 0;
  private clientMsMax = 0;
  private finished = false;

  constructor(
    readonly attempt: number,
    /** Server time the attempt was announced. */
    readonly startedAt: number,
    private limits: CheckLimits,
  ) {}

  get failed() {
    return this.reasons.length > 0;
  }

  private flag(r: string) {
    if (!this.reasons.includes(r)) this.reasons.push(r);
  }

  /** Flat [ms, x, y, z, …] in client milliseconds since the attempt began. */
  addSamples(flat: number[], arrival: number) {
    if (this.finished) return;
    if (!Array.isArray(flat) || flat.length % 4 !== 0 || flat.length > 4 * 40) {
      this.flag('malformed trace');
      return;
    }
    for (let i = 0; i < flat.length; i += 4) {
      const s: Sample = { ms: flat[i], x: flat[i + 1], y: flat[i + 2], z: flat[i + 3] };
      if (![s.ms, s.x, s.y, s.z].every(Number.isFinite)) {
        this.flag('malformed trace');
        return;
      }
      this.addSample(s);
    }
    // The client's clock may lag the server's (network), never run ahead of it.
    const serverElapsed = arrival - this.startedAt;
    if (this.clientMsMax > serverElapsed * 1.08 + 1500) this.flag('client clock running fast');
  }

  private addSample(s: Sample) {
    const prev = this.last;
    if (!prev) {
      const d = Math.hypot(s.x - SPAWN[0], s.z - SPAWN[2]);
      if (d > 12) this.flag('did not start at the spawn point');
    } else {
      const dt = (s.ms - prev.ms) / 1000;
      if (dt <= 0) {
        this.flag('trace out of order');
        return;
      }
      this.maxGapMs = Math.max(this.maxGapMs, s.ms - prev.ms);
      const dist = Math.hypot(s.x - prev.x, s.z - prev.z);
      const speed = dist / dt;
      const respawned = Math.abs(s.ms - this.respawnAtMs) < 1500 && nearCheckpoint(s);
      if (!respawned && speed > this.limits.maxSpeed) {
        if (speed > this.limits.maxSpeed * 1.6 || dist > 12) this.flag('teleported');
        else if (++this.speedSpikes > 6) this.flag('too fast');
      }
      // sustained speed over a few seconds (no respawn inside the window)
      this.window.push(s);
      while (this.window.length > 2 && s.ms - this.window[0].ms > WINDOW_MS) this.window.shift();
      const w0 = this.window[0];
      const span = (s.ms - w0.ms) / 1000;
      if (span > WINDOW_MS / 1000 - 0.6 && s.ms - this.respawnAtMs > WINDOW_MS) {
        const avg = Math.hypot(s.x - w0.x, s.z - w0.z) / span;
        if (avg > this.limits.maxAvgSpeed && ++this.avgViolations > 3) this.flag('sustained speed too high');
      }
    }
    this.samples++;
    this.clientMsMax = Math.max(this.clientMsMax, s.ms);
    this.last = s;
    if (!prev) this.window = [s];

    const z = zoneAt(s.x, s.y, s.z);
    if (z && z.id !== this.lastZone) {
      const settled = Math.abs(s.ms - this.respawnAtMs) > 1500;
      if (this.lastZone && !(BANK_ADJACENT[this.lastZone] ?? []).includes(z.id) && settled) {
        this.flag(`impossible route ${this.lastZone}→${z.id}`);
      }
      const gate = this.lastZone ? BANK_GATES[`${this.lastZone}>${z.id}`] : undefined;
      if (gate && settled && !inBox(gate, s.x, s.y, s.z)) this.flag(`impossible route ${this.lastZone}→${z.id}`);
      if (this.stageFirstMs[z.stage] < 0) this.stageFirstMs[z.stage] = s.ms;
      this.lastZone = z.id;
    }
  }

  addEvent(e: ClientEvent) {
    if (this.finished) return;
    if (!Number.isFinite(e.ms)) {
      this.flag('malformed event');
      return;
    }
    switch (e.k) {
      case 'pickup': {
        if (!Number.isFinite(e.v) || e.v < 0 || e.v > BANK.maxPickupValue) {
          this.flag('impossible loot value');
          return;
        }
        const l = this.last;
        if (l) {
          const slack = 5 + (Math.abs(e.ms - l.ms) / 1000) * 14;
          if (Math.hypot(e.x - l.x, e.z - l.z) > slack) this.flag('picked up loot far away');
        }
        this.loot += e.v;
        break;
      }
      case 'drop':
        if (Number.isFinite(e.v) && e.v > 0) this.loot = Math.max(0, this.loot - e.v);
        break;
      case 'crack':
        if (this.lastZone !== 'ante') this.flag('cracked the vault from elsewhere');
        this.cracked = true;
        this.crackMs = e.ms;
        break;
      case 'respawn':
        if (!nearCheckpoint(e)) this.flag('respawned off a checkpoint');
        this.respawnAtMs = e.ms;
        break;
      default:
        this.flag('unknown event');
    }
  }

  /** Returns true when the run counts. `elapsedMs` is server-measured since the round started. */
  finish(clientMs: number, reportedLoot: number, elapsedMs: number) {
    this.finished = true;
    const l = this.last;
    if (!l || this.samples < 8) this.flag('no trace');
    else {
      const ex = BANK.extraction;
      if (Math.hypot(l.x - ex.x, l.z - ex.z) > ex.radius + 2) this.flag('finished away from the getaway');
      if (Math.abs(clientMs - l.ms) > 2500) this.flag('trace stopped before the finish');
      // expect roughly 4 samples a second across the attempt
      if (this.samples < (l.ms / 1000) * 2) this.flag('trace too sparse');
    }
    if (this.maxGapMs > 5000) this.flag('trace has gaps');
    for (let st = 1; st <= BANK_LAST_STAGE; st++) if (this.stageFirstMs[st] < 0) this.flag(`skipped stage ${st}`);
    for (let st = 2; st <= BANK_LAST_STAGE; st++) if (this.stageFirstMs[st] >= 0 && this.stageFirstMs[st] < this.stageFirstMs[st - 1]) this.flag('stages out of order');
    if (!this.cracked) this.flag('vault never cracked');
    if (this.stageFirstMs[5] >= 0 && this.crackMs > this.stageFirstMs[5]) this.flag('entered the vault before cracking it');
    if (this.loot < BANK.minLoot) this.flag('not enough loot');
    if (Math.abs(reportedLoot - this.loot) > Math.max(1000, this.loot * 0.1)) this.flag('loot total mismatch');
    if (elapsedMs < this.limits.minFinishMs) this.flag('faster than the minimum time');
    return !this.failed;
  }
}

function nearCheckpoint(p: { x: number; y: number; z: number }) {
  return BANK_CHECKPOINTS.some((c) => Math.hypot(p.x - c.pos[0], p.z - c.pos[2]) < 4);
}
