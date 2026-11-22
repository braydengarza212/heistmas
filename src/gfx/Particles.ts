import * as THREE from 'three';

/**
 * CPU-simulated point-sprite particles. One additive system for sparkles and
 * glints, one alpha-blended system for dust puffs and confetti.
 */

export type ParticleKind = 'sparkle' | 'puff' | 'confetti' | 'ring';

const KIND_ID: Record<ParticleKind, number> = { sparkle: 0, puff: 1, confetti: 2, ring: 3 };

export interface EmitOptions {
  count: number;
  color?: number | number[];
  speed?: number;
  up?: number;
  spread?: number;
  size?: number;
  life?: number;
  gravity?: number;
  drag?: number;
  kind?: ParticleKind;
  radius?: number;
  dir?: THREE.Vector3;
}

const vert = /* glsl */ `
attribute vec3 aColor;
attribute vec3 aInfo; // size, life01, kind
attribute float aRot;
uniform float uScale;
varying vec3 vColor;
varying vec3 vInfo;
varying float vRot;
void main() {
  vColor = aColor;
  vInfo = aInfo;
  vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // kinds are compared with a margin: some GPUs interpolate even flat point varyings inexactly
  float grow = abs(aInfo.z - 1.0) < 0.5 ? (0.6 + aInfo.y * 0.8) : (aInfo.z > 2.5 ? (0.3 + aInfo.y * 2.5) : 1.0);
  gl_PointSize = clamp(aInfo.x * grow * uScale / -mv.z, 0.0, 256.0);
}`;

const frag = /* glsl */ `
varying vec3 vColor;
varying vec3 vInfo;
varying float vRot;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float life = vInfo.y;
  float kind = vInfo.z;
  float a;
  if (kind < 0.5) {
    float d = length(c);
    float cx = max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y) * 2.1);
    float cy = max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x) * 2.1);
    a = max(max(cx, cy), 1.0 - smoothstep(0.0, 0.22, d)) * (1.0 - life);
  } else if (kind < 1.5) {
    a = (1.0 - smoothstep(0.0, 0.5, length(c))) * (1.0 - life) * 0.55;
  } else if (kind < 2.5) {
    float s = sin(vRot), co = cos(vRot);
    vec2 r = vec2(c.x * co - c.y * s, c.x * s + c.y * co);
    a = step(abs(r.x), 0.32) * step(abs(r.y), 0.18) * (1.0 - smoothstep(0.7, 1.0, life));
  } else {
    float d = length(c);
    a = (1.0 - smoothstep(0.0, 0.06, abs(d - 0.42))) * (1.0 - life);
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export class ParticleSystem {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private info: Float32Array;
  private rot: Float32Array;
  private rotV: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private alive = 0;
  private cursor = 0;
  private mat: THREE.ShaderMaterial;
  quality = 1;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.info = new Float32Array(max * 3);
    this.rot = new Float32Array(max);
    this.rotV = new Float32Array(max);
    this.life = new Float32Array(max).fill(1);
    this.maxLife = new Float32Array(max).fill(1);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    for (let i = 0; i < max; i++) this.info[i * 3 + 1] = 1;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  emit(origin: THREE.Vector3, o: EmitOptions) {
    const n = Math.max(1, Math.round(o.count * this.quality));
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? 0xffffff];
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const r = o.radius ?? 0;
      this.pos[i * 3] = origin.x + (Math.random() - 0.5) * r * 2;
      this.pos[i * 3 + 1] = origin.y + (Math.random() - 0.5) * r * 2;
      this.pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * r * 2;
      const sp = (o.speed ?? 3) * (0.4 + Math.random() * 0.8);
      const spread = o.spread ?? 1;
      let dx = (Math.random() - 0.5) * 2 * spread;
      let dy = Math.random() * spread;
      let dz = (Math.random() - 0.5) * 2 * spread;
      if (o.dir) {
        dx += o.dir.x;
        dy += o.dir.y;
        dz += o.dir.z;
      }
      const len = Math.hypot(dx, dy, dz) || 1;
      this.vel[i * 3] = (dx / len) * sp;
      this.vel[i * 3 + 1] = (dy / len) * sp + (o.up ?? 0);
      this.vel[i * 3 + 2] = (dz / len) * sp;
      c.set(colors[Math.floor(Math.random() * colors.length)]);
      const boost = o.kind === 'sparkle' || o.kind === undefined ? 2.5 : 1;
      this.col[i * 3] = c.r * boost;
      this.col[i * 3 + 1] = c.g * boost;
      this.col[i * 3 + 2] = c.b * boost;
      this.info[i * 3] = (o.size ?? 0.25) * (0.6 + Math.random() * 0.8);
      this.info[i * 3 + 1] = 0;
      this.info[i * 3 + 2] = KIND_ID[o.kind ?? 'sparkle'];
      this.life[i] = 0;
      this.maxLife[i] = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      this.grav[i] = o.gravity ?? 6;
      this.drag[i] = o.drag ?? 1.5;
      this.rot[i] = Math.random() * 6.28;
      this.rotV[i] = (Math.random() - 0.5) * 14;
    }
    this.alive = this.max;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number) {
    this.mat.uniforms.uScale.value = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    if (this.alive === 0) return;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] >= this.maxLife[i]) {
        this.info[i * 3 + 1] = 1;
        continue;
      }
      any = true;
      this.life[i] += dt;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.rot[i] += this.rotV[i] * dt;
      this.info[i * 3 + 1] = Math.min(1, this.life[i] / this.maxLife[i]);
    }
    if (!any) this.alive = 0;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aInfo.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aRot.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

/** Convenience wrapper bundling both systems with themed presets. */
export class FX {
  readonly glints = new ParticleSystem(900, true);
  readonly soft = new ParticleSystem(700, false);

  constructor(scene: THREE.Scene, quality = 1) {
    scene.add(this.glints.points);
    scene.add(this.soft.points);
    this.glints.quality = quality;
    this.soft.quality = quality;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, vh: number) {
    this.glints.update(dt, camera, vh);
    this.soft.update(dt, camera, vh);
  }

  pickup(p: THREE.Vector3, color = 0xffd75a, big = false) {
    this.glints.emit(p, { count: big ? 26 : 12, color: [color, 0xffffff], speed: big ? 5 : 3.2, up: 2, size: big ? 0.5 : 0.35, life: 0.7, gravity: 4 });
    if (big) this.glints.emit(p, { count: 1, color, kind: 'ring', speed: 0, size: 2.2, life: 0.5, gravity: 0 });
  }

  dust(p: THREE.Vector3, count = 8, size = 0.5) {
    this.soft.emit(p, { count, color: 0xf2f4ff, kind: 'puff', speed: 2.2, up: 0.6, spread: 1, size, life: 0.6, gravity: -0.5, drag: 4, radius: 0.2 });
  }

  snowPuff(p: THREE.Vector3, count = 10) {
    this.soft.emit(p, { count, color: 0xffffff, kind: 'puff', speed: 3, up: 1.5, size: 0.45, life: 0.8, gravity: 3, drag: 3, radius: 0.25 });
  }

  confetti(p: THREE.Vector3, count = 60) {
    this.soft.emit(p, {
      count,
      color: [0xd31f2b, 0x1d9a55, 0xf2c14e, 0xffffff, 0x2a6bd7],
      kind: 'confetti',
      speed: 9,
      up: 6,
      size: 0.3,
      life: 2.4,
      gravity: 9,
      drag: 1.6,
    });
  }

  zap(p: THREE.Vector3) {
    this.glints.emit(p, { count: 20, color: [0xff3344, 0xffaaaa], speed: 6, size: 0.3, life: 0.35, gravity: 0, drag: 4 });
  }

  stars(p: THREE.Vector3) {
    this.glints.emit(p, { count: 10, color: [0xfff3a0, 0xffffff], speed: 2.5, up: 1, size: 0.4, life: 0.9, gravity: 2 });
  }

  shards(p: THREE.Vector3, colors: number[], count = 18) {
    this.soft.emit(p, { count, color: colors, kind: 'confetti', speed: 7, up: 4, size: 0.22, life: 1.2, gravity: 14, drag: 1.2, radius: 0.3 });
    this.glints.emit(p, { count: 10, color: 0xffffff, speed: 4, size: 0.3, life: 0.5 });
  }

  dispose() {
    this.glints.dispose();
    this.soft.dispose();
  }
}
