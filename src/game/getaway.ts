import * as THREE from 'three';
import { RAPIER, Physics, quatY } from './physics';
import { buildVan, buildPoliceCar, strobe, type PoliceRig, type VanRig, type VehicleRig } from '../gfx/vehicles';
import { ParticleSystem } from '../gfx/Particles';
import { Mats } from '../gfx/materials';
import { TextureLib } from '../gfx/textures';
import { cone } from '../gfx/geom';
import { Spring, clamp, damp, easeInOutCubic, easeOutCubic, lerp, noise1 } from '../core/math';

/**
 * The getaway: a parked delivery van with its engine running, an extraction
 * ring at its open rear doors, and the scripted escape that plays once the
 * robber jumps in — door slam, burnout, the chase down the street and the
 * van drifting out of sight.
 */

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

// =====================================================================
// Tire tracks: dark quads laid behind the rear wheels
// =====================================================================

export class TireTracks {
  private mesh: THREE.InstancedMesh;
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private p = new THREE.Vector3();

  constructor(parent: THREE.Object3D, readonly max = 700) {
    const geo = new THREE.PlaneGeometry(0.24, 0.62);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1c22, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.userData.noAO = true;
    this.mesh.renderOrder = 2;
    parent.add(this.mesh);
  }

  stamp(at: THREE.Vector3, heading: number, width = 1) {
    this.q.setFromAxisAngle(UP, heading + Math.PI / 2);
    this.p.set(at.x, 0.025, at.z);
    this.s.set(width, 1, 1);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.next, this.m);
    this.next = (this.next + 1) % this.max;
    this.mesh.count = Math.min(this.max, Math.max(this.mesh.count, this.next === 0 ? this.max : this.next));
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// =====================================================================
// Scripted driving along a path with a simple suspension model
// =====================================================================

export class Driver {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  s = 0;
  v = 0;
  /** Extra yaw (drift / spin), radians. */
  slip = 0;
  private pitch = new Spring(0, 90, 11);
  private roll = new Spring(0, 80, 10);
  private heave = new Spring(0, 140, 14);
  private lastV = 0;
  readonly pos = new THREE.Vector3();
  readonly dir = new THREE.Vector3(1, 0, 0);
  heading = 0;
  curvature = 0;
  accel = 0;
  private trackAcc = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(
    readonly rig: VehicleRig,
    points: THREE.Vector3[],
    readonly wheelbase: number,
  ) {
    this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    this.length = this.curve.getLength();
    this.place(0, 0);
  }

  /** Signed curvature (1/m) at arc length s (positive = turning left). */
  curvatureAt(s: number) {
    const u0 = clamp((s - 1.5) / this.length, 0, 1);
    const u1 = clamp((s + 1.5) / this.length, 0, 1);
    const t0 = this.curve.getTangentAt(u0, this.tmpA);
    const t1 = this.curve.getTangentAt(u1, this.tmpB);
    const a0 = Math.atan2(t0.x, t0.z);
    const a1 = Math.atan2(t1.x, t1.z);
    let d = a1 - a0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const ds = (u1 - u0) * this.length;
    return ds > 0.01 ? d / ds : 0;
  }

  /** Speed that keeps the lateral acceleration under `latMax` around upcoming bends. */
  safeSpeed(lookahead: number, latMax: number) {
    let k = 0;
    for (let d = 0; d <= lookahead; d += 3) k = Math.max(k, Math.abs(this.curvatureAt(this.s + d)));
    return k > 1e-4 ? Math.sqrt(latMax / k) : 99;
  }

  /** Accelerate towards `target` with the given limits, then move. */
  drive(dt: number, target: number, accel: number, brake: number) {
    if (this.v < target) this.v = Math.min(target, this.v + accel * dt);
    else this.v = Math.max(target, this.v - brake * dt);
    this.s = Math.min(this.length, this.s + this.v * dt);
    if (this.s >= this.length) this.v = 0;
  }

  /** Places the rig; `wheelSpin` overrides the wheel rotation speed (burnouts). */
  place(dt: number, wheelSpin?: number, rearOnly = false) {
    const u = clamp(this.s / this.length, 0, 1);
    this.curve.getPointAt(u, this.pos);
    this.curve.getTangentAt(u, this.dir);
    this.curvature = this.curvatureAt(this.s);
    const pathYaw = Math.atan2(this.dir.x, this.dir.z);
    this.heading = pathYaw - Math.PI / 2 + this.slip; // local +X forward
    const r = this.rig;
    r.root.position.set(this.pos.x, 0, this.pos.z);
    r.root.rotation.y = this.heading;
    if (dt <= 0) return;
    // suspension: squat under throttle, dive under braking, lean out of turns
    this.accel = (this.v - this.lastV) / dt;
    this.lastV = this.v;
    const lat = this.v * this.v * this.curvature;
    const p = this.pitch.update(clamp(this.accel * 0.006, -0.06, 0.06), dt);
    const ro = this.roll.update(clamp(lat * 0.0075, -0.08, 0.08), dt); // lean out of the bend
    const hv = this.heave.update(0, dt);
    r.body.rotation.set(ro, 0, p, 'YXZ');
    r.body.position.y = hv + (this.v > 2 ? noise1(this.s * 1.7) * 0.012 : 0);
    // wheels: roll + steer into the bend
    const steer = clamp(Math.atan(this.curvature * this.wheelbase) - this.slip * 0.6, -0.6, 0.6);
    for (const w of r.wheels) {
      const spin = wheelSpin !== undefined && (!rearOnly || !w.front) ? wheelSpin : this.v;
      w.spin.rotation.z -= (spin * dt) / w.radius;
      if (w.front) w.steer.rotation.y = damp(w.steer.rotation.y, steer, 10, dt);
    }
  }

  kick(pitch: number, roll: number, heave = 0) {
    this.pitch.kick(pitch);
    this.roll.kick(roll);
    this.heave.kick(heave);
  }

  /** World-space point in the vehicle's frame. */
  local(x: number, y: number, z: number, out = new THREE.Vector3()) {
    out.set(x, y, z).applyAxisAngle(UP, this.heading);
    out.x += this.pos.x;
    out.z += this.pos.z;
    return out;
  }

  /** Lay tracks / spray behind the rear wheels every ~0.32 m. */
  trail(dt: number, tracks: TireTracks, onWheel?: (p: THREE.Vector3) => void, extraSpin = 0) {
    this.trackAcc += (this.v + extraSpin) * dt;
    if (this.trackAcc < 0.32) return;
    this.trackAcc = 0;
    for (const w of this.rig.wheels) {
      if (w.front) continue;
      const lp = w.steer.position;
      const p = this.local(lp.x, 0, lp.z, this.tmpA);
      tracks.stamp(p, this.heading);
      onWheel?.(p);
    }
  }
}

// =====================================================================
// The van, parked and waiting
// =====================================================================

export class GetawayVan {
  readonly rig: VanRig;
  readonly ring: THREE.Mesh;
  readonly beam: THREE.Mesh;
  private arrows: THREE.Mesh[] = [];
  readonly extraction: THREE.Vector3;
  readonly radius = 2.4;
  private t = 0;
  private idle = new Spring(0, 160, 8);
  leaving = 0;
  readonly front = new THREE.Vector3();
  private exhaustP = new THREE.Vector3();
  private puffT = 0;
  driving = false;
  /** Emit an exhaust puff (wired to the smoke particles by the heist). */
  onExhaust: ((at: THREE.Vector3, strength: number) => void) | null = null;

  constructor(
    physics: Physics,
    parent: THREE.Object3D,
    readonly pos: THREE.Vector3,
    readonly rotY: number,
  ) {
    this.rig = buildVan();
    this.rig.root.position.copy(pos);
    this.rig.root.rotation.y = rotY;
    parent.add(this.rig.root);
    for (const d of this.rig.doors) d.rotation.y = Math.sign(d.position.z) * 1.95;
    const q = quatY(rotY);
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2.95, 1.3, 1.05).setTranslation(pos.x, pos.y + 1.3, pos.z).setRotation(q));
    // extraction ring behind the open rear doors
    const back = new THREE.Vector3(-5.2, 0, 0).applyAxisAngle(UP, rotY).add(pos);
    this.extraction = back;
    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(this.radius * 2.2, this.radius * 2.2),
      new THREE.MeshBasicMaterial({ map: TextureLib.extractionRing(), transparent: true, depthWrite: false, color: new THREE.Color(1.15, 1.15, 1.15) }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(back.x, back.y + 0.05, back.z);
    this.ring.userData.noAO = true;
    parent.add(this.ring);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * 0.35 * (0.75 + 0.25 * sin(vUv.y * 20.0 - uTime * 4.0)); gl_FragColor = vec4(0.4, 1.4, 0.7, a);} `,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(this.radius, this.radius, 7, 32, 1, true), beamMat);
    this.beam.position.set(back.x, back.y + 3.5, back.z);
    this.beam.userData.noAO = true;
    parent.add(this.beam);
    for (let i = 0; i < 3; i++) {
      const arrow = new THREE.Mesh(cone(0.35, 0.5, 4), Mats.glow(0x6dffa8, 3));
      arrow.rotation.x = Math.PI;
      arrow.position.set(back.x, back.y + 2.2 + i * 0.7, back.z);
      arrow.userData.noAO = true;
      parent.add(arrow);
      this.arrows.push(arrow);
    }
    this.updateFront();
  }

  private updateFront() {
    this.front.set(3.0, 1.1, 0).applyAxisAngle(UP, this.rig.root.rotation.y).add(this.rig.root.position);
  }

  setExtractionVisible(v: boolean) {
    this.ring.visible = this.beam.visible = v;
    for (const a of this.arrows) a.visible = v;
  }

  inZone(p: THREE.Vector3) {
    return Math.hypot(p.x - this.extraction.x, p.z - this.extraction.z) < this.radius && Math.abs(p.y - this.extraction.y) < 2.5;
  }

  /** World position of the rear opening (where the robber dives in). */
  cargoWorld(out = new THREE.Vector3()) {
    return out.copy(this.rig.cargo).applyAxisAngle(UP, this.rig.root.rotation.y).add(this.rig.root.position);
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    (this.beam.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    this.ring.rotation.z += dt * 0.6;
    this.arrows.forEach((a, i) => {
      a.position.y = this.extraction.y + 2.0 + i * 0.6 + Math.sin(t * 4 - i * 0.8) * 0.2;
    });
    if (!this.driving) {
      // engine idling: a fine shudder through the body
      const shake = this.idle.update(Math.sin(t * 31) * 0.0025 + noise1(t * 3) * 0.002, dt);
      this.rig.body.rotation.x = shake;
      this.rig.body.position.y = Math.abs(Math.sin(t * 15)) * 0.004;
    }
    this.updateFront();
    this.puffT -= dt;
    if (this.puffT <= 0 && this.onExhaust) {
      this.puffT = this.driving ? 0.05 : 0.22;
      this.rig.exhaust!.getWorldPosition(this.exhaustP);
      this.onExhaust(this.exhaustP, this.driving ? 1 : 0.35);
    }
  }

  depart() {
    if (this.leaving === 0) this.leaving = 0.0001;
  }

  get bodyPosition() {
    return this.rig.body.getWorldPosition(new THREE.Vector3());
  }
}

// =====================================================================
// Police units (parked at the roadblock or chasing in the cinematic)
// =====================================================================

export class PoliceUnit {
  readonly rig: PoliceRig;
  driver: Driver | null = null;
  lights = true;
  active = true;
  private t = Math.random() * 3;

  constructor(parent: THREE.Object3D, pos: THREE.Vector3, rotY: number, unit: number) {
    this.rig = buildPoliceCar(unit);
    this.rig.root.position.copy(pos);
    this.rig.root.rotation.y = rotY;
    parent.add(this.rig.root);
  }

  /** Returns the current strobe side (1 red, −1 blue, 0 dark) for the shared light. */
  update(dt: number) {
    this.t += dt;
    return strobe(this.rig, this.t, this.lights);
  }
}

// =====================================================================
// The escape cinematic
// =====================================================================

export interface CinematicContext {
  van: GetawayVan;
  chase: PoliceUnit[];
  parked: PoliceUnit[];
  tracks: TireTracks;
  smoke: ParticleSystem;
  /** Camera control. */
  shot: (pos: THREE.Vector3, look: THREE.Vector3, fov: number) => void;
  /** Robber's visual (moved into the van, then hidden). */
  bean: { root: THREE.Object3D; setVisible: (v: boolean) => void; pose: (dt: number) => void };
  blob: THREE.Object3D;
  sfx: (name: 'slam' | 'rev' | 'skid' | 'crashBig' | 'engine' | 'door', volume: number, at?: THREE.Vector3) => void;
  siren: (on: boolean) => void;
  title: (title: string, sub: string) => void;
  heli: { follow: THREE.Vector3 | null } | null;
  /** Shared spot light (headlights) and police strobe light. */
  headlight: THREE.SpotLight | null;
  policeLight: THREE.PointLight | null;
  shake: (amount: number) => void;
  /** Big snow burst (crash). */
  snowBurst: (at: THREE.Vector3, count: number) => void;
}

export class EscapeCinematic {
  t = 0;
  done = false;
  private from = new THREE.Vector3();
  private vanDrive: Driver;
  private chase: { unit: PoliceUnit; drv: Driver; start: number; v0: number; crash: boolean; crashed: boolean; spin: number; started: boolean }[] = [];
  private jitter = new THREE.Vector3();
  private slammed = false;
  private revved = false;
  private launched = false;
  private skidT = 0;
  private titled = false;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shotId = '';
  private shotT = 0;
  private trackCam = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private cornerReached = -1;
  static readonly LENGTH = 11.2;

  constructor(private c: CinematicContext) {
    const v = c.van;
    const x = v.pos.x;
    const z = v.pos.z;
    // main street east, then a hard left into the side street
    this.vanDrive = new Driver(
      v.rig,
      [
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x + 18, 0, z),
        new THREE.Vector3(x + 46, 0, z + 0.2),
        new THREE.Vector3(x + 64, 0, z - 0.6),
        new THREE.Vector3(x + 73, 0, z - 5.5),
        new THREE.Vector3(x + 76, 0, z - 14),
        new THREE.Vector3(x + 76.6, 0, z - 40),
        new THREE.Vector3(x + 77, 0, z - 110),
      ],
      3.3,
    );
    // police: down the north side street, around the corner after the van
    const sx = x - 12.5;
    const p1 = [
      new THREE.Vector3(sx, 0, z + 62),
      new THREE.Vector3(sx, 0, z + 16),
      new THREE.Vector3(sx + 1.6, 0, z + 6),
      new THREE.Vector3(sx + 7.5, 0, z + 0.4),
      new THREE.Vector3(x + 12, 0, z - 1.0),
      new THREE.Vector3(x + 46, 0, z - 0.6),
      new THREE.Vector3(x + 64, 0, z - 1.2),
      new THREE.Vector3(x + 72.5, 0, z - 6.5),
      new THREE.Vector3(x + 75.6, 0, z - 15),
      new THREE.Vector3(x + 76.4, 0, z - 40),
      new THREE.Vector3(x + 77, 0, z - 110),
    ];
    const p2 = [
      new THREE.Vector3(sx - 1, 0, z + 66),
      new THREE.Vector3(sx - 1, 0, z + 16),
      new THREE.Vector3(sx, 0, z + 6),
      new THREE.Vector3(sx + 5, 0, z - 2.5),
      new THREE.Vector3(sx + 9.5, 0, z - 8.5),
      new THREE.Vector3(sx + 11.5, 0, z - 11.5),
    ];
    const units = c.chase;
    // already flat out when they come into view
    if (units[0]) this.chase.push({ unit: units[0], drv: new Driver(units[0].rig, p1, 2.85), start: 2.3, v0: 21, crash: false, crashed: false, spin: 0, started: false });
    if (units[1]) this.chase.push({ unit: units[1], drv: new Driver(units[1].rig, p2, 2.85), start: 3.4, v0: 23, crash: true, crashed: false, spin: 0, started: false });
    for (const ch of this.chase) {
      ch.unit.rig.root.visible = false;
      ch.unit.driver = ch.drv;
    }
  }

  start(from: THREE.Vector3) {
    this.from.copy(from);
    this.t = 0;
    this.c.van.driving = true;
    this.vanDrive.place(0);
  }

  skip() {
    if (this.done) return;
    this.t = EscapeCinematic.LENGTH;
    this.c.bean.setVisible(false);
    this.c.siren(false);
    this.done = true;
  }

  /** Returns true when finished. */
  update(dt: number) {
    if (this.done) return true;
    this.t += dt;
    const t = this.t;
    const c = this.c;
    const van = c.van;
    const d = this.vanDrive;

    // ---------------------------------------------------- robber dives in
    const cargo = van.cargoWorld(this.tmp);
    if (t < 1.05) {
      const k = clamp(t / 1.0, 0, 1);
      const e = easeInOutCubic(k);
      const p = this.tmp2.copy(this.from).lerp(cargo, e);
      p.y = lerp(this.from.y, cargo.y, e) + Math.sin(k * Math.PI) * 1.5;
      c.bean.root.position.copy(p);
      c.bean.root.rotation.set(0, Math.atan2(cargo.x - this.from.x, cargo.z - this.from.z), 0);
      c.bean.pose(dt);
      c.blob.position.set(p.x, 0.03, p.z);
    } else if (c.bean.root.visible) {
      c.bean.setVisible(false);
      c.blob.visible = false;
    }

    // ---------------------------------------------------------- doors
    const doorK = clamp((t - 1.05) / 0.22, 0, 1);
    for (const door of van.rig.doors) {
      const s = Math.sign(door.position.z);
      const closed = doorK >= 1 ? Math.sin(Math.min(1, (t - 1.27) / 0.3) * Math.PI) * 0.05 * (1 - Math.min(1, (t - 1.27) / 0.3)) : 0;
      door.rotation.y = s * (1.95 * (1 - easeOutCubic(doorK)) + closed);
    }
    if (!this.slammed && t > 1.25) {
      this.slammed = true;
      c.sfx('slam', 1, van.pos);
      d.kick(0.0, 0.25, -0.15);
      c.shake(0.12);
      van.rig.interiorLight.visible = false;
    }

    // -------------------------------------------- burnout, then launch
    let target = 0;
    let spin: number | undefined;
    if (t > 1.55 && !this.revved) {
      this.revved = true;
      c.sfx('rev', 1, van.pos);
    }
    if (t > 1.75 && t < 3.05) {
      spin = 26; // rear wheels spinning on the snow
      target = 0.35;
      this.skidT -= dt;
      if (this.skidT <= 0) {
        this.skidT = 0.42;
        c.sfx('skid', 0.8, van.pos);
      }
      // rear squats under power
      d.kick(-0.02 * dt * 60 * 0.05, 0, 0);
      for (const w of van.rig.wheels) {
        if (w.front) continue;
        const wp = d.local(w.steer.position.x - 0.3, 0.25, w.steer.position.z * 1.05, this.tmp2);
        c.smoke.emit(wp, { count: 2, color: [0x9aa0aa, 0xc7ccd4, 0x7d838d], kind: 'puff', speed: 1.8, up: 0.9, spread: 1, size: 1.6, life: 2.0, gravity: -0.35, drag: 1.4, radius: 0.25 });
        c.smoke.emit(wp, { count: 1, color: 0xffffff, kind: 'puff', speed: 4, up: 1.2, spread: 0.8, size: 0.7, life: 0.7, gravity: 4, drag: 2, radius: 0.15 });
      }
    }
    if (t >= 3.05) {
      if (!this.launched) {
        this.launched = true;
        c.sfx('engine', 1, van.pos);
        c.siren(true);
        d.kick(0.12, 0, 0);
      }
      const safe = d.safeSpeed(26, 10);
      target = Math.min(23, safe);
      if (t < 3.6) spin = 18 + d.v;
    }
    d.drive(dt, target, t < 4.2 ? 6.8 : 8.5, 11);
    // drift through the bend: yaw ahead of the path, then straighten
    const lat = d.v * d.v * d.curvature;
    d.slip = damp(d.slip, clamp(lat * 0.028, -0.42, 0.42), 3, dt);
    d.place(dt, spin, true);
    d.trail(dt, c.tracks, (p) => {
      if (d.v > 3) c.smoke.emit(p.setY(0.2), { count: 2, color: 0xffffff, kind: 'puff', speed: 2 + d.v * 0.12, up: 1.6, spread: 0.7, size: 0.8, life: 0.9, gravity: 3.5, drag: 2.2, radius: 0.2, dir: this.tmp2.set(-Math.cos(d.heading), 0.4, Math.sin(d.heading)) });
      if (Math.abs(d.slip) > 0.12) c.smoke.emit(p.setY(0.3), { count: 1, color: [0xa7adb7, 0xd5d9e0], kind: 'puff', speed: 1.2, up: 0.8, size: 1.8, life: 1.6, gravity: -0.3, drag: 1.2, radius: 0.2 });
    }, spin !== undefined ? spin * 0.4 : 0);
    if (Math.abs(d.slip) > 0.16 && d.v > 8) {
      this.skidT -= dt;
      if (this.skidT <= 0) {
        this.skidT = 0.5;
        c.sfx('skid', 0.7, d.pos);
      }
    }
    // brake lights while burning out and braking for the corner
    const braking = t < 3.05 || d.accel < -2;
    for (const m of van.rig.tailLamps) m.material = braking ? Mats.glow(0xff1a2a, 8) : Mats.glow(0xff1a2a, 2.2);
    if (c.headlight) {
      d.local(3.0, 1.1, 0, c.headlight.position);
      d.local(16, 0, 0, c.headlight.target.position);
    }

    // ------------------------------------------------------------ police
    let strobeSide = 0;
    let lead: THREE.Vector3 | null = null;
    for (const ch of this.chase) {
      if (t < ch.start) continue;
      const r = ch.unit.rig;
      r.root.visible = true;
      const dr = ch.drv;
      if (!ch.started) {
        ch.started = true;
        dr.v = ch.v0;
      }
      if (!ch.crashed) {
        // the second cruiser comes in too hot and doesn't brake in time
        const safe = ch.crash ? dr.safeSpeed(8, 30) : dr.safeSpeed(14, 16);
        let target = Math.min(ch.crash ? 26 : 25, safe);
        // tail the van at a chase distance — never drive into or through it
        const gap = Math.hypot(dr.pos.x - d.pos.x, dr.pos.z - d.pos.z);
        const ahead = (d.pos.x - dr.pos.x) * dr.dir.x + (d.pos.z - dr.pos.z) * dr.dir.z > 0;
        if (ahead && gap < 16) target = Math.min(target, Math.max(0, d.v + (gap - 9) * 1.8));
        dr.drive(dt, target, 9, ch.crash ? 5 : gap < 10 ? 30 : 12);
        const latP = dr.v * dr.v * dr.curvature;
        dr.slip = damp(dr.slip, clamp(latP * 0.03, -0.5, 0.5), 3, dt);
        if (ch.crash && dr.s > dr.length - 7) {
          // lost it on the ice: spin into the snowbank
          ch.spin += dt * 7;
          dr.slip += dt * 7;
        }
        if (ch.crash && dr.s >= dr.length - 0.01) {
          ch.crashed = true;
          const at = dr.local(2.4, 0.6, 0, new THREE.Vector3());
          c.sfx('crashBig', 1, at);
          c.snowBurst(at, 46);
          c.shake(0.18);
          dr.kick(0.08, 0.12, 0.1);
        }
      } else {
        dr.v = 0;
      }
      dr.place(dt);
      dr.trail(dt, c.tracks, Math.abs(dr.slip) > 0.15 ? (p) => c.smoke.emit(p.setY(0.25), { count: 1, color: [0xb0b6bf, 0xe0e3e8], kind: 'puff', speed: 1, up: 0.8, size: 1.6, life: 1.4, gravity: -0.3, drag: 1.3 }) : undefined);
      const side = ch.unit.update(dt);
      if (!lead && !ch.crashed) {
        lead = dr.pos;
        strobeSide = side;
      }
    }
    for (const p of c.parked) p.update(dt);
    if (c.policeLight) {
      if (lead) {
        c.policeLight.position.set(lead.x, 3, lead.z);
        c.policeLight.color.setHex(strobeSide >= 0 ? 0xff2a3a : 0x2a5bff);
        c.policeLight.intensity = strobeSide === 0 ? 4 : 55;
      } else c.policeLight.intensity = damp(c.policeLight.intensity, 0, 4, dt);
    }
    if (c.heli) c.heli.follow = d.pos;

    // ------------------------------------------------------------ camera
    this.direct(dt);

    if (!this.titled && t > 9.2) {
      this.titled = true;
      c.title('ESCAPED!', 'The getaway van vanished into the snowy night');
    }
    if (t >= EscapeCinematic.LENGTH) {
      this.done = true;
      c.siren(false);
      return true;
    }
    return false;
  }

  private cut(id: string) {
    if (this.shotId === id) return false;
    this.shotId = id;
    this.shotT = 0;
    return true;
  }

  private direct(dt: number) {
    const c = this.c;
    const d = this.vanDrive;
    const t = this.t;
    this.shotT += dt;
    // hand-held camera drift (its own vector: never alias the scratch vectors)
    const hand = (amp: number) => this.jitter.set(noise1(t * 1.3) * amp, noise1(t * 1.1 + 7) * amp * 0.6, noise1(t * 0.9 + 13) * amp);
    if (t < 1.6) {
      // A — rear three-quarter: the robber dives in, doors slam
      this.cut('A');
      d.local(-8.2 + this.shotT * 0.3, 1.45, 3.7, this.camPos).add(hand(0.05));
      d.local(-2.3, 1.15, 0.2, this.camLook);
      c.shot(this.camPos, this.camLook, 46);
    } else if (t < 3.15) {
      // B — low by the rear wheel: burnout smoke rolls past
      if (this.cut('B')) d.local(-4.4, 0.5, 2.45, this.camPos);
      d.local(1.6, 0.85, 0.5, this.camLook);
      c.shot(this.tmp.copy(this.camPos).add(hand(0.03)), this.camLook, 56);
    } else if (t < 5.5) {
      // C — tracking alongside as the van tears away
      if (this.cut('C')) d.local(1.2, 1.25, 6.6, this.trackCam);
      const want = d.local(1.2 + Math.min(1.5, this.shotT * 0.8), 1.25 + this.shotT * 0.12, 6.6, this.tmp);
      this.trackCam.lerp(want, 1 - Math.exp(-6 * dt));
      this.camPos.copy(this.trackCam).add(hand(0.06 + d.v * 0.003));
      d.local(0.4, 1.0, 0, this.camLook);
      c.shot(this.camPos, this.camLook, 50 + Math.min(10, d.v * 0.45));
    } else if (this.cornerReached < 0 && d.s < d.length * 0.36) {
      // D — high crane over the intersection: the chase turns in, one cruiser loses it
      const v = c.van.pos;
      if (this.cut('D')) this.camPos.set(v.x - 15.5, 12.5, v.z + 9.5);
      this.camPos.y = damp(this.camPos.y, 8.2, 0.7, dt);
      this.camPos.x += dt * 1.2;
      this.camLook.set(lerp(v.x - 5, d.pos.x, 0.5), 0.8, lerp(v.z - 4, d.pos.z, 0.5));
      c.shot(this.camPos, this.camLook, 54);
    } else {
      // E — long lens at the far corner: the van drifts out of sight
      if (this.cornerReached < 0) this.cornerReached = t;
      const v = c.van.pos;
      if (this.cut('E')) this.camPos.set(v.x + 66, 1.9, v.z + 9.8);
      this.camLook.lerp(this.tmp.copy(d.pos).setY(1.1), this.shotT < 0.05 ? 1 : 1 - Math.exp(-5 * dt));
      c.shot(this.tmp2.copy(this.camPos).add(hand(0.025)), this.camLook, 30);
    }
  }
}

export { TAU };
