import type { Input } from '../core/Input';
import type { AudioEngine } from '../core/Audio';
import { TAU, angleDiff } from '../core/math';

function uiRoot() {
  return document.getElementById('ui')!;
}

/**
 * Arcade vault-cracking: stop the spinning needle inside the green zone
 * for each of the three tumblers.
 */
export class VaultCrack {
  private el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tumbler = 0;
  private angle = 0;
  private dir = 1;
  private target = 0;
  private width = 0.6;
  private speed = 2.4;
  private flash = 0;
  private flashColor = '#4dff8a';
  private armed = false;
  private done = false;
  private doneT = 0;
  private dialSpin = 0;
  onDial: ((a: number) => void) | null = null;
  onMiss: (() => void) | null = null;
  onSuccess: (() => void) | null = null;
  onCancel: (() => void) | null = null;

  constructor(
    private input: Input,
    private audio: AudioEngine,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'minigame crack';
    this.el.innerHTML = `
      <div class="mg-title">CRACK THE VAULT</div>
      <div class="mg-sub">Press <kbd>Space</kbd> / <kbd>E</kbd> / <kbd>Click</kbd> when the needle hits the <b class="g">green zone</b></div>
      <canvas width="440" height="440"></canvas>
      <div class="mg-pins"><span></span><span></span><span></span></div>
      <div class="mg-foot">Move <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to back away · misses raise your wanted level</div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
  }

  start() {
    uiRoot().appendChild(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
    this.setupTumbler();
  }

  private setupTumbler() {
    const i = this.tumbler;
    this.speed = [2.3, 3.0, 3.8][i];
    this.width = [0.66, 0.52, 0.42][i];
    this.dir = i % 2 === 0 ? 1 : -1;
    this.target = this.angle + this.dir * (1.6 + Math.random() * 2.6);
    this.updatePins();
  }

  private updatePins() {
    this.el.querySelectorAll('.mg-pins span').forEach((s, i) => s.classList.toggle('on', i < this.tumbler));
  }

  update(dt: number) {
    if (this.done) {
      this.doneT += dt;
      this.dialSpin += dt * 14;
      this.onDial?.(this.dialSpin);
      if (this.doneT > 0.7) {
        this.stop();
        this.onSuccess?.();
      }
      return;
    }
    this.angle += this.speed * this.dir * dt;
    this.onDial?.(-this.angle * 0.5);
    this.flash = Math.max(0, this.flash - dt * 3);
    if (!this.armed) {
      this.armed = true;
      return;
    }
    if (this.input.moveX !== 0 || this.input.moveY !== 0) {
      this.stop();
      this.onCancel?.();
      return;
    }
    if (this.input.wasPressed('Space', 'KeyE') || this.input.wasMousePressed(0)) {
      const d = Math.abs(angleDiff(this.angle, this.target));
      if (d < this.width / 2) {
        this.tumbler++;
        this.audio.play('tumbler', { pitch: 1 + this.tumbler * 0.12 });
        this.flash = 1;
        this.flashColor = '#4dff8a';
        this.updatePins();
        if (this.tumbler >= 3) {
          this.done = true;
          this.el.classList.add('cracked');
          this.audio.play('success', { volume: 0.7 });
        } else this.setupTumbler();
      } else {
        this.audio.play('fail');
        this.flash = 1;
        this.flashColor = '#ff4d5e';
        this.el.classList.remove('shake');
        void this.el.offsetWidth;
        this.el.classList.add('shake');
        this.target = this.angle + this.dir * (1.8 + Math.random() * 2.4);
        this.onMiss?.();
      }
    }
  }

  render() {
    const c = this.ctx;
    const W = 440;
    const cx = W / 2;
    const cy = W / 2;
    c.clearRect(0, 0, W, W);
    // outer ring
    const g = c.createRadialGradient(cx, cy, 60, cx, cy, 210);
    g.addColorStop(0, '#2a2f3a');
    g.addColorStop(0.75, '#151820');
    g.addColorStop(1, '#0b0d12');
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, 205, 0, TAU);
    c.fill();
    c.lineWidth = 14;
    c.strokeStyle = '#e8b647';
    c.stroke();
    // ticks
    c.strokeStyle = 'rgba(255,240,200,0.55)';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU;
      const r1 = 178;
      const r2 = i % 5 === 0 ? 156 : 166;
      c.lineWidth = i % 5 === 0 ? 4 : 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      c.stroke();
    }
    // green zone
    if (!this.done) {
      c.lineWidth = 34;
      c.strokeStyle = 'rgba(77,255,138,0.9)';
      c.shadowColor = '#4dff8a';
      c.shadowBlur = 24;
      c.beginPath();
      c.arc(cx, cy, 128, this.target - this.width / 2, this.target + this.width / 2);
      c.stroke();
      c.shadowBlur = 0;
    }
    // hub
    c.fillStyle = '#e8b647';
    c.beginPath();
    c.arc(cx, cy, 46, 0, TAU);
    c.fill();
    c.fillStyle = '#7a5410';
    c.font = 'bold 30px "Titan One", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`${Math.min(3, this.tumbler + 1)}/3`, cx, cy + 2);
    // needle
    const a = this.done ? this.dialSpin : this.angle;
    c.strokeStyle = '#ff3b4e';
    c.lineWidth = 10;
    c.lineCap = 'round';
    c.shadowColor = '#ff3b4e';
    c.shadowBlur = 16;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * 52, cy + Math.sin(a) * 52);
    c.lineTo(cx + Math.cos(a) * 168, cy + Math.sin(a) * 168);
    c.stroke();
    c.shadowBlur = 0;
    if (this.flash > 0) {
      c.globalAlpha = this.flash * 0.35;
      c.fillStyle = this.flashColor;
      c.beginPath();
      c.arc(cx, cy, 205, 0, TAU);
      c.fill();
      c.globalAlpha = 1;
    }
  }

  stop() {
    this.el.classList.remove('show');
    setTimeout(() => this.el.remove(), 250);
  }
}

const DIRS = [
  { code: ['KeyW', 'ArrowUp'], label: 'W', arrow: '↑' },
  { code: ['KeyA', 'ArrowLeft'], label: 'A', arrow: '←' },
  { code: ['KeyS', 'ArrowDown'], label: 'S', arrow: '↓' },
  { code: ['KeyD', 'ArrowRight'], label: 'D', arrow: '→' },
];

/** Terminal hack: type the arrow sequence before the timer runs out. */
export class TerminalHack {
  private el: HTMLDivElement;
  private seq: number[] = [];
  private idx = 0;
  private time = 0;
  private readonly limit = 6.5;
  private armed = false;
  private finished = false;
  onDone: ((ok: boolean) => void) | null = null;

  constructor(
    private input: Input,
    private audio: AudioEngine,
  ) {
    for (let i = 0; i < 6; i++) this.seq.push(Math.floor(Math.random() * 4));
    this.el = document.createElement('div');
    this.el.className = 'minigame hack';
    this.el.innerHTML = `
      <div class="mg-title">HACK THE SECURITY OS</div>
      <div class="mg-sub">Type the sequence with <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys</div>
      <div class="keys">${this.seq.map((d) => `<div class="keycap"><b>${DIRS[d].arrow}</b><small>${DIRS[d].label}</small></div>`).join('')}</div>
      <div class="timer"><i></i></div>`;
  }

  start() {
    uiRoot().appendChild(this.el);
    requestAnimationFrame(() => this.el.classList.add('show'));
  }

  update(dt: number) {
    if (this.finished) return;
    this.time += dt;
    const bar = this.el.querySelector('.timer i') as HTMLElement;
    bar.style.transform = `scaleX(${Math.max(0, 1 - this.time / this.limit)})`;
    if (!this.armed) {
      this.armed = true;
      return;
    }
    if (this.time >= this.limit) return this.end(false);
    for (let d = 0; d < 4; d++) {
      if (this.input.wasPressed(...DIRS[d].code)) {
        const caps = this.el.querySelectorAll('.keycap');
        if (d === this.seq[this.idx]) {
          caps[this.idx].classList.add('ok');
          this.idx++;
          this.audio.play('beep', { pitch: 1 + this.idx * 0.15 });
          if (this.idx >= this.seq.length) return this.end(true);
        } else {
          caps[this.idx]?.classList.add('bad');
          return this.end(false);
        }
        break;
      }
    }
  }

  private end(ok: boolean) {
    this.finished = true;
    this.el.classList.add(ok ? 'win' : 'lose');
    setTimeout(() => {
      this.stop();
      this.onDone?.(ok);
    }, ok ? 450 : 650);
  }

  stop() {
    this.el.classList.remove('show');
    setTimeout(() => this.el.remove(), 250);
  }
}
