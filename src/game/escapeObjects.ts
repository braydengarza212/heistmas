import * as THREE from 'three';
import { RAPIER, Physics, G, groups, quatY } from './physics';
import { cyl, rbox, sphere, torus, cone, star3D } from '../gfx/geom';
import { Mats } from '../gfx/materials';
import { buildHelicopter, buildPlowTruck, glowDecal, type HeliRig, type PlowRig } from '../gfx/vehicles';
import { newId } from './objects';
import { clamp, damp, easeInOutCubic, easeOutCubic } from '../core/math';

/**
 * Hazards and gadgets for the escape stages (deposit vaults, the mint,
 * the rooftops and the getaway street).
 */

const SOLID = groups(G.WORLD, 0xffff); // solid for players and ragdolls, ignored by the camera
const TAU = Math.PI * 2;

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A moving hazard the heist tests against the robber's capsule every step. */
export interface Mover {
  readonly id: number;
  readonly label: string;
  /** Hearts lost on a hit. */
  readonly damage: number;
  /** Spill some loot on a hit. */
  readonly dropLoot: boolean;
  update(t: number, dt: number): void;
  /** Knockback impulse if the capsule a→b (radius r) is being hit right now, else null. */
  test(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.Vector3 | null;
}

/** Something the robber can ride (the player follows its per-step movement). */
export interface Rideable {
  readonly id: number;
  readonly delta: THREE.Vector3;
}

export type HazardEvent = (kind: 'drawer' | 'press' | 'steam' | 'steamWarn' | 'truck', at: THREE.Vector3, strength: number) => void;

function capsuleHitsBox(a: THREE.Vector3, b: THREE.Vector3, r: number, min: THREE.Vector3, max: THREE.Vector3) {
  const x = (a.x + b.x) / 2;
  const z = (a.z + b.z) / 2;
  const y0 = Math.min(a.y, b.y) - r;
  const y1 = Math.max(a.y, b.y) + r;
  if (y1 < min.y || y0 > max.y) return false;
  const dx = Math.max(min.x - x, 0, x - max.x);
  const dz = Math.max(min.z - z, 0, z - max.z);
  return dx * dx + dz * dz < r * r;
}

export type WallDir = 'x+' | 'x-' | 'z+' | 'z-';
const DIR_YAW: Record<WallDir, number> = { 'x+': Math.PI / 2, 'x-': -Math.PI / 2, 'z+': 0, 'z-': Math.PI };

// =====================================================================
// Safe-deposit drawer that punches out of a cabinet wall
// =====================================================================

export class DrawerPiston implements Mover {
  readonly id = newId();
  readonly label = 'Deposit drawer';
  readonly damage = 0;
  readonly dropLoot = false;
  readonly group = new THREE.Group();
  private parts: THREE.Object3D[] = [];
  private lamp: THREE.Mesh;
  private body: RAPIER.RigidBody;
  private col: RAPIER.Collider;
  private dir: THREE.Vector3;
  private yaw: number;
  ext = 0;
  private danger = false;
  private cycle = -1;
  private lastHalf = -1;
  private min = new THREE.Vector3();
  private max = new THREE.Vector3();
  onEvent: HazardEvent | null = null;

  constructor(
    physics: Physics,
    parent: THREE.Object3D,
    /** Wall-face point under the drawer's middle (y = drawer bottom). */
    readonly face: THREE.Vector3,
    dir: WallDir,
    readonly o: { width: number; height: number; reach: number; period: number; offset: number },
  ) {
    this.yaw = DIR_YAW[dir];
    this.dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).round();
    this.group.position.copy(face);
    this.group.rotation.y = this.yaw;
    parent.add(this.group);
    const { width: w, height: h } = o;
    // telescoping stages, innermost first: chrome rams behind a brass drawer front
    for (let i = 2; i >= 0; i--) {
      const g = new THREE.Group();
      if (i === 0) {
        mesh(rbox(w, h, 0.8, 0.05), Mats.goldSatin(), g, 0, h / 2, 0);
        const front = mesh(new THREE.PlaneGeometry(w - 0.12, h - 0.12), Mats.deposit(Math.max(1, Math.round(w / 0.6)) / 4, Math.max(1, Math.round(h / 0.45)) / 4), g, 0, h / 2, 0.402, false);
        front.receiveShadow = true;
        mesh(rbox(w * 0.36, 0.07, 0.08, 0.03), Mats.gold(), g, 0, h / 2, 0.44);
        // hazard bands wrap the drawer so it reads as dangerous from the side
        for (const y of [0.1, h - 0.1]) mesh(rbox(w + 0.04, 0.12, 0.84, 0.03), Mats.hazard(w / 0.5, 1), g, 0, y, 0, false);
      } else {
        const ram = mesh(rbox(w * (0.5 - i * 0.1), h * (0.5 - i * 0.1), 0.8, 0.04), Mats.chrome(), g, 0, h / 2, 0);
        ram.castShadow = true;
      }
      this.group.add(g);
      this.parts.unshift(g);
    }
    // warning paint on the floor over the drawer's reach
    const paintMat = Mats.hazard(Math.max(1, Math.round(w / 0.5)), Math.max(1, Math.round(o.reach / 0.5))).clone();
    paintMat.polygonOffset = true;
    paintMat.polygonOffsetFactor = -2;
    paintMat.transparent = true;
    paintMat.opacity = 0.75;
    const paint = new THREE.Mesh(new THREE.PlaneGeometry(w, o.reach), paintMat);
    paint.rotation.x = -Math.PI / 2;
    paint.position.set(0, -face.y + 0.014, o.reach / 2);
    paint.receiveShadow = true;
    paint.userData.noAO = true;
    this.group.add(paint);
    this.lamp = mesh(sphere(0.09, 12, 8), Mats.glow(0x331a00, 1), this.group, w / 2 - 0.14, h + 0.16, 0.06, false);
    mesh(rbox(0.26, 0.2, 0.08, 0.03), Mats.darkMetal(), this.group, w / 2 - 0.14, h + 0.16, 0.0);
    const { body, col } = physics.kinematic(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, 0.05).setCollisionGroups(SOLID), face.x, face.y + h / 2, face.z);
    body.setRotation(quatY(this.yaw), true);
    this.body = body;
    this.col = col;
    this.update(0, 0);
  }

  private static readonly WARN = 0.55;
  private static readonly PUNCH = 0.15;
  private static readonly HOLD = 0.75;
  private static readonly BACK = 0.85;

  update(t: number, _dt: number) {
    const o = this.o;
    const active = DrawerPiston.WARN + DrawerPiston.PUNCH + DrawerPiston.HOLD + DrawerPiston.BACK;
    const rest = Math.max(0.4, o.period - active);
    const tt = t + o.offset;
    const ph = ((tt % o.period) + o.period) % o.period;
    const cyc = Math.floor(tt / o.period);
    let e = 0;
    let warn = false;
    this.danger = false;
    if (ph < rest) e = 0;
    else if (ph < rest + DrawerPiston.WARN) {
      warn = true;
      e = Math.max(0, Math.sin((ph - rest) * 60)) * 0.04;
    } else if (ph < rest + DrawerPiston.WARN + DrawerPiston.PUNCH) {
      const k = (ph - rest - DrawerPiston.WARN) / DrawerPiston.PUNCH;
      e = o.reach * easeOutCubic(k);
      this.danger = true;
      if (cyc !== this.cycle) {
        this.cycle = cyc;
        this.onEvent?.('drawer', this.face, 1);
      }
    } else if (ph < rest + DrawerPiston.WARN + DrawerPiston.PUNCH + DrawerPiston.HOLD) {
      e = o.reach;
      this.danger = ph < rest + DrawerPiston.WARN + DrawerPiston.PUNCH + 0.12;
    } else {
      const k = (ph - rest - DrawerPiston.WARN - DrawerPiston.PUNCH - DrawerPiston.HOLD) / DrawerPiston.BACK;
      e = o.reach * (1 - easeInOutCubic(clamp(k, 0, 1)));
    }
    this.ext = e;
    // telescoping visuals
    const z = [e - 0.4, e * 0.6 - 0.42, e * 0.26 - 0.44];
    this.parts.forEach((p, i) => (p.position.z = z[i]));
    const half = Math.floor(ph * 8);
    if (half !== this.lastHalf) {
      this.lastHalf = half;
      this.lamp.material = warn && half % 2 === 0 ? Mats.glow(0xffa21a, 9) : e > 0.3 ? Mats.glow(0xff3344, 5) : Mats.glow(0x331a00, 1);
    }
    // collider spans wall face → drawer front
    const hd = Math.max(0.03, e / 2);
    this.col.setHalfExtents({ x: o.width / 2, y: o.height / 2, z: hd });
    const c = this.face.clone().addScaledVector(this.dir, Math.max(0.03, e) / 2);
    this.body.setNextKinematicTranslation({ x: c.x, y: this.face.y + o.height / 2, z: c.z });
    // world AABB for hit tests
    const ax = Math.abs(this.dir.x) > 0.5;
    const hw = o.width / 2;
    this.min.set(
      ax ? Math.min(this.face.x, this.face.x + this.dir.x * e) : this.face.x - hw,
      this.face.y,
      ax ? this.face.z - hw : Math.min(this.face.z, this.face.z + this.dir.z * e),
    );
    this.max.set(
      ax ? Math.max(this.face.x, this.face.x + this.dir.x * e) : this.face.x + hw,
      this.face.y + o.height,
      ax ? this.face.z + hw : Math.max(this.face.z, this.face.z + this.dir.z * e),
    );
  }

  test(a: THREE.Vector3, b: THREE.Vector3, r: number) {
    if (!this.danger || this.ext < 0.2) return null;
    if (!capsuleHitsBox(a, b, r, this.min, this.max)) return null;
    return this.dir.clone().multiplyScalar(10.5).setY(5.2);
  }
}

// =====================================================================
// Coin press (stamper) over the mint's bridge
// =====================================================================

export class CoinPress implements Mover, Rideable {
  readonly id = newId();
  readonly label = 'Coin press';
  readonly damage = 1;
  readonly dropLoot = true;
  readonly delta = new THREE.Vector3();
  readonly group = new THREE.Group();
  private head = new THREE.Group();
  private ram: THREE.Mesh;
  private ring: THREE.Mesh;
  private body: RAPIER.RigidBody;
  private h: number;
  private danger = false;
  private cycle = -1;
  private ringLevel = -1;
  onEvent: HazardEvent | null = null;
  static readonly HEAD_H = 0.9;

  constructor(
    physics: Physics,
    parent: THREE.Object3D,
    /** Point on the walkway under the press. */
    readonly base: THREE.Vector3,
    readonly o: { radius: number; rise: number; period: number; offset: number; span: number },
  ) {
    this.group.position.copy(base);
    parent.add(this.group);
    const R = o.radius;
    const top = o.rise + CoinPress.HEAD_H + 1.6;
    // gantry: two columns either side of the walkway (along z) + crossbeam
    for (const s of [-1, 1]) {
      mesh(rbox(0.46, top + 2.2, 0.46, 0.06), Mats.gunmetal(), this.group, 0, (top + 2.2) / 2 - 2.2, s * o.span);
      mesh(rbox(0.5, 0.5, 0.5, 0.04), Mats.hazard(1, 1), this.group, 0, 0.6, s * o.span);
      mesh(rbox(0.7, 0.3, 0.7, 0.06), Mats.darkMetal(), this.group, 0, top + 0.05, s * o.span);
    }
    mesh(rbox(0.9, 0.7, o.span * 2 + 0.6, 0.08), Mats.gunmetal(), this.group, 0, top + 0.35, 0);
    mesh(cyl(0.55, 0.55, 1.2, 20), Mats.darkMetal(), this.group, 0, top - 0.4, 0);
    this.ram = mesh(cyl(0.3, 0.3, 1, 18), Mats.chrome(), this.group, 0, 0, 0);
    // press head
    this.group.add(this.head);
    mesh(cyl(R, R, CoinPress.HEAD_H, 36), Mats.steel(), this.head, 0, CoinPress.HEAD_H / 2, 0);
    mesh(cyl(R + 0.05, R + 0.05, 0.22, 36), Mats.hazard(R * 4, 0.5), this.head, 0, CoinPress.HEAD_H - 0.12, 0);
    mesh(cyl(R * 0.94, R * 0.94, 0.08, 36), Mats.gold(), this.head, 0, 0.0, 0);
    const st = mesh(star3D(R * 0.55, R * 0.24, 0.05), Mats.goldSatin(), this.head, 0, -0.03, 0);
    st.rotation.x = Math.PI / 2;
    // telegraph ring on the walkway
    this.ring = mesh(torus(R * 0.92, 0.07, 8, 48), Mats.glow(0x551015, 1), this.group, 0, 0.03, 0, false);
    this.ring.rotation.x = Math.PI / 2;
    this.h = o.rise;
    const { body, col } = physics.kinematic(RAPIER.ColliderDesc.cylinder(CoinPress.HEAD_H / 2, R).setCollisionGroups(SOLID), base.x, base.y + o.rise + CoinPress.HEAD_H / 2, base.z);
    physics.tag(col, { kind: 'platform', id: this.id });
    this.body = body;
    this.update(0, 0);
  }

  update(t: number, _dt: number) {
    const o = this.o;
    const SLAM = 0.14;
    const HOLD = 0.5;
    const RISE = 1.15;
    const rest = Math.max(0.3, o.period - SLAM - HOLD - RISE);
    const tt = t + o.offset;
    const ph = ((tt % o.period) + o.period) % o.period;
    const cyc = Math.floor(tt / o.period);
    let h: number;
    this.danger = false;
    let warnK = 0;
    if (ph < rest) {
      h = o.rise;
      warnK = clamp((ph - (rest - 0.7)) / 0.7, 0, 1);
      if (warnK > 0) h += Math.sin(ph * 70) * 0.025;
    } else if (ph < rest + SLAM) {
      const k = (ph - rest) / SLAM;
      h = o.rise * (1 - k * k);
      this.danger = true;
      warnK = 1;
    } else if (ph < rest + SLAM + HOLD) {
      h = 0;
      this.danger = ph < rest + SLAM + 0.08;
      if (cyc !== this.cycle) {
        this.cycle = cyc;
        this.onEvent?.('press', this.base, 1);
      }
    } else {
      const k = (ph - rest - SLAM - HOLD) / RISE;
      h = o.rise * easeInOutCubic(clamp(k, 0, 1));
    }
    this.delta.set(0, h - this.h, 0);
    this.h = h;
    this.head.position.y = h;
    const top = o.rise + CoinPress.HEAD_H + 1.6;
    const ramLen = top - 0.4 - (h + CoinPress.HEAD_H);
    this.ram.scale.set(1, Math.max(0.05, ramLen + 0.6), 1);
    this.ram.position.y = h + CoinPress.HEAD_H + ramLen / 2 + 0.3;
    this.body.setNextKinematicTranslation({ x: this.base.x, y: this.base.y + h + CoinPress.HEAD_H / 2, z: this.base.z });
    const lvl = warnK > 0.99 ? 3 : warnK > 0.5 ? 2 : warnK > 0 ? 1 : 0;
    if (lvl !== this.ringLevel) {
      this.ringLevel = lvl;
      this.ring.material = lvl === 3 ? Mats.glow(0xff2a3a, 9) : lvl === 2 ? Mats.glow(0xff4d1a, 5) : lvl === 1 ? Mats.glow(0xff7a1a, 2.5) : Mats.glow(0x551015, 1);
    }
  }

  top() {
    return this.base.y + this.h + CoinPress.HEAD_H;
  }

  contains(x: number, z: number, margin = 0.2) {
    return Math.hypot(x - this.base.x, z - this.base.z) < this.o.radius + margin;
  }

  test(a: THREE.Vector3, b: THREE.Vector3, r: number) {
    if (!this.danger) return null;
    const cx = (a.x + b.x) / 2 - this.base.x;
    const cz = (a.z + b.z) / 2 - this.base.z;
    const d = Math.hypot(cx, cz);
    if (d > this.o.radius + r) return null;
    const bottom = this.base.y + this.h;
    if (Math.max(a.y, b.y) + r < bottom) return null;
    const nx = d > 0.05 ? cx / d : 1;
    const nz = d > 0.05 ? cz / d : 0;
    return new THREE.Vector3(nx * 7.5, 6.5, nz * 7.5);
  }
}

// =====================================================================
// Steam vent (periodic blast that tosses the robber)
// =====================================================================

const steamMat = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uAmount: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uAmount; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 p = vec2(vUv.x * 6.0, vUv.y * 3.0 - uTime * 3.2);
        float k = n(p) * 0.6 + n(p * 2.3 + 4.0) * 0.4;
        float a = k * (1.0 - vUv.y) * smoothstep(0.0, 0.12, vUv.y) * uAmount * 0.75;
        gl_FragColor = vec4(vec3(0.92, 0.95, 1.0), a);
      }`,
  });

export class SteamVent implements Mover {
  readonly id = newId();
  readonly label = 'Steam vent';
  readonly damage = 0;
  readonly dropLoot = false;
  readonly group = new THREE.Group();
  private column: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  amount = 0;
  private cycle = -1;
  private warnCycle = -1;
  private puffT = 0;
  onEvent: HazardEvent | null = null;

  constructor(
    parent: THREE.Object3D,
    readonly pos: THREE.Vector3,
    readonly o: { radius: number; height: number; period: number; offset: number; burst: number },
  ) {
    this.group.position.copy(pos);
    parent.add(this.group);
    const R = o.radius;
    mesh(cyl(R + 0.12, R + 0.18, 0.1, 28), Mats.darkMetal(), this.group, 0, 0.04, 0);
    for (let i = -2; i <= 2; i++) mesh(rbox(0.07, 0.05, Math.sqrt(Math.max(0.01, R * R - (i * R * 0.38) ** 2)) * 2, 0.02), Mats.gunmetal(), this.group, i * R * 0.38, 0.1, 0);
    const glow = mesh(cyl(R * 0.9, R * 0.9, 0.02, 24), Mats.glow(0xff7a2a, 0.8), this.group, 0, 0.06, 0, false);
    void glow;
    this.mat = steamMat();
    this.column = mesh(new THREE.CylinderGeometry(R * 1.7, R * 0.75, o.height, 20, 1, true), this.mat, this.group, 0, o.height / 2, 0, false);
    this.column.userData.noAO = true;
    this.column.renderOrder = 6;
  }

  update(t: number, dt: number) {
    const o = this.o;
    const tt = t + o.offset;
    const ph = ((tt % o.period) + o.period) % o.period;
    const cyc = Math.floor(tt / o.period);
    const warnStart = o.period - o.burst - 0.6;
    let target = 0;
    if (ph >= o.period - o.burst) target = 1;
    else if (ph >= warnStart) target = 0.12;
    if (target === 1 && cyc !== this.cycle) {
      this.cycle = cyc;
      this.onEvent?.('steam', this.pos, 1);
    }
    if (target > 0 && target < 1 && cyc !== this.warnCycle) {
      this.warnCycle = cyc;
      this.onEvent?.('steamWarn', this.pos, 0.3);
    }
    this.amount = damp(this.amount, target, target > this.amount ? 18 : 5, dt);
    this.mat.uniforms.uAmount.value = this.amount;
    this.mat.uniforms.uTime.value = t;
    this.column.visible = this.amount > 0.3;
    this.column.scale.set(0.6 + this.amount * 0.4, Math.max(0.05, this.amount), 0.6 + this.amount * 0.4);
    this.column.position.y = (o.height * Math.max(0.05, this.amount)) / 2;
    this.puffT -= dt;
    if (this.amount > 0.05 && this.puffT <= 0) {
      this.puffT = this.amount > 0.5 ? 0.06 : 0.18;
      this.onEvent?.('steamWarn', this.pos, this.amount);
    }
  }

  test(a: THREE.Vector3, b: THREE.Vector3, r: number) {
    if (this.amount < 0.55) return null;
    const x = (a.x + b.x) / 2;
    const z = (a.z + b.z) / 2;
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    if (Math.hypot(dx, dz) > this.o.radius + r * 0.6) return null;
    const y0 = Math.min(a.y, b.y) - r;
    if (y0 < this.pos.y - 0.3 || y0 > this.pos.y + this.o.height) return null;
    const ang = Math.random() * TAU;
    return new THREE.Vector3(Math.cos(ang) * 2.6, 10.5, Math.sin(ang) * 2.6);
  }
}

// =====================================================================
// Bounce pad
// =====================================================================

export class BouncePad {
  readonly group = new THREE.Group();
  readonly top: number;
  private cap: THREE.Group;
  private arrows: THREE.Mesh[] = [];
  private squash = 0;
  private cool = 0;
  private t = 0;

  constructor(
    physics: Physics,
    parent: THREE.Object3D,
    readonly pos: THREE.Vector3,
    /** Launch speed (m/s). */
    readonly power: number,
    readonly radius = 1.05,
    /** Straight up (cancels running speed) — for launching through a hatch. */
    readonly vertical = false,
  ) {
    this.group.position.copy(pos);
    parent.add(this.group);
    this.top = pos.y + 0.3;
    const R = radius;
    mesh(cyl(R + 0.18, R + 0.28, 0.16, 36), Mats.darkMetal(), this.group, 0, 0.08, 0);
    mesh(torus(R + 0.2, 0.05, 8, 40), Mats.hazard(8, 1), this.group, 0, 0.16, 0).rotation.x = Math.PI / 2;
    // coil spring
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * TAU * 4;
      pts.push(new THREE.Vector3(Math.cos(a) * R * 0.62, 0.12 + (i / 64) * 0.14, Math.sin(a) * R * 0.62));
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 128, 0.035, 6, false), Mats.chrome(), this.group);
    this.cap = new THREE.Group();
    this.cap.position.y = 0.26;
    this.group.add(this.cap);
    mesh(cyl(R, R, 0.08, 40), Mats.gold(), this.cap, 0, 0, 0);
    mesh(cyl(R * 0.78, R * 0.78, 0.02, 40), Mats.plastic(0xd31f2b), this.cap, 0, 0.05, 0);
    const st = mesh(star3D(R * 0.5, R * 0.22, 0.05), Mats.glow(0xffd75a, 2.6), this.cap, 0, 0.06, 0, false);
    st.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const ar = mesh(cone(0.28, 0.3, 4), Mats.glow(0x6dffa8, 2.4), this.group, 0, 0.9 + i * 0.42, 0, false);
      ar.userData.noAO = true;
      this.arrows.push(ar);
    }
    physics.cylinder(pos.x, pos.y + 0.15, pos.z, R, 0.3);
  }

  /** Is a robber standing on the pad ready to be launched? */
  check(feet: THREE.Vector3, grounded: boolean, vy: number) {
    if (this.cool > 0 || !grounded || vy > 0.5) return false;
    if (Math.hypot(feet.x - this.pos.x, feet.z - this.pos.z) > this.radius) return false;
    if (Math.abs(feet.y - this.top) > 0.35) return false;
    this.cool = 0.35;
    this.squash = 1;
    return true;
  }

  update(dt: number) {
    this.t += dt;
    this.cool -= dt;
    this.squash = Math.max(0, this.squash - dt * 3.5);
    const s = this.squash;
    this.cap.position.y = 0.26 - Math.sin(s * Math.PI) * 0.12 + s * 0.08;
    this.arrows.forEach((a, i) => {
      const k = (this.t * 1.4 + i / 3) % 1;
      a.position.y = 0.6 + k * 1.6;
      a.scale.setScalar(Math.sin(k * Math.PI) * 1.0 + 0.01);
    });
  }
}

// =====================================================================
// Zipline from the rooftops down to the street
// =====================================================================

export class Zipline {
  readonly curve: THREE.QuadraticBezierCurve3;
  readonly length: number;
  readonly grab: THREE.Vector3;
  readonly heading: number;
  riding = false;
  done = false;
  private s = 0;
  speed = 0;
  private trolley = new THREE.Group();
  private wheel: THREE.Mesh;
  readonly pos = new THREE.Vector3();

  constructor(
    parent: THREE.Object3D,
    readonly start: THREE.Vector3,
    readonly end: THREE.Vector3,
    readonly hang = 2.05,
    /** Where the robber stands to grab the handle (the glowing ring); defaults to under the cable start. */
    grabAt?: THREE.Vector3,
  ) {
    const mid = start.clone().lerp(end, 0.5);
    mid.y -= start.distanceTo(end) * 0.035;
    this.curve = new THREE.QuadraticBezierCurve3(start.clone(), mid, end.clone());
    this.length = this.curve.getLength();
    this.heading = Math.atan2(end.x - start.x, end.z - start.z);
    this.grab = grabAt ? grabAt.clone() : start.clone().setY(start.y - hang);
    // cable
    const cable = new THREE.Mesh(new THREE.TubeGeometry(this.curve, 96, 0.028, 6, false), Mats.darkMetal());
    cable.castShadow = true;
    parent.add(cable);
    // trolley: pulley + handlebar
    parent.add(this.trolley);
    mesh(rbox(0.32, 0.22, 0.12, 0.04), Mats.plastic(0xd31f2b), this.trolley, 0, 0.02, 0);
    this.wheel = mesh(cyl(0.11, 0.11, 0.06, 16), Mats.chrome(), this.trolley, 0, 0.0, 0);
    this.wheel.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) mesh(cyl(0.015, 0.015, 0.9, 6), Mats.darkMetal(), this.trolley, s * 0.18, -0.48, 0).rotation.z = s * 0.2;
    const bar = mesh(cyl(0.035, 0.035, 0.8, 10), Mats.matte(0x1b1c21, 0.7), this.trolley, 0, -0.92, 0);
    bar.rotation.z = Math.PI / 2;
    this.trolley.rotation.y = this.heading - Math.PI / 2;
    this.placeTrolley(0);
  }

  private placeTrolley(u: number) {
    this.curve.getPointAt(clamp(u, 0, 1), this.pos);
    this.trolley.position.copy(this.pos);
  }

  canGrab(feet: THREE.Vector3) {
    if (this.riding || this.done) return false;
    return Math.hypot(feet.x - this.grab.x, feet.z - this.grab.z) < 1.35 && Math.abs(feet.y - this.grab.y) < 1.2;
  }

  begin() {
    this.riding = true;
    this.s = 0;
    this.speed = 4;
  }

  /** Advances the ride; returns the robber's feet position, or null once the ride ends. */
  update(dt: number, out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.riding) return null;
    this.speed = Math.min(16.5, this.speed + 10 * dt);
    this.s += (this.speed * dt) / this.length;
    this.wheel.rotation.y += this.speed * dt * 9;
    if (this.s >= 1) {
      this.riding = false;
      this.done = true;
      this.placeTrolley(1);
      return null;
    }
    this.placeTrolley(this.s);
    out.copy(this.pos);
    out.y -= this.hang;
    return out;
  }

  /** Velocity at the end of the cable (for a natural release). */
  releaseVelocity() {
    const dir = this.curve.getTangentAt(0.98).normalize();
    return new THREE.Vector3(dir.x * this.speed * 0.55, 1.5, dir.z * this.speed * 0.55);
  }
}

// =====================================================================
// Police helicopter with a sweeping searchlight
// =====================================================================

const beamMat = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uAlert: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main(){
        vAlong = uv.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlert; varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
        float a = mix(0.05, 0.16, vAlong) * edge;
        vec3 c = mix(vec3(0.85, 0.92, 1.0), vec3(1.0, 0.55, 0.5), uAlert);
        gl_FragColor = vec4(c * a, a);
      }`,
  });

export class Searchlight {
  readonly heli: HeliRig;
  private beam: THREE.Mesh;
  private bmat: THREE.ShaderMaterial;
  private spot: THREE.Mesh;
  readonly target = new THREE.Vector3();
  private aim = new THREE.Vector3();
  /** World position of the searchlight lamp (beam origin). */
  readonly lampPos = new THREE.Vector3();
  private yaw = 0;
  private bank = 0;
  lit = false;
  lock = 0;
  /** Override: follow this point (escape cinematic). */
  follow: THREE.Vector3 | null = null;
  readonly spotRadius = 3.2;
  private tmp = new THREE.Vector3();

  constructor(
    parent: THREE.Object3D,
    readonly o: { center: THREE.Vector3; rx: number; rz: number; height: number; area: THREE.Box3 },
  ) {
    this.heli = buildHelicopter();
    parent.add(this.heli.root);
    this.bmat = beamMat();
    const geo = new THREE.CylinderGeometry(1, 0.08, 1, 24, 1, true);
    geo.translate(0, -0.5, 0); // apex at the origin, pointing down −Y
    this.beam = new THREE.Mesh(geo, this.bmat);
    this.beam.userData.noAO = true;
    this.beam.renderOrder = 6;
    parent.add(this.beam);
    this.spot = glowDecal(1, 0xe6f0ff, 0.9);
    parent.add(this.spot);
    this.target.copy(o.area.getCenter(new THREE.Vector3()));
    this.aim.copy(this.target);
    // start in the sky over the rooftops, hidden until the robber gets near
    this.heli.root.position.set(o.center.x + o.rx, o.center.y + o.height, o.center.z);
    this.setVisible(false);
  }

  update(t: number, dt: number, player: THREE.Vector3, groundY: (x: number, z: number) => number | null, enabled: boolean) {
    const o = this.o;
    const h = this.heli.root;
    // hover on a slow ellipse, bobbing
    const a = t * 0.11;
    const goal = this.tmp.set(o.center.x + Math.cos(a) * o.rx, o.center.y + o.height + Math.sin(t * 0.7) * 0.7, o.center.z + Math.sin(a) * o.rz);
    if (this.follow) goal.set(this.follow.x - 18, this.follow.y + 22, this.follow.z + 10);
    h.position.x = damp(h.position.x, goal.x, this.follow ? 1.2 : 0.8, dt);
    h.position.y = damp(h.position.y, goal.y, 0.8, dt);
    h.position.z = damp(h.position.z, goal.z, this.follow ? 1.2 : 0.8, dt);
    // sweep pattern or lock on
    if (this.follow) this.aim.copy(this.follow);
    else if (this.lock > 0 && enabled) {
      this.lock -= dt;
      this.aim.copy(player);
    } else {
      const ar = o.area;
      const cx = (ar.min.x + ar.max.x) / 2;
      const cz = (ar.min.z + ar.max.z) / 2;
      const hx = (ar.max.x - ar.min.x) / 2;
      const hz = (ar.max.z - ar.min.z) / 2;
      this.aim.set(cx + Math.sin(t * 0.31) * hx, 0, cz + Math.sin(t * 0.53 + 1.3) * hz);
    }
    // the light can't snap: it slews towards the aim point at a limited speed
    const dx = this.aim.x - this.target.x;
    const dz = this.aim.z - this.target.z;
    const dist = Math.hypot(dx, dz);
    const maxStep = (this.follow ? 30 : this.lock > 0 ? 6.4 : 7.5) * dt;
    if (dist > maxStep) {
      this.target.x += (dx / dist) * maxStep;
      this.target.z += (dz / dist) * maxStep;
    } else {
      this.target.x = this.aim.x;
      this.target.z = this.aim.z;
    }
    const gy = groundY(this.target.x, this.target.z);
    this.target.y = gy ?? player.y;
    // face the spot, bank into turns
    const wantYaw = Math.atan2(this.target.x - h.position.x, this.target.z - h.position.z) - Math.PI / 2;
    const dy = Math.atan2(Math.sin(wantYaw - this.yaw), Math.cos(wantYaw - this.yaw));
    this.yaw += dy * Math.min(1, dt * 0.9);
    this.bank = damp(this.bank, clamp(dy, -0.3, 0.3), 2, dt);
    h.rotation.set(this.bank, this.yaw, -0.08, 'YXZ');
    this.heli.rotor.rotation.y += dt * 38;
    this.heli.tailRotor.rotation.z += dt * 60;
    const blink = Math.floor(t * 1.5) % 2 === 0;
    this.heli.beacons[2].visible = blink;
    // beam + spot
    this.heli.lamp.getWorldPosition(this.lampPos);
    const toSpot = this.tmp.copy(this.target).sub(this.lampPos);
    const len = toSpot.length();
    this.beam.position.copy(this.lampPos);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), toSpot.normalize());
    this.beam.scale.set(this.spotRadius, len, this.spotRadius);
    this.spot.position.set(this.target.x, this.target.y + 0.05, this.target.z);
    this.spot.scale.setScalar(this.spotRadius * 2.6);
    this.spot.visible = gy !== null;
    // is the robber caught in the light?
    this.lit = enabled && !this.follow && gy !== null && Math.hypot(player.x - this.target.x, player.z - this.target.z) < this.spotRadius && Math.abs(player.y - this.target.y) < 2.5;
    if (this.lit) this.lock = 2.6;
    this.bmat.uniforms.uAlert.value = damp(this.bmat.uniforms.uAlert.value as number, this.lock > 0 ? 1 : 0, 4, dt);
  }

  setVisible(v: boolean) {
    this.heli.root.visible = this.beam.visible = v;
    if (!v) this.spot.visible = false;
  }

  get visible() {
    return this.heli.root.visible;
  }
}

// =====================================================================
// Traffic through the intersection (plow + salt truck)
// =====================================================================

export class CrossingTruck implements Mover {
  readonly id = newId();
  readonly label = 'Snowplow';
  readonly damage = 1;
  readonly dropLoot = true;
  readonly rig: PlowRig;
  private body: RAPIER.RigidBody;
  private z: number;
  speed = 0;
  private yaw: number;
  private fwd: THREE.Vector3;
  frozen = false;
  private parkedT = 0;
  onEvent: HazardEvent | null = null;
  private lastPhase = '';

  constructor(
    physics: Physics,
    parent: THREE.Object3D,
    readonly o: { x: number; z0: number; z1: number; speed: number; wait: number; offset: number; color?: number; hide: number },
  ) {
    this.rig = buildPlowTruck(o.color);
    parent.add(this.rig.root);
    const dir = Math.sign(o.z1 - o.z0);
    this.fwd = new THREE.Vector3(0, 0, dir);
    this.yaw = dir > 0 ? -Math.PI / 2 : Math.PI / 2; // local +X → world ±Z
    this.rig.root.rotation.y = this.yaw;
    this.z = o.z0;
    const { body } = physics.kinematic(RAPIER.ColliderDesc.cuboid(4.0, 1.6, 1.25).setCollisionGroups(SOLID), o.x, 1.6, o.z0);
    body.setRotation(quatY(this.yaw), true);
    this.body = body;
    this.place();
  }

  private place() {
    this.rig.root.position.set(this.o.x, 0, this.z);
    // collider centered slightly ahead (blade)
    this.body.setNextKinematicTranslation({ x: this.o.x, y: 1.6, z: this.z + this.fwd.z * 0.6 });
  }

  /** Park out of sight (used once the getaway starts). */
  freeze() {
    this.frozen = true;
    this.speed = 0;
    this.z = this.o.hide;
    this.place();
  }

  update(t: number, dt: number) {
    if (this.frozen) return;
    const o = this.o;
    const dist = Math.abs(o.z1 - o.z0);
    const travel = dist / o.speed;
    const T = travel + o.wait;
    const ph = (((t + o.offset) % T) + T) % T;
    let phase: string;
    let target = 0;
    if (ph < travel) {
      phase = 'drive';
      this.z = o.z0 + this.fwd.z * o.speed * ph;
      target = o.speed;
    } else {
      phase = 'wait';
      this.z = o.z0;
      this.parkedT += dt;
    }
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      if (phase === 'drive') this.onEvent?.('truck', this.rig.root.position, 1);
    }
    this.speed = target;
    this.place();
    for (const w of this.rig.wheels) w.spin.rotation.z -= (this.speed * dt) / w.radius;
    this.rig.beacon.rotation.y += dt * 7;
    this.rig.body.rotation.x = Math.sin(t * 9) * 0.004 * (this.speed > 0 ? 1 : 0.3);
  }

  test(a: THREE.Vector3, b: THREE.Vector3, r: number) {
    if (this.speed < 0.5) return null;
    const x = (a.x + b.x) / 2 - this.o.x;
    const z = (a.z + b.z) / 2 - (this.z + this.fwd.z * 0.6);
    if (Math.max(a.y, b.y) + r < 0 || Math.min(a.y, b.y) - r > 3.2) return null;
    // truck long axis is world z
    if (Math.abs(z) > 4.4 + r || Math.abs(x) > 1.35 + r) return null;
    const side = Math.sign(x) || 1;
    return new THREE.Vector3(side * 6, 6.5, this.fwd.z * (this.speed + 3));
  }
}

// =====================================================================
// Molten gold
// =====================================================================

export function moltenGoldMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlow: { value: new THREE.Vector2(0.05, 0.12) } },
    vertexShader: /* glsl */ `
      uniform float uTime; varying vec3 vPos; varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        wp.y += sin(wp.x * 0.9 + uTime * 1.3) * 0.04 + sin(wp.z * 1.3 - uTime * 1.1) * 0.03;
        vPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec2 uFlow; varying vec3 vPos; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
      void main(){
        vec2 p = vPos.xz * 0.32 + uFlow * uTime * 4.0;
        float a = fbm(p + fbm(p * 1.7 + uTime * 0.15));
        float crust = smoothstep(0.52, 0.78, a);
        float veins = (1.0 - smoothstep(0.0, 0.05, abs(a - 0.5))) * 1.4;
        vec3 hot = vec3(1.55, 0.78, 0.15);
        vec3 warm = vec3(0.95, 0.42, 0.07);
        vec3 cool = vec3(0.2, 0.08, 0.02);
        vec3 c = mix(hot, warm, smoothstep(0.25, 0.5, a));
        c = mix(c, cool, crust);
        c += vec3(1.9, 1.2, 0.4) * veins * (1.0 - crust);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}
