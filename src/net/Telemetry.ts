import type * as THREE from 'three';
import type { GameClient } from './GameClient';
import type { ClientEvent } from '../shared/protocol';

type EventBody = ClientEvent extends infer E ? (E extends { ms: number } ? Omit<E, 'ms'> : never) : never;

/**
 * Streams one attempt to the game server: four position samples a second
 * (sent once a second), plus loot, vault and respawn events, and the finish.
 * Uses a timer rather than animation frames so samples keep flowing while
 * the tab is in the background (the run is paused then, but the clock isn't).
 */
export class Telemetry {
  private buf: number[] = [];
  private lastMs = -1;
  private readonly t0 = performance.now();
  private timer: number;
  private flushes = 0;
  private stopped = false;
  private begun = false;
  private pending: (() => void)[] = [];

  constructor(
    private client: GameClient,
    readonly attempt: number,
    private position: () => THREE.Vector3,
  ) {
    this.sample();
    this.timer = window.setInterval(() => {
      this.sample();
      if (++this.flushes % 4 === 0) this.flush();
    }, 250);
  }

  private ms() {
    return Math.round(performance.now() - this.t0);
  }

  private sample() {
    const ms = this.ms();
    if (ms <= this.lastMs) return;
    const p = this.position();
    this.lastMs = ms;
    this.buf.push(ms, round2(p.x), round2(p.y), round2(p.z));
  }

  /**
   * Announces the attempt to the server. Called once the server says the
   * round is live; anything recorded before that is sent right after.
   */
  begin() {
    if (this.begun) return;
    this.begun = true;
    this.client.send({ t: 'attempt', a: this.attempt });
    this.flush();
    for (const fn of this.pending.splice(0)) fn();
  }

  get started() {
    return this.begun;
  }

  private later(fn: () => void) {
    if (this.begun) fn();
    else this.pending.push(fn);
  }

  private flush() {
    if (!this.begun || !this.buf.length) return;
    this.client.send({ t: 'trace', a: this.attempt, s: this.buf });
    this.buf = [];
  }

  /**
   * Sends the current position first so the server sees where the event
   * happened. Pickups skip the extra trace message: coin piles can mean
   * dozens of pickups a second.
   */
  event(e: EventBody) {
    if (this.stopped) return;
    this.sample();
    if (e.k !== 'pickup') this.flush();
    const msg = { t: 'ev', a: this.attempt, ms: this.ms(), ...e } as Extract<Parameters<GameClient['send']>[0], { t: 'ev' }>;
    this.later(() => this.client.send(msg));
  }

  finish(loot: number) {
    if (this.stopped) return;
    this.sample();
    this.flush();
    const msg = { t: 'finish' as const, a: this.attempt, ms: this.ms(), loot };
    this.later(() => this.client.send(msg));
    this.stop();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.flush();
    clearInterval(this.timer);
  }

  get running() {
    return !this.stopped;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
