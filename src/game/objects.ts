import * as THREE from 'three';
import { RAPIER, Physics, G, groups, quatY, WORLD_GROUPS } from './physics';
import { cyl, rbox, sphere, star3D, torus, capsule, cone, mergeMeshes } from '../gfx/geom';
import { Mats } from '../gfx/materials';
import { TextureLib } from '../gfx/textures';
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, segmentSegmentDistance } from '../core/math';

let _id = 1;
export const newId = () => _id++;

const HAZARD = groups(G.HAZARD | G.WORLD, G.PLAYER | G.RAGDOLL | G.PROPS | G.LOOT | G.DEBRIS | G.GUARD);
const KINEMATIC_WORLD = groups(G.WORLD | G.CAMERA_BLOCK, 0xffff);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// =====================================================================
// Lasers
// =====================================================================

const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class LaserBeam {
  readonly a = new THREE.Vector3();
  readonly b = new THREE.Vector3();
  readonly core: THREE.Mesh;
  readonly halo: THREE.Mesh;
  on = true;
  amount = 1;
  active = true;

  constructor(parent: THREE.Object3D, color: number) {
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3.6) });
    const haloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(1.2),
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.core = new THREE.Mesh(UNIT_CYL, coreMat);
    this.halo = new THREE.Mesh(UNIT_CYL, haloMat);
    this.core.userData.noAO = true;
    this.halo.userData.noAO = true;
    this.halo.renderOrder = 4;
    parent.add(this.core, this.halo);
  }

  set(a: THREE.Vector3, b: THREE.Vector3) {
    this.a.copy(a);
    this.b.copy(b);
    _dir.subVectors(b, a);
    const len = _dir.length();
    _q.setFromUnitVectors(_up, _dir.normalize());
    for (const m of [this.core, this.halo]) {
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.copy(_q);
    }
    const r = 0.022 * this.amount;
    this.core.scale.set(r, len, r);
    this.halo.scale.set(0.085 * this.amount, len, 0.085 * this.amount);
    this.core.visible = this.halo.visible = this.amount > 0.02;
  }

  /** Does the beam touch a capsule (segment p→q with radius)? */
  hits(p: THREE.Vector3, q: THREE.Vector3, radius: number) {
    if (!this.active) return false;
    return segmentSegmentDistance(this.a, this.b, p, q) < radius + 0.03;
  }
}

export type LaserMotion = (t: number, beams: LaserBeam[], rig: LaserRig) => void;

export class LaserRig {
  readonly beams: LaserBeam[] = [];
  readonly group = new THREE.Group();
  disabledUntil = 0;
  powered = true;
  /** Laser rigs that only switch on once alarms are raised (3★+). */
  alarmOnly: boolean;
  zone: string;
  private motion: LaserMotion;

  constructor(parent: THREE.Object3D, count: number, motion: LaserMotion, opts: { zone: string; alarmOnly?: boolean; color?: number } = { zone: '' }) {
    parent.add(this.group);
    for (let i = 0; i < count; i++) this.beams.push(new LaserBeam(this.group, opts.color ?? 0xff1e3c));
    this.motion = motion;
    this.alarmOnly = !!opts.alarmOnly;
    this.zone = opts.zone;
  }

  update(t: number, dt: number, stars: number) {
    this.powered = t >= this.disabledUntil && (!this.alarmOnly || stars >= 3);
    this.motion(t, this.beams, this);
    for (const b of this.beams) {
      const target = this.powered && b.on ? 1 : 0;
      b.amount = damp(b.amount, target, target > b.amount ? 10 : 6, dt);
      b.active = b.amount > 0.65;
      b.set(b.a, b.b);
    }
  }
}

// =====================================================================
// Sweeper (rotating padded arm)
// =====================================================================

export class Sweeper {
  readonly id = newId();
  readonly group = new THREE.Group();
  readonly body: RAPIER.RigidBody;
  angle = 0;

  constructor(
    physics: Physics,
    parent: THREE.Object3D,
    readonly center: THREE.Vector3,
    readonly opts: { length: number; arms: number; height: number; speed: number; thickness?: number },
  ) {
    this.group.position.copy(center);
    parent.add(this.group);
    const th = opts.thickness ?? 0.42;
    const { body } = physics.kinematic(RAPIER.ColliderDesc.cylinder(0.9, 0.55).setCollisionGroups(HAZARD), center.x, center.y + 0.9, center.z);
    this.body = body;
    physics.tag(body.collider(0), { kind: 'hazard', id: this.id });
    // hub
    mesh(cyl(0.55, 0.65, 1.8, 28), Mats.gold(), this.group, 0, 0.9, 0);
    mesh(cyl(0.7, 0.7, 0.18, 28), Mats.plastic(0xd31f2b), this.group, 0, 1.85, 0);
    const star = mesh(star3D(0.38, 0.17, 0.12), Mats.glow(0xffc84a, 3.5), this.group, 0, 2.35, 0, false);
    star.userData.spin = true;
    for (let i = 0; i < opts.arms; i++) {
      const a = (i / opts.arms) * Math.PI * 2;
      const arm = new THREE.Group();
      arm.rotation.y = a;
      this.group.add(arm);
      const len = opts.length;
      mesh(rbox(len, th, th, th * 0.48, 4), Mats.candy(len / 1.2, 1), arm, len / 2 + 0.5, opts.height, 0);
      mesh(sphere(th * 0.75, 18, 12), Mats.plastic(0xd31f2b), arm, len + 0.55, opts.height, 0);
      const dx = Math.cos(a);
      const dz = -Math.sin(a);
      const c = RAPIER.ColliderDesc.cuboid(len / 2, th / 2, th / 2)
        .setTranslation(dx * (len / 2 + 0.5), opts.height - 0.9, dz * (len / 2 + 0.5))
        .setRotation(quatY(a))
        .setCollisionGroups(HAZARD);
      const col = physics.world.createCollider(c, body);
      physics.tag(col, { kind: 'hazard', id: this.id });
    }
  }

  update(dt: number) {
    this.angle += this.opts.speed * dt;
    this.body.setNextKinematicRotation(quatY(this.angle));
    this.group.rotation.y = this.angle;
  }

  knock(p: THREE.Vector3) {
    const rx = p.x - this.center.x;
    const rz = p.z - this.center.z;
    const r = Math.hypot(rx, rz) || 1;
    const s = Math.sign(this.opts.speed);
    // tangential direction of the arm's motion at the player's position
    const tx = (-rz / r) * -s;
    const tz = (rx / r) * -s;
    const speed = 6 + Math.abs(this.opts.speed) * r * 0.55;
    return new THREE.Vector3(tx * speed + (rx / r) * 2.5, 6.5, tz * speed + (rz / r) * 2.5);
  }
}

// =====================================================================
// Moving platform
// =====================================================================

export class MovingPlatform {
  readonly id = newId();
  readonly body: RAPIER.RigidBody;
  readonly pos = new THREE.Vector3();
  readonly delta = new THREE.Vector3();
  private started = false;
  readonly half: THREE.Vector3;

  constructor(
    private physics: Physics,
    readonly obj: THREE.Object3D,
    halfExtents: THREE.Vector3,
    private path: (t: number, out: THREE.Vector3) => void,
  ) {
    this.half = halfExtents.clone();
    path(0, this.pos);
    const { body, col } = physics.kinematic(
      RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z).setCollisionGroups(KINEMATIC_WORLD),
      this.pos.x,
      this.pos.y,
      this.pos.z,
    );
    this.body = body;
    physics.tag(col, { kind: 'platform', id: this.id });
    obj.position.copy(this.pos);
  }

  /** Extra solid part riding with the platform (railings, cage posts); offsets are local. */
  addSolid(x: number, y: number, z: number, w: number, h: number, d: number) {
    const c = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z).setCollisionGroups(groups(G.WORLD, 0xffff)),
      this.body,
    );
    this.physics.tag(c, { kind: 'platform', id: this.id });
  }

  /** Height of the standing surface. */
  top() {
    return this.pos.y + this.half.y;
  }

  contains(x: number, z: number, margin = 0.3) {
    return Math.abs(x - this.pos.x) < this.half.x + margin && Math.abs(z - this.pos.z) < this.half.z + margin;
  }

  update(t: number) {
    const prevX = this.pos.x;
    const prevY = this.pos.y;
    const prevZ = this.pos.z;
    this.path(t, this.pos);
    if (!this.started) {
      this.started = true;
      this.delta.set(0, 0, 0);
    } else this.delta.set(this.pos.x - prevX, this.pos.y - prevY, this.pos.z - prevZ);
    this.body.setNextKinematicTranslation(this.pos);
    this.obj.position.copy(this.pos);
  }
}

// =====================================================================
// Conveyor belt
// =====================================================================

export class Conveyor {
  readonly velocity: THREE.Vector3;
  readonly box: THREE.Box3;
  private tex: THREE.Texture;
  private rollers: THREE.Mesh[] = [];
  private speed: number;

  constructor(
    physics: Physics,
    parent: THREE.Object3D,
    center: THREE.Vector3,
    width: number,
    length: number,
    alongX: boolean,
    speed: number,
  ) {
    this.speed = speed;
    const g = new THREE.Group();
    g.position.copy(center);
    if (alongX) g.rotation.y = Math.PI / 2;
    parent.add(g);
    const h = 0.5;
    mesh(rbox(width + 0.3, h, length + 0.3, 0.1), Mats.gunmetal(), g, 0, -h / 2 - 0.02, 0);
    this.tex = TextureLib.belt().clone();
    this.tex.repeat.set(1, length / 1.6);
    this.tex.needsUpdate = true;
    const beltMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.7 });
    const top = mesh(new THREE.PlaneGeometry(width, length), beltMat, g, 0, 0.005, 0, false);
    top.rotation.x = -Math.PI / 2;
    if (speed < 0) top.rotation.z = Math.PI;
    for (const s of [-1, 1]) {
      mesh(rbox(0.16, 0.24, length + 0.3, 0.06), Mats.hazard(1, length / 2), g, s * (width / 2 + 0.12), 0.06, 0);
      const roller = mesh(cyl(0.26, 0.26, width + 0.05, 20), Mats.chrome(), g, 0, -0.24, s * (length / 2 + 0.05));
      roller.rotation.z = Math.PI / 2;
      this.rollers.push(roller);
    }
    const dir = new THREE.Vector3(0, 0, 1).applyAxisAngle(_up, g.rotation.y);
    this.velocity = dir.multiplyScalar(speed);
    const col = physics.box(center.x, center.y - h / 2, center.z, alongX ? length : width, h, alongX ? width : length);
    physics.tag(col, { kind: 'conveyor', velocity: this.velocity });
    const hx = (alongX ? length : width) / 2;
    const hz = (alongX ? width : length) / 2;
    this.box = new THREE.Box3(new THREE.Vector3(center.x - hx, center.y - 0.2, center.z - hz), new THREE.Vector3(center.x + hx, center.y + 1.2, center.z + hz));
  }

  update(dt: number) {
    this.tex.offset.y -= (Math.abs(this.speed) * dt) / 1.6;
    for (const r of this.rollers) r.rotation.x += this.speed * dt * 3.8;
  }
}

// =====================================================================
// Pressure plate + timed gate
// =====================================================================

export class PressurePlate {
  readonly top: THREE.Mesh;
  private ring: THREE.Mesh;
  pressed = false;
  private amt = 0;

  constructor(parent: THREE.Object3D, readonly pos: THREE.Vector3, readonly radius = 1.0) {
    const g = new THREE.Group();
    g.position.copy(pos);
    parent.add(g);
    mesh(cyl(radius + 0.2, radius + 0.28, 0.12, 40), Mats.gold(), g, 0, 0.06, 0);
    this.top = mesh(cyl(radius, radius, 0.12, 40), Mats.plastic(0xd31f2b), g, 0, 0.12, 0);
    this.ring = mesh(torus(radius * 0.7, 0.05, 8, 40), Mats.glow(0xff4d5e, 3), g, 0, 0.19, 0, false);
    this.ring.rotation.x = Math.PI / 2;
  }

  update(dt: number, pressed: boolean) {
    this.pressed = pressed;
    this.amt = damp(this.amt, pressed ? 1 : 0, 14, dt);
    this.top.position.y = 0.12 - this.amt * 0.08;
    this.ring.material = pressed ? Mats.glow(0x4dff8a, 4) : Mats.glow(0xff4d5e, 3);
  }
}

export class TimedGate {
  readonly body: RAPIER.RigidBody;
  readonly group = new THREE.Group();
  private door: THREE.Group;
  private lights: THREE.Mesh[] = [];
  open = 0;
  timer = 0;
  readonly doorway: THREE.Box3;

  constructor(
    physics: Physics,
    parent: THREE.Object3D,
    readonly pos: THREE.Vector3,
    readonly width: number,
    readonly height: number,
    readonly rotY: number,
    readonly duration = 4,
  ) {
    this.group.position.copy(pos);
    this.group.rotation.y = rotY;
    parent.add(this.group);
    this.door = new THREE.Group();
    this.group.add(this.door);
    // armored bars door
    mesh(rbox(width, height, 0.35, 0.08), Mats.steel(), this.door, 0, height / 2, 0);
    for (let i = 0; i < 5; i++) {
      mesh(rbox(width * 0.9, 0.12, 0.42, 0.05), Mats.goldSatin(), this.door, 0, 0.5 + i * (height - 0.8) / 4, 0);
    }
    mesh(star3D(0.45, 0.2, 0.1), Mats.gold(), this.door, 0, height * 0.55, 0.24);
    // frame & countdown lights
    mesh(rbox(0.5, height + 0.6, 0.7, 0.1), Mats.darkMetal(), this.group, -width / 2 - 0.25, (height + 0.6) / 2, 0);
    mesh(rbox(0.5, height + 0.6, 0.7, 0.1), Mats.darkMetal(), this.group, width / 2 + 0.25, (height + 0.6) / 2, 0);
    mesh(rbox(width + 1, 0.6, 0.7, 0.1), Mats.darkMetal(), this.group, 0, height + 0.3, 0);
    for (let i = 0; i < 6; i++) {
      const l = mesh(sphere(0.09, 12, 8), Mats.glow(0x333333, 1), this.group, -width / 2 + 0.35 + (i * (width - 0.7)) / 5, height + 0.3, 0.38, false);
      this.lights.push(l);
    }
    const q = quatY(rotY);
    const { body } = physics.kinematic(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, 0.2).setCollisionGroups(KINEMATIC_WORLD), pos.x, pos.y + height / 2, pos.z);
    body.setRotation(q, true);
    this.body = body;
    const ext = new THREE.Vector3(width / 2 + 0.2, height / 2, 1.0).applyAxisAngle(_up, rotY);
    const c = pos.clone().setY(pos.y + height / 2);
    this.doorway = new THREE.Box3(
      new THREE.Vector3(c.x - Math.abs(ext.x), pos.y - 0.5, c.z - Math.abs(ext.z)),
      new THREE.Vector3(c.x + Math.abs(ext.x), pos.y + height, c.z + Math.abs(ext.z)),
    );
  }

  update(dt: number, held: boolean, playerInDoorway: boolean) {
    if (held) this.timer = this.duration;
    else this.timer = Math.max(0, this.timer - dt);
    const target = this.timer > 0 || (playerInDoorway && this.open > 0.2) ? 1 : 0;
    this.open = clamp(this.open + (target > this.open ? dt * 2.8 : -dt * 0.9), 0, 1);
    const y = this.pos.y + this.height / 2 + easeInOutCubic(this.open) * (this.height + 0.1);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y, z: this.pos.z });
    this.door.position.y = y - this.pos.y - this.height / 2;
    const lit = Math.ceil((this.timer / this.duration) * this.lights.length);
    this.lights.forEach((l, i) => {
      l.material = i < lit ? (this.timer < 1.2 && Math.floor(this.timer * 8) % 2 ? Mats.glow(0xff4d5e, 5) : Mats.glow(0x4dff8a, 5)) : Mats.glow(0x332222, 1);
    });
  }
}

// =====================================================================
// Security shutter (closes periodically at 4★+)
// =====================================================================

export class Shutter {
  readonly body: RAPIER.RigidBody;
  readonly group = new THREE.Group();
  private panel: THREE.Group;
  private warn: THREE.Mesh[] = [];
  close = 0;
  readonly doorway: THREE.Box3;

  constructor(
    physics: Physics,
    parent: THREE.Object3D,
    readonly pos: THREE.Vector3,
    readonly width: number,
    readonly height: number,
    readonly rotY: number,
    readonly offset = 0,
  ) {
    this.group.position.copy(pos);
    this.group.rotation.y = rotY;
    parent.add(this.group);
    this.panel = new THREE.Group();
    this.group.add(this.panel);
    for (let i = 0; i < 8; i++) mesh(rbox(width, height / 8 - 0.04, 0.18, 0.05), Mats.steelPlain(), this.panel, 0, height + 0.2 + i * (height / 8), 0);
    mesh(rbox(width, 0.2, 0.3, 0.05), Mats.hazard(width / 1.5, 1), this.panel, 0, height + 0.1, 0);
    mesh(rbox(width + 0.8, 0.6, 0.5, 0.08), Mats.darkMetal(), this.group, 0, height + 0.3, 0);
    for (const s of [-1, 1]) {
      const w = mesh(sphere(0.14, 12, 10), Mats.glow(0x332200, 1), this.group, s * (width / 2 + 0.1), height + 0.3, 0.3, false);
      this.warn.push(w);
    }
    const { body } = physics.kinematic(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, 0.12).setCollisionGroups(KINEMATIC_WORLD), pos.x, pos.y + height * 1.5 + 1, pos.z);
    body.setRotation(quatY(rotY), true);
    this.body = body;
    const ext = new THREE.Vector3(width / 2 + 0.2, 0, 0.9).applyAxisAngle(_up, rotY);
    this.doorway = new THREE.Box3(
      new THREE.Vector3(pos.x - Math.abs(ext.x), pos.y - 0.5, pos.z - Math.abs(ext.z)),
      new THREE.Vector3(pos.x + Math.abs(ext.x), pos.y + height, pos.z + Math.abs(ext.z)),
    );
  }

  /** Returns true the moment the shutter starts closing (for SFX). */
  update(t: number, dt: number, stars: number, playerInDoorway: boolean) {
    let target = 0;
    let warning = false;
    if (stars >= 4) {
      const period = stars >= 5 ? 6 : 7.5;
      const closedFor = stars >= 5 ? 3.2 : 2.6;
      const ph = (t + this.offset) % period;
      target = ph < closedFor ? 1 : 0;
      warning = ph > period - 1.2;
    }
    if (playerInDoorway && this.close < 0.85) target = 0;
    const before = this.close;
    this.close = clamp(this.close + (target > this.close ? dt * 2.2 : -dt * 2.6), 0, 1);
    const yOff = (1 - easeInOutCubic(this.close)) * (this.height + 0.2);
    this.panel.position.y = -this.height - 0.2 + (this.height + 0.2) * 0 + yOff - 0.0;
    this.panel.position.y = yOff - this.height - 0.2;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.height / 2 + yOff, z: this.pos.z });
    const blink = (warning || (this.close > 0.01 && this.close < 0.99)) && Math.floor(t * 6) % 2 === 0;
    for (const w of this.warn) w.material = blink ? Mats.glow(0xffa21a, 6) : Mats.glow(0x332200, 1);
    return before < 0.02 && this.close >= 0.02;
  }
}

// =====================================================================
// Automatic sliding glass doors
// =====================================================================

export class AutoDoor {
  private panels: { body: RAPIER.RigidBody; mesh: THREE.Group; closedX: number; side: number }[] = [];
  open = 0;

  constructor(physics: Physics, parent: THREE.Object3D, readonly center: THREE.Vector3, readonly width: number, readonly height: number) {
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      parent.add(g);
      const pw = width / 2;
      mesh(rbox(pw, height, 0.12, 0.04), Mats.glass(), g, 0, height / 2, 0, false);
      mesh(rbox(pw, 0.14, 0.16, 0.04), Mats.gold(), g, 0, 0.07, 0);
      mesh(rbox(pw, 0.14, 0.16, 0.04), Mats.gold(), g, 0, height - 0.07, 0);
      mesh(rbox(0.12, height, 0.16, 0.04), Mats.gold(), g, side * (pw / 2 - 0.06), height / 2, 0);
      mesh(rbox(0.06, 0.9, 0.22, 0.03), Mats.gold(), g, -side * (pw / 2 - 0.2), height * 0.5, 0);
      const closedX = center.x + side * (pw / 2);
      const { body } = physics.kinematic(RAPIER.ColliderDesc.cuboid(pw / 2, height / 2, 0.08).setCollisionGroups(KINEMATIC_WORLD), closedX, center.y + height / 2, center.z);
      this.panels.push({ body, mesh: g, closedX, side });
    }
  }

  update(dt: number, playerPos: THREE.Vector3) {
    const near = Math.hypot(playerPos.x - this.center.x, playerPos.z - this.center.z) < 5.5;
    const before = this.open;
    this.open = clamp(this.open + (near ? dt * 2.5 : -dt * 1.5), 0, 1);
    const e = easeOutCubic(this.open);
    for (const p of this.panels) {
      const x = p.closedX + p.side * e * (this.width / 2 - 0.1);
      p.body.setNextKinematicTranslation({ x, y: this.center.y + this.height / 2, z: this.center.z });
      p.mesh.position.set(x, this.center.y, this.center.z);
    }
    return before === 0 && this.open > 0;
  }
}

// =====================================================================
// The giant vault door
// =====================================================================

export type VaultState = 'locked' | 'cracking' | 'opening' | 'open';

export class VaultDoor {
  readonly hinge = new THREE.Group();
  private door = new THREE.Group();
  private wheel = new THREE.Group();
  private dial: THREE.Mesh;
  private bolts: THREE.Mesh[] = [];
  private body: RAPIER.RigidBody;
  private glow: THREE.Mesh;
  state: VaultState = 'locked';
  private t = 0;
  dialAngle = 0;
  readonly front: THREE.Vector3;
  onBoom: (() => void) | null = null;
  private boomed = false;

  constructor(physics: Physics | null, parent: THREE.Object3D, readonly center: THREE.Vector3, readonly R: number) {
    // Hinge on the left (−X) when facing the door from +Z.
    this.hinge.position.set(center.x - R, center.y, center.z);
    parent.add(this.hinge);
    this.hinge.add(this.door);
    this.door.position.set(R, 0, 0);
    const d = this.door;
    const doorStatics: THREE.Mesh[] = [];
    const disc = mesh(cyl(R, R, 0.8, 72), Mats.steel(), d);
    disc.rotation.x = Math.PI / 2;
    const rim = mesh(torus(R - 0.05, 0.16, 16, 72), Mats.chrome(), d, 0, 0, 0.42);
    rim.castShadow = false;
    const ring2 = mesh(torus(R * 0.72, 0.09, 12, 64), Mats.gold(), d, 0, 0, 0.42);
    ring2.castShadow = false;
    const inner = mesh(cyl(R * 0.68, R * 0.7, 0.12, 64), Mats.steelPlain(), d, 0, 0, 0.44);
    inner.rotation.x = Math.PI / 2;
    doorStatics.push(disc, rim, ring2, inner);
    // rivets ring
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      doorStatics.push(mesh(sphere(0.08, 10, 8), Mats.gold(), d, Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85, 0.42, false));
    }
    mergeMeshes(d, doorStatics);
    // locking bolts sticking out of the rim
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.31;
      const b = mesh(cyl(0.16, 0.16, 0.8, 16), Mats.chrome(), d, Math.cos(a) * (R + 0.15), Math.sin(a) * (R + 0.15), 0);
      b.rotation.z = a - Math.PI / 2;
      b.userData.dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
      this.bolts.push(b);
    }
    // central hub + spoked wheel
    this.wheel.position.set(0, 0, 0.55);
    d.add(this.wheel);
    const hub = mesh(cyl(0.42, 0.48, 0.3, 32), Mats.gold(), this.wheel);
    hub.rotation.x = Math.PI / 2;
    mesh(star3D(0.3, 0.13, 0.08), Mats.glow(0xffc84a, 2.2), this.wheel, 0, 0, 0.2, false);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spoke = mesh(capsule(0.07, R * 0.42, 6, 10), Mats.chrome(), this.wheel, Math.cos(a) * R * 0.27, Math.sin(a) * R * 0.27, 0);
      spoke.rotation.z = a - Math.PI / 2;
      mesh(sphere(0.14, 14, 10), Mats.gold(), this.wheel, Math.cos(a) * R * 0.52, Math.sin(a) * R * 0.52, 0);
    }
    // combination dial
    this.dial = mesh(cyl(0.48, 0.5, 0.16, 48), new THREE.MeshPhysicalMaterial({ map: TextureLib.vaultDial(), metalness: 0.6, roughness: 0.3 }), d, R * 0.5, R * 0.42, 0.5);
    this.dial.rotation.x = Math.PI / 2;
    mesh(cone(0.08, 0.16, 3), Mats.glow(0xff4d5e, 4), d, R * 0.5, R * 0.42 + 0.62, 0.52, false).rotation.z = Math.PI;
    // golden light spilling out once open
    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(R * 0.98, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.8, 0.7), transparent: true, opacity: 0, depthWrite: false }),
    );
    this.glow.position.set(center.x, center.y, center.z - 0.45);
    this.glow.userData.noAO = true;
    parent.add(this.glow);

    this.front = new THREE.Vector3(center.x + R * 0.45, 0, center.z + 1.6);

    if (physics) {
      const { body } = physics.kinematic(
        RAPIER.ColliderDesc.cylinder(0.4, R).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setCollisionGroups(KINEMATIC_WORLD),
        center.x,
        center.y,
        center.z,
      );
      this.body = body;
    } else {
      this.body = null as unknown as RAPIER.RigidBody;
    }
  }

  setDial(angle: number) {
    this.dialAngle = angle;
    this.dial.rotation.y = angle;
  }

  open() {
    if (this.state === 'opening' || this.state === 'open') return;
    this.state = 'opening';
    this.t = 0;
    this.boomed = false;
  }

  /** Progress 0..1 of the opening animation. */
  get progress() {
    return this.state === 'open' ? 1 : this.state === 'opening' ? clamp(this.t / 3.6, 0, 1) : 0;
  }

  update(dt: number) {
    if (this.state !== 'opening') return;
    this.t += dt;
    const t = this.t;
    // 1) wheel spins & bolts retract
    const spin = clamp(t / 1.1, 0, 1);
    this.wheel.rotation.z = -easeInOutCubic(spin) * Math.PI * 3;
    for (const b of this.bolts) {
      const dir = b.userData.dir as THREE.Vector2;
      const r = this.R + 0.15 - easeInOutCubic(spin) * 0.75;
      b.position.set(dir.x * r, dir.y * r, 0);
    }
    if (t > 1.1 && !this.boomed) {
      this.boomed = true;
      this.onBoom?.();
    }
    // 2) door pops outward then swings inward on its hinge
    const pop = clamp((t - 1.1) / 0.35, 0, 1);
    const swing = clamp((t - 1.45) / 2.2, 0, 1);
    const e = easeInOutCubic(swing);
    const overshoot = swing >= 1 ? 0 : Math.sin(swing * Math.PI) * 0.05;
    const angle = e * 1.82 + overshoot;
    this.hinge.rotation.y = angle;
    this.door.position.z = Math.sin(pop * Math.PI) * 0.25 - pop * 0.0;
    (this.glow.material as THREE.MeshBasicMaterial).opacity = clamp(swing * 1.4, 0, 0.85) * (1 - swing * 0.6);
    // kinematic collider follows the door's center
    const c = new THREE.Vector3(this.R, 0, 0).applyAxisAngle(_up, angle).add(this.hinge.position);
    const q = new THREE.Quaternion().setFromAxisAngle(_up, angle).multiply(new THREE.Quaternion(Math.SQRT1_2, 0, 0, Math.SQRT1_2));
    if (this.body) {
      this.body.setNextKinematicTranslation(c);
      this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    if (t > 3.7) this.state = 'open';
  }
}

// =====================================================================
// Generic trigger volume
// =====================================================================

export class Trigger {
  fired = false;
  constructor(
    readonly box: THREE.Box3,
    readonly onEnter: () => void,
    readonly once = true,
  ) {}
  check(p: THREE.Vector3) {
    if (this.fired && this.once) return;
    if (this.box.containsPoint(p)) {
      if (!this.fired) this.onEnter();
      this.fired = true;
    } else if (!this.once) this.fired = false;
  }
}

export interface Interactable {
  pos: THREE.Vector3;
  radius: number;
  prompt: string;
  enabled: () => boolean;
  interact: () => void;
}

export { lerp };
