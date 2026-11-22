/**
 * Fully synthesized audio: every sound effect and the adaptive music are
 * generated with the Web Audio API at runtime — no audio files to host.
 */

export type Sfx =
  | 'coin'
  | 'present'
  | 'gold'
  | 'diamond'
  | 'jump'
  | 'land'
  | 'dive'
  | 'slide'
  | 'hit'
  | 'zap'
  | 'spotted'
  | 'suspicious'
  | 'click'
  | 'tumbler'
  | 'fail'
  | 'vault'
  | 'clang'
  | 'crash'
  | 'whistle'
  | 'stun'
  | 'checkpoint'
  | 'hover'
  | 'select'
  | 'success'
  | 'busted'
  | 'door'
  | 'tick'
  | 'engine'
  | 'heal'
  | 'star'
  | 'unlock'
  | 'beep'
  | 'slam'
  | 'rev'
  | 'skid'
  | 'crashBig'
  | 'press'
  | 'steam'
  | 'hiss'
  | 'boing'
  | 'zip'
  | 'drawer'
  | 'horn'
  | 'blaster'
  | 'splat';

type MusicMode = 'off' | 'menu' | 'heist';

const NOTE: Record<string, number> = {};
(() => {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (let o = 0; o <= 8; o++) {
    names.forEach((n, i) => {
      const midi = (o + 1) * 12 + i;
      NOTE[n + o] = 440 * Math.pow(2, (midi - 69) / 12);
    });
  }
})();
const hz = (n: string) => NOTE[n] ?? 0;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private comp!: DynamicsCompressorNode;
  private noise!: AudioBuffer;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private vol = { master: 0.8, music: 0.55, sfx: 0.9 };

  private musicMode: MusicMode = 'off';
  private intensity = 0;
  private schedTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private siren: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;
  private rotor: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  private lastPlay = new Map<string, number>();

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.build();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private build() {
    const ctx = this.ctx!;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Small synthetic room reverb for the bank's marble halls.
    this.reverb = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.18;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    this.applyVolumes();
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.vol = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  // ------------------------------------------------------------------ helpers
  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    t: number,
    dur: number,
    vol: number,
    dest: AudioNode,
    attack = 0.005,
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, attack, vol, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  private noiseBurst(
    t: number,
    dur: number,
    vol: number,
    dest: AudioNode,
    filter: BiquadFilterType,
    f0: number,
    f1 = f0,
    q = 1,
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bf = ctx.createBiquadFilter();
    bf.type = filter;
    bf.Q.value = q;
    bf.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) bf.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    src.connect(bf).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /** FM bell — used for pickups, chimes and the music box. */
  private bell(f: number, t: number, dur: number, vol: number, dest: AudioNode, ratio = 3.5, index = 2.2) {
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const g = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * ratio;
    modGain.gain.setValueAtTime(f * index, t);
    modGain.gain.exponentialRampToValueAtTime(f * 0.05, t + dur);
    mod.connect(modGain).connect(car.frequency);
    this.env(g, t, 0.003, vol, dur);
    car.connect(g).connect(dest);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.1);
    mod.stop(t + dur + 0.1);
  }

  private out(pan = 0, wet = true) {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.sfxBus);
    if (wet) p.connect(this.reverbSend);
    return p;
  }

  // -------------------------------------------------------------------- SFX
  play(name: Sfx, opts: { pitch?: number; volume?: number; pan?: number } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // Rate-limit identical sounds so piles of coins don't clip.
    const last = this.lastPlay.get(name) ?? 0;
    if (now - last < 0.03) return;
    this.lastPlay.set(name, now);

    const p = opts.pitch ?? 1;
    const v = opts.volume ?? 1;
    const o = this.out(opts.pan ?? 0);
    const t = now + 0.005;
    switch (name) {
      case 'coin':
        this.tone('square', 1318 * p, 1318 * p, t, 0.05, 0.05 * v, o);
        this.tone('sine', 1975 * p, 1975 * p, t + 0.055, 0.22, 0.12 * v, o);
        break;
      case 'present':
        [0, 4, 7, 12].forEach((s, i) =>
          this.bell(hz('C6') * Math.pow(2, s / 12) * p, t + i * 0.045, 0.35, 0.09 * v, o),
        );
        break;
      case 'gold':
        this.bell(hz('E6') * p, t, 0.5, 0.12 * v, o, 2.76, 3);
        this.bell(hz('B6') * p, t + 0.07, 0.6, 0.1 * v, o, 2.76, 3);
        this.noiseBurst(t, 0.05, 0.05 * v, o, 'highpass', 6000);
        break;
      case 'diamond':
        [0, 2, 4, 7, 9, 12, 16].forEach((s, i) =>
          this.bell(hz('E6') * Math.pow(2, s / 12) * p, t + i * 0.05, 0.5, 0.07 * v, o, 4.1, 1.5),
        );
        break;
      case 'jump':
        this.tone('sine', 240 * p, 560 * p, t, 0.14, 0.22 * v, o, 0.004);
        this.tone('triangle', 480 * p, 900 * p, t, 0.08, 0.05 * v, o);
        break;
      case 'land':
        this.tone('sine', 120, 50, t, 0.1, 0.35 * v, o, 0.002);
        this.noiseBurst(t, 0.07, 0.12 * v, o, 'lowpass', 900);
        break;
      case 'dive':
        this.noiseBurst(t, 0.28, 0.22 * v, o, 'bandpass', 500, 2600, 1.5);
        this.tone('sine', 300, 180, t, 0.2, 0.1 * v, o);
        break;
      case 'slide':
        this.noiseBurst(t, 0.45, 0.14 * v, o, 'bandpass', 1800, 600, 0.9);
        break;
      case 'hit':
        this.tone('square', 220, 70, t, 0.18, 0.18 * v, o, 0.002);
        this.noiseBurst(t, 0.12, 0.25 * v, o, 'lowpass', 1400);
        this.tone('sine', 900, 1400, t + 0.05, 0.25, 0.05 * v, o);
        break;
      case 'zap':
        this.tone('sawtooth', 1400, 110, t, 0.22, 0.14 * v, o, 0.002);
        this.noiseBurst(t, 0.18, 0.15 * v, o, 'highpass', 2500);
        break;
      case 'spotted':
        this.tone('square', hz('A5'), hz('A5'), t, 0.08, 0.09 * v, o);
        this.tone('square', hz('E6'), hz('E6'), t + 0.1, 0.22, 0.1 * v, o);
        this.tone('sawtooth', hz('E5'), hz('E5'), t + 0.1, 0.22, 0.04 * v, o);
        break;
      case 'suspicious':
        this.tone('triangle', hz('D5'), hz('G5'), t, 0.18, 0.12 * v, o);
        break;
      case 'click':
        this.noiseBurst(t, 0.03, 0.25 * v, o, 'highpass', 4000);
        this.tone('square', 2200, 1800, t, 0.03, 0.04 * v, o);
        break;
      case 'tumbler':
        this.tone('square', 1100, 900, t, 0.04, 0.08 * v, o);
        this.tone('sine', 380, 360, t + 0.02, 0.18, 0.2 * v, o);
        this.bell(hz('G6'), t + 0.03, 0.3, 0.06 * v, o);
        break;
      case 'fail':
        for (let i = 0; i < 3; i++) this.tone('square', 110, 104, t + i * 0.09, 0.07, 0.11 * v, o);
        break;
      case 'vault': {
        this.tone('sine', 70, 38, t, 1.6, 0.6 * v, o, 0.01);
        this.noiseBurst(t, 1.8, 0.2 * v, o, 'lowpass', 300, 80);
        this.tone('sawtooth', 90, 140, t + 0.4, 1.4, 0.05 * v, o, 0.3);
        for (let i = 0; i < 6; i++) this.noiseBurst(t + 0.05 + i * 0.12, 0.05, 0.18 * v, o, 'bandpass', 3000, 3000, 6);
        break;
      }
      case 'clang':
        [1, 2.76, 5.4, 8.9].forEach((m, i) => this.tone('sine', 420 * m * p, 420 * m * p, t, 0.6 - i * 0.1, 0.09 * v, o));
        this.noiseBurst(t, 0.06, 0.2 * v, o, 'highpass', 3000);
        break;
      case 'crash':
        this.noiseBurst(t, 0.35, 0.25 * v, o, 'highpass', 3000, 7000);
        for (let i = 0; i < 6; i++) {
          const f = 2000 + Math.random() * 4000;
          this.tone('sine', f, f, t + Math.random() * 0.15, 0.25, 0.04 * v, o);
        }
        break;
      case 'whistle': {
        const ctx = this.ctx;
        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        const g = ctx.createGain();
        osc.frequency.value = 2300 * p;
        lfo.frequency.value = 28;
        lg.gain.value = 140;
        lfo.connect(lg).connect(osc.frequency);
        this.env(g, t, 0.01, 0.07 * v, 0.45);
        osc.connect(g).connect(o);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + 0.5);
        lfo.stop(t + 0.5);
        break;
      }
      case 'stun':
        this.tone('square', 320, 120, t, 0.12, 0.14 * v, o, 0.002);
        this.tone('sine', 1800, 900, t + 0.1, 0.45, 0.07 * v, o);
        this.tone('sine', 2100, 1100, t + 0.2, 0.4, 0.05 * v, o);
        break;
      case 'checkpoint':
        this.bell(hz('G5'), t, 0.5, 0.1 * v, o);
        this.bell(hz('D6'), t + 0.1, 0.7, 0.1 * v, o);
        break;
      case 'hover':
        this.tone('sine', 900, 1100, t, 0.04, 0.035 * v, this.out(0, false));
        break;
      case 'select':
        this.tone('sine', 520, 1040, t, 0.09, 0.12 * v, this.out(0, false), 0.003);
        this.bell(hz('C6'), t + 0.03, 0.25, 0.05 * v, this.out(0, false));
        break;
      case 'success':
        [hz('C5'), hz('E5'), hz('G5'), hz('C6')].forEach((f, i) => this.bell(f, t + i * 0.11, 0.8, 0.1 * v, o));
        [hz('C4'), hz('G4'), hz('E5')].forEach((f) => this.tone('triangle', f, f, t + 0.45, 1.2, 0.07 * v, o, 0.02));
        break;
      case 'busted': {
        const notes = [hz('G4'), hz('F#4'), hz('F4'), hz('E4')];
        notes.forEach((f, i) => {
          const dur = i === 3 ? 1.0 : 0.32;
          this.tone('sawtooth', f, i === 3 ? f * 0.94 : f, t + i * 0.36, dur, 0.09 * v, o, 0.02);
          this.tone('square', f / 2, f / 2, t + i * 0.36, dur, 0.04 * v, o, 0.02);
        });
        break;
      }
      case 'door':
        this.noiseBurst(t, 0.5, 0.12 * v, o, 'lowpass', 1800, 400);
        this.tone('sine', 140, 90, t, 0.4, 0.08 * v, o);
        break;
      case 'tick':
        this.tone('square', 1500, 1500, t, 0.03, 0.05 * v, this.out(0, false));
        break;
      case 'beep':
        this.tone('sine', 880 * p, 880 * p, t, 0.08, 0.08 * v, this.out(0, false));
        break;
      case 'engine':
        this.tone('sawtooth', 55, 160, t, 2.2, 0.16 * v, o, 0.2);
        this.noiseBurst(t + 0.3, 2.4, 0.25 * v, o, 'bandpass', 300, 2500, 0.7);
        break;
      case 'heal':
        [0, 7, 12].forEach((s, i) => this.bell(hz('A5') * Math.pow(2, s / 12), t + i * 0.08, 0.5, 0.08 * v, o, 2, 1));
        break;
      case 'star':
        this.tone('square', hz('E5'), hz('E5'), t, 0.06, 0.07 * v, o);
        this.tone('square', hz('B5'), hz('B5'), t + 0.07, 0.12, 0.07 * v, o);
        break;
      case 'unlock':
        [0, 4, 7, 11, 14].forEach((s, i) => this.bell(hz('D6') * Math.pow(2, s / 12), t + i * 0.06, 0.6, 0.08 * v, o));
        break;
      case 'slam':
        // heavy van door: low thump, latch clack, panel rattle
        this.tone('sine', 120, 48, t, 0.28, 0.45 * v, o, 0.002);
        this.noiseBurst(t, 0.12, 0.35 * v, o, 'lowpass', 900, 200);
        this.noiseBurst(t + 0.015, 0.05, 0.22 * v, o, 'bandpass', 2600, 2600, 4);
        this.tone('square', 310, 280, t + 0.02, 0.12, 0.03 * v, o);
        break;
      case 'rev': {
        // engine revving up: detuned saws through a sweeping lowpass
        const ctx = this.ctx;
        const g = ctx.createGain();
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(300, t);
        f.frequency.exponentialRampToValueAtTime(2400, t + 0.7);
        f.frequency.exponentialRampToValueAtTime(900, t + 1.6);
        f.Q.value = 2;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.22 * v, t + 0.15);
        g.gain.setValueAtTime(0.22 * v, t + 1.1);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
        f.connect(g).connect(o);
        for (const det of [0, 7, -5]) {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(48 + det, t);
          osc.frequency.exponentialRampToValueAtTime(190 + det * 2, t + 0.65);
          osc.frequency.exponentialRampToValueAtTime(150 + det, t + 1.8);
          osc.connect(f);
          osc.start(t);
          osc.stop(t + 2);
        }
        this.noiseBurst(t, 1.6, 0.06 * v, o, 'bandpass', 180, 600, 1.2);
        break;
      }
      case 'skid': {
        // tire squeal: narrow band of noise wobbling in pitch
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 18;
        bp.frequency.setValueAtTime(2100 * p, t);
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 9;
        lg.gain.value = 180;
        lfo.connect(lg).connect(bp.frequency);
        const g = ctx.createGain();
        this.env(g, t, 0.04, 0.32 * v, 0.55);
        src.connect(bp).connect(g).connect(o);
        src.start(t, Math.random());
        src.stop(t + 0.65);
        lfo.start(t);
        lfo.stop(t + 0.65);
        break;
      }
      case 'crashBig':
        this.tone('sine', 90, 30, t, 0.6, 0.6 * v, o, 0.002);
        this.noiseBurst(t, 0.7, 0.45 * v, o, 'lowpass', 2400, 160);
        this.noiseBurst(t, 0.3, 0.25 * v, o, 'highpass', 4000, 8000);
        for (let i = 0; i < 9; i++) {
          const f = 2200 + Math.random() * 5200;
          this.tone('sine', f, f * 0.98, t + 0.05 + Math.random() * 0.4, 0.3, 0.035 * v, o);
        }
        break;
      case 'press':
        // hydraulic coin press slamming shut
        this.tone('sine', 85, 34, t, 0.42, 0.5 * v, o, 0.002);
        this.noiseBurst(t, 0.18, 0.3 * v, o, 'lowpass', 1600, 300);
        [1, 2.4, 3.9].forEach((m, i) => this.tone('sine', 520 * m, 520 * m, t, 0.5 - i * 0.12, 0.05 * v, o));
        this.noiseBurst(t + 0.05, 0.45, 0.07 * v, o, 'highpass', 3500, 6000);
        break;
      case 'steam':
        this.noiseBurst(t, 1.1, 0.26 * v, o, 'highpass', 1800, 4200, 0.7);
        this.noiseBurst(t, 0.25, 0.18 * v, o, 'lowpass', 600, 200);
        break;
      case 'hiss':
        this.noiseBurst(t, 0.35, 0.05 * v, o, 'highpass', 5000, 6000);
        break;
      case 'boing':
        this.tone('sine', 140 * p, 520 * p, t, 0.22, 0.25 * v, o, 0.003);
        this.tone('triangle', 280 * p, 900 * p, t + 0.02, 0.3, 0.08 * v, o);
        [0, 1, 2].forEach((i) => this.tone('sine', 700 + i * 180, 760 + i * 180, t + 0.04 + i * 0.05, 0.12, 0.04 * v, o));
        break;
      case 'zip':
        this.noiseBurst(t, 1.8, 0.1 * v, o, 'bandpass', 900, 2600, 3);
        this.tone('sawtooth', 220, 420, t, 1.6, 0.025 * v, o, 0.05);
        break;
      case 'drawer':
        this.noiseBurst(t, 0.16, 0.22 * v, o, 'bandpass', 900, 500, 1.5);
        this.tone('square', 180, 70, t, 0.12, 0.08 * v, o, 0.002);
        this.noiseBurst(t + 0.14, 0.05, 0.16 * v, o, 'bandpass', 3000, 3000, 5);
        break;
      case 'blaster':
        this.tone('sine', 1600 * p, 380 * p, t, 0.18, 0.12 * v, o, 0.002);
        this.tone('triangle', 2400 * p, 900 * p, t, 0.12, 0.05 * v, o);
        this.noiseBurst(t, 0.12, 0.12 * v, o, 'highpass', 4000, 2000);
        this.bell(hz('E6'), t + 0.02, 0.3, 0.04 * v, o);
        break;
      case 'splat':
        this.noiseBurst(t, 0.18, 0.28 * v, o, 'lowpass', 2200, 400);
        this.tone('sine', 220, 90, t, 0.12, 0.12 * v, o);
        break;
      case 'horn': {
        const f = [311, 392];
        for (const fr of f) {
          this.tone('sawtooth', fr, fr, t, 0.55, 0.05 * v, o, 0.01);
          this.tone('square', fr * 0.5, fr * 0.5, t, 0.55, 0.02 * v, o, 0.01);
        }
        break;
      }
    }
  }

  // ------------------------------------------------------- helicopter rotor
  /** Rotor thump loop; `level` 0 silences it (distance-based, set every frame). */
  setRotor(level: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (level > 0.01 && !this.rotor) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'sawtooth';
      lfo.frequency.value = 17;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(lp).connect(am).connect(gain).connect(this.sfxBus);
      src.start();
      lfo.start();
      this.rotor = { src, gain, lfo };
    }
    if (!this.rotor) return;
    this.rotor.gain.gain.setTargetAtTime(Math.min(1, level) * 0.32, ctx.currentTime, 0.15);
    if (level <= 0.01) {
      const r = this.rotor;
      r.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      setTimeout(() => {
        r.src.stop();
        r.lfo.stop();
      }, 600);
      this.rotor = null;
    }
  }

  // -------------------------------------------------------------- siren loop
  setSiren(on: boolean, fast = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (on && !this.siren) {
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      const gain = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.value = 720;
      lfo.type = 'square';
      lfo.frequency.value = fast ? 1.6 : 0.9;
      lg.gain.value = 140;
      filt.type = 'lowpass';
      filt.frequency.value = 1600;
      lfo.connect(lg).connect(osc.frequency);
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.025, ctx.currentTime, 0.3);
      osc.connect(filt).connect(gain).connect(this.sfxBus);
      osc.start();
      lfo.start();
      this.siren = { osc, lfo, gain };
    } else if (!on && this.siren) {
      const s = this.siren;
      s.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      setTimeout(() => {
        s.osc.stop();
        s.lfo.stop();
      }, 900);
      this.siren = null;
    } else if (on && this.siren) {
      this.siren.lfo.frequency.setTargetAtTime(fast ? 1.6 : 0.9, ctx.currentTime, 0.2);
    }
  }

  // ------------------------------------------------------------------- music
  setMusic(mode: MusicMode) {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    this.step = 0;
    if (this.schedTimer !== null) {
      clearInterval(this.schedTimer);
      this.schedTimer = null;
    }
    if (mode !== 'off' && this.ctx) {
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      this.schedTimer = window.setInterval(() => this.schedule(), 25);
    }
  }

  setIntensity(level: number) {
    this.intensity = level;
  }

  private schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ahead = this.ctx.currentTime + 0.15;
    while (this.nextNoteTime < ahead) {
      if (this.musicMode === 'menu') this.menuStep(this.step, this.nextNoteTime);
      else if (this.musicMode === 'heist') this.heistStep(this.step, this.nextNoteTime);
      const bpm = this.musicMode === 'menu' ? 92 : this.intensity >= 4 ? 138 : this.intensity >= 2 ? 128 : 116;
      this.nextNoteTime += 60 / bpm / 2; // eighth notes
      this.step++;
    }
  }

  private pluck(f: number, t: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o1.type = 'triangle';
    o2.type = 'sine';
    o1.frequency.value = f;
    o2.frequency.value = f * 2;
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(f * 6, t);
    filt.frequency.exponentialRampToValueAtTime(f * 1.2, t + dur);
    this.env(g, t, 0.004, vol, dur);
    o1.connect(filt);
    o2.connect(filt);
    filt.connect(g).connect(this.musicBus);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  private shaker(t: number, vol: number) {
    this.noiseBurst(t, 0.05, vol, this.musicBus, 'highpass', 7000);
  }

  private kick(t: number, vol: number) {
    this.tone('sine', 140, 45, t, 0.18, vol, this.musicBus, 0.002);
  }

  private snare(t: number, vol: number) {
    this.noiseBurst(t, 0.12, vol, this.musicBus, 'bandpass', 2200, 1800, 0.8);
    this.tone('triangle', 220, 180, t, 0.06, vol * 0.4, this.musicBus);
  }

  // Original composition: a sneaky minor-key "caper" groove that layers up
  // as the wanted level rises.
  private heistStep(step: number, t: number) {
    const bar = Math.floor(step / 8) % 4;
    const s = step % 8;
    const bass = [
      ['A2', '', 'A2', 'C3', 'E3', '', 'D3', 'C3'],
      ['G2', '', 'G2', 'B2', 'D3', '', 'C3', 'B2'],
      ['F2', '', 'F2', 'A2', 'C3', '', 'B2', 'A2'],
      ['E2', '', 'E2', 'G#2', 'B2', '', 'E3', 'D3'],
    ];
    const lead = [
      ['A4', '', 'C5', '', 'E5', '', 'D5', 'C5'],
      ['B4', '', 'D5', '', 'G5', '', 'F5', 'E5'],
      ['A5', '', 'G5', 'F5', 'E5', '', 'D5', 'C5'],
      ['B4', '', 'E5', '', 'G#4', '', 'B4', ''],
    ];
    const I = this.intensity;
    const b = bass[bar][s];
    if (b) this.pluck(hz(b), t, 0.22, 0.32);
    const phrase = Math.floor(step / 32) % 2;
    const l = lead[bar][s];
    if (l && (phrase === 1 || I >= 1)) this.bell(hz(l), t, 0.35, I >= 3 ? 0.05 : 0.04, this.musicBus, 3.01, 1.2);
    if (s % 2 === 1 || I >= 1) this.shaker(t, s % 2 === 0 ? 0.03 : 0.018);
    if (I >= 2) {
      if (s === 0 || s === 4) this.kick(t, 0.32);
      if (s === 2 || s === 6) this.snare(t, 0.08);
    }
    if (I >= 3 && s === 0) {
      const roots = ['A3', 'G3', 'F3', 'E3'];
      this.tone('sawtooth', hz(roots[bar]), hz(roots[bar]), t, 1.0, 0.03, this.musicBus, 0.08);
      this.tone('sawtooth', hz(roots[bar]) * 1.498, hz(roots[bar]) * 1.498, t, 1.0, 0.02, this.musicBus, 0.08);
    }
    if (I >= 4 && (s === 3 || s === 7)) this.kick(t, 0.2);
  }

  // Original music-box waltz for the menu.
  private menuStep(step: number, t: number) {
    const bar = Math.floor(step / 6) % 8;
    const s = step % 6;
    const chords = [
      ['C4', 'G4', 'E5'],
      ['A3', 'E4', 'C5'],
      ['F3', 'C4', 'A4'],
      ['G3', 'D4', 'B4'],
      ['C4', 'G4', 'E5'],
      ['A3', 'E4', 'C5'],
      ['D4', 'A4', 'F5'],
      ['G3', 'D4', 'B4'],
    ];
    const melody = [
      ['E5', '', 'G5', '', 'E5', ''],
      ['C5', '', '', '', 'E5', 'D5'],
      ['C5', '', 'A4', '', 'C5', ''],
      ['B4', '', '', '', 'G4', ''],
      ['E5', '', 'G5', '', 'C6', ''],
      ['B5', '', 'A5', '', 'G5', ''],
      ['F5', '', 'A5', '', 'D5', 'E5'],
      ['D5', '', '', '', '', ''],
    ];
    const ch = chords[bar];
    const arp = [ch[0], ch[1], ch[2], ch[1], ch[2], ch[1]];
    this.bell(hz(arp[s]), t, 0.5, 0.025, this.musicBus, 4, 0.8);
    const m = melody[bar][s];
    if (m) this.bell(hz(m), t, 0.9, 0.05, this.musicBus, 3.5, 1.6);
    if (s === 0) this.pluck(hz(ch[0]) / 2, t, 0.6, 0.16);
    if (s === 3) this.shaker(t, 0.012);
  }
}
