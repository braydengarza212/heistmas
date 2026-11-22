import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential damping toward a target. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export function dampVec3(v: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number) {
  const t = 1 - Math.exp(-lambda * dt);
  v.x += (target.x - v.x) * t;
  v.y += (target.y - v.y) * t;
  v.z += (target.z - v.z) * t;
  return v;
}

/** Shortest signed angle difference a→b in radians. */
export function angleDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function dampAngle(current: number, target: number, lambda: number, dt: number) {
  return current + angleDiff(current, target) * (1 - Math.exp(-lambda * dt));
}

/** Critically-damped-ish spring for secondary motion (hat flop, sack jiggle). */
export class Spring {
  value: number;
  velocity = 0;
  constructor(value = 0, public stiffness = 120, public damping = 12) {
    this.value = value;
  }
  update(target: number, dt: number) {
    // substep so stiff springs stay stable at low frame rates
    const n = Math.min(12, Math.max(1, Math.ceil(dt / (1 / 120))));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const f = (target - this.value) * this.stiffness - this.velocity * this.damping;
      this.velocity += f * h;
      this.value += this.velocity * h;
    }
    if (!Number.isFinite(this.value)) {
      this.value = target;
      this.velocity = 0;
    }
    return this.value;
  }
  kick(v: number) {
    this.velocity += v;
  }
}

export class Spring3 {
  value = new THREE.Vector3();
  velocity = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  constructor(public stiffness = 120, public damping = 12) {}
  update(target: THREE.Vector3, dt: number) {
    const n = Math.min(12, Math.max(1, Math.ceil(dt / (1 / 120))));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.tmp.copy(target).sub(this.value).multiplyScalar(this.stiffness);
      this.tmp.addScaledVector(this.velocity, -this.damping);
      this.velocity.addScaledVector(this.tmp, h);
      this.value.addScaledVector(this.velocity, h);
    }
    return this.value;
  }
}

/** Deterministic PRNG so level decoration layouts are stable between runs. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Smooth value noise in 1D, used for flails and wobble. */
export function noise1(x: number) {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

export const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutElastic = (t: number) => {
  const c4 = TAU / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/** Distance between segment [p1,q1] and segment [p2,q2] (3D). */
export function segmentSegmentDistance(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
): number {
  const d1 = _a.subVectors(q1, p1);
  const d2 = _b.subVectors(q2, p2);
  const r = _c.subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  const EPS = 1e-8;
  if (a <= EPS && e <= EPS) return r.length();
  if (a <= EPS) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= EPS) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  _d.copy(p1).addScaledVector(d1, s);
  _e.copy(p2).addScaledVector(d2, t);
  return _d.distanceTo(_e);
}
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();

export function formatMoney(v: number) {
  return '$' + Math.round(v).toLocaleString('en-US');
}

export function formatTime(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatTimeMs(ms: number) {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
