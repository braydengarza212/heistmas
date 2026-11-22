import * as THREE from 'three';
import { RAPIER, Physics, G, groups } from './physics';
import { Bean, type BeanState } from '../characters/Bean';
import type { Outfit } from '../characters/outfits';
import { TextureLib } from '../gfx/textures';
import { rbox } from '../gfx/geom';
import { CHAR_SCALE as K } from './scale';
import { Mats } from '../gfx/materials';
import { angleDiff, clamp, dampAngle } from '../core/math';

export type PlayerState = 'move' | 'dive' | 'slide' | 'knocked' | 'getup' | 'interact' | 'frozen' | 'celebrate' | 'caught' | 'zip';

export interface PlayerInput {
  move: THREE.Vector2; // world-space XZ wish direction (length ≤ 1)
  sprint: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  divePressed: boolean;
}

export interface PlayerEvents {
  jump: () => void;
  land: (impact: number) => void;
  dive: () => void;
  slide: () => void;
  knocked: () => void;
  recovered: () => void;
}

/** Anything the robber can stand on that moves (platforms, hoists, coin presses). */
export interface Ride {
  readonly delta: THREE.Vector3;
  /** Standing-surface height and footprint, so a rising lift can't slip through the robber's feet. */
  top?(): number;
  contains?(x: number, z: number): boolean;
}

const RADIUS = 0.45 * K;
const STAND_HH = 0.35 * K;
const CROUCH_HH = 0.02 * K;
const RAG_R = 0.55 * K;
const STAND_CENTER = STAND_HH + RADIUS; // 0.8
const CROUCH_CENTER = CROUCH_HH + RADIUS; // 0.47

export const WALK_SPEED = 6.4;
export const SPRINT_SPEED = 9.8;
const JUMP_V = 10.6;
const GRAVITY = 31;

const PLAYER_GROUPS = groups(G.PLAYER, G.WORLD | G.PROPS);
const MOVE_FILTER = groups(G.PLAYER, G.WORLD | G.PROPS);
const RAGDOLL_GROUPS = groups(G.RAGDOLL, G.WORLD | G.PROPS | G.HAZARD);

export class Player {
  readonly bean: Bean;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private cc: RAPIER.KinematicCharacterController;
  readonly feet = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  /** Camera lock: when set, the robber always faces this heading (strafing movement). */
  faceYaw: number | null = null;
  /** Seconds left frozen in a block of ice (hit by another robber's snowball). */
  iceT = 0;
  private iceBlock: THREE.Mesh;
  state: PlayerState = 'move';
  grounded = false;
  private coyote = 0;
  private jumpBuffer = 0;
  private airTime = 0;
  private crouched = false;
  private diveReady = true;
  private slideT = 0;
  private getupT = 0;
  private knockT = 0;
  private lastVy = 0;
  private turnRate = 0;
  private accel = 0;
  private prevSpeed = 0;
  private dustT = 0;
  invuln = 0;
  slowFactor = 1;
  /** Seconds left of a bounce-pad launch (full-height rise without holding jump). */
  private launchT = 0;
  sprinting = false;
  /** Ragdoll physics body while knocked down. */
  private rag: RAPIER.RigidBody | null = null;
  groundTag: string | null = null;
  private groundPlatform: Ride | null = null;
  /** Last lift stood on (kept while airborne for a moment so it can't rise through us). */
  private ride: Ride | null = null;
  private conveyorVel = new THREE.Vector3();
  readonly blob: THREE.Mesh;
  events: Partial<PlayerEvents> = {};
  /** Set by the heist so the controller can follow moving platforms. */
  platforms = new Map<number, Ride>();
  private tmpV = new THREE.Vector3();
  private probeShape = new RAPIER.Ball(RADIUS * 0.85);

  constructor(
    private physics: Physics,
    scene: THREE.Scene,
    outfit: Outfit,
    spawn: THREE.Vector3,
    yaw: number,
  ) {
    this.bean = new Bean(outfit);
    this.bean.root.scale.setScalar(K);
    scene.add(this.bean.root);
    const world = physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + STAND_CENTER + 0.05, spawn.z),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(STAND_HH, RADIUS).setCollisionGroups(PLAYER_GROUPS).setFriction(0),
      this.body,
    );
    this.cc = world.createCharacterController(0.03);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((58 * Math.PI) / 180);
    this.cc.enableAutostep(0.42, 0.22, false);
    this.cc.enableSnapToGround(0.35);
    this.cc.setSlideEnabled(true);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(55);
    this.feet.copy(spawn);
    this.yaw = yaw;
    this.iceBlock = new THREE.Mesh(rbox(1.25, 1.75, 1.25, 0.12), Mats.glass());
    this.iceBlock.position.y = 0.82;
    this.iceBlock.visible = false;
    this.bean.root.add(this.iceBlock);

    const blobMat = new THREE.MeshBasicMaterial({
      map: TextureLib.radial('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.4 * K, 1.4 * K), blobMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    this.blob.userData.noAO = true;
    scene.add(this.blob);
    this.syncVisual(0);
  }

  get center() {
    const t = this.rag ? this.rag.translation() : this.body.translation();
    return this.tmpV.set(t.x, t.y, t.z);
  }

  /** Capsule segment for laser tests. */
  capsule(a: THREE.Vector3, b: THREE.Vector3) {
    if (this.rag) {
      const t = this.rag.translation();
      a.set(t.x, t.y - 0.1 * K, t.z);
      b.set(t.x, t.y + 0.1 * K, t.z);
      return RAG_R;
    }
    const t = this.body.translation();
    const hh = this.crouched ? CROUCH_HH : STAND_HH;
    a.set(t.x, t.y - hh, t.z);
    b.set(t.x, t.y + hh, t.z);
    return RADIUS;
  }

  get radius() {
    return RADIUS;
  }
  get isCrouched() {
    return this.crouched;
  }
  get horizontalSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get knocked() {
    return this.state === 'knocked';
  }
  get busy() {
    return this.state === 'knocked' || this.state === 'interact' || this.state === 'frozen' || this.state === 'celebrate' || this.state === 'caught' || this.state === 'zip';
  }
  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  teleport(feet: THREE.Vector3, yaw: number) {
    if (this.rag) {
      this.physics.removeBody(this.rag);
      this.rag = null;
      this.collider.setEnabled(true);
    }
    this.setCrouch(false, true);
    this.body.setTranslation({ x: feet.x, y: feet.y + STAND_CENTER + 0.05, z: feet.z }, true);
    this.body.setNextKinematicTranslation({ x: feet.x, y: feet.y + STAND_CENTER + 0.05, z: feet.z });
    this.physics.world.propagateModifiedBodyPositionsToColliders();
    this.feet.copy(feet);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.state = 'move';
    this.bean.endRagdoll(feet, yaw);
    this.bean.root.position.copy(feet);
    this.groundPlatform = null;
    this.ride = null;
  }

  private setCrouch(c: boolean, force = false) {
    if (c === this.crouched && !force) return true;
    const t = this.body.translation();
    if (!c && !force) {
      // headroom check for standing back up
      const test = new RAPIER.Capsule(STAND_HH, RADIUS - 0.05);
      let blocked = false;
      this.physics.world.intersectionsWithShape(
        { x: t.x, y: t.y - CROUCH_CENTER + STAND_CENTER + 0.03, z: t.z },
        { x: 0, y: 0, z: 0, w: 1 },
        test,
        () => {
          blocked = true;
          return false;
        },
        undefined,
        MOVE_FILTER,
        this.collider,
      );
      if (blocked) return false;
    }
    this.crouched = c;
    this.collider.setHalfHeight(c ? CROUCH_HH : STAND_HH);
    const dy = c ? CROUCH_CENTER - STAND_CENTER : STAND_CENTER - CROUCH_CENTER;
    if (!force) {
      const p = { x: t.x, y: t.y + dy, z: t.z };
      this.body.setTranslation(p, true);
      this.body.setNextKinematicTranslation(p);
      this.physics.world.propagateModifiedBodyPositionsToColliders();
    }
    return true;
  }

  // ----------------------------------------------------------------- update
  update(dt: number, inp: PlayerInput) {
    if (this.iceT > 0) this.iceT = Math.max(0, this.iceT - dt);
    this.iceBlock.visible = this.iceT > 0;
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.state === 'knocked') {
      this.updateRagdoll(dt);
      return;
    }
    if (this.state === 'zip') return;
    this.coyote -= dt;
    this.jumpBuffer -= dt;
    this.launchT -= dt;
    if (inp.jumpPressed) this.jumpBuffer = 0.14;

    const wish = inp.move;
    const wishLen = Math.min(1, wish.length());
    this.sprinting = inp.sprint && wishLen > 0.1 && this.state === 'move';
    const cap = (this.sprinting ? SPRINT_SPEED : WALK_SPEED) * this.slowFactor;
    const prevYaw = this.yaw;
    const hs = this.horizontalSpeed;

    switch (this.state) {
      case 'move':
      case 'getup': {
        const k = this.state === 'getup' ? 0.5 : 1;
        const tx = wish.x * cap * k;
        const tz = wish.y * cap * k;
        // ice: very little grip, so you keep sliding and turn wide
        const icy = this.grounded && this.groundTag === 'ice';
        const accel = this.iceT > 0 ? 3 : icy ? (wishLen > 0.1 ? 7.5 : 1.6) : this.grounded ? (wishLen > 0.1 ? 62 : 48) : 26;
        this.moveToward(tx, tz, accel * dt);
        if (this.faceYaw !== null) this.yaw = dampAngle(this.yaw, this.faceYaw, 22, dt);
        else if (wishLen > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.y), icy ? 5 : this.grounded ? 15 : 8, dt);
        if (this.state === 'getup') {
          this.getupT += dt;
          if (this.getupT > 0.3) this.state = 'move';
          break;
        }
        if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
          this.vel.y = JUMP_V;
          this.grounded = false;
          this.coyote = 0;
          this.jumpBuffer = 0;
          this.bean.onJump();
          this.events.jump?.();
        }
        if (inp.divePressed && this.diveReady) {
          const fwdX = wishLen > 0.1 ? wish.x / wishLen : Math.sin(this.yaw);
          const fwdZ = wishLen > 0.1 ? wish.y / wishLen : Math.cos(this.yaw);
          this.yaw = Math.atan2(fwdX, fwdZ);
          if (this.grounded && hs > 2.5) {
            const sp = Math.max(hs + 3.2, 10.5);
            this.vel.x = fwdX * sp;
            this.vel.z = fwdZ * sp;
            this.state = 'slide';
            this.slideT = 0;
            this.setCrouch(true);
            this.diveReady = false;
            this.events.slide?.();
          } else {
            const sp = this.grounded ? 8 : Math.max(hs, 11.5);
            this.vel.x = fwdX * sp;
            this.vel.z = fwdZ * sp;
            this.vel.y = this.grounded ? 6.5 : Math.max(this.vel.y, 3.8);
            this.grounded = false;
            this.state = 'dive';
            this.setCrouch(true);
            this.diveReady = false;
            this.events.dive?.();
          }
        }
        break;
      }
      case 'dive': {
        // slight air steering
        if (wishLen > 0.1) {
          const target = Math.atan2(wish.x, wish.y);
          this.yaw += clamp(angleDiff(this.yaw, target), -1.5 * dt, 1.5 * dt);
          const sp = Math.hypot(this.vel.x, this.vel.z);
          this.vel.x = Math.sin(this.yaw) * sp;
          this.vel.z = Math.cos(this.yaw) * sp;
        }
        break;
      }
      case 'slide': {
        this.slideT += dt;
        const sp = Math.max(0, hs - (7 + hs * 1.2) * dt);
        if (wishLen > 0.1) {
          const target = Math.atan2(wish.x, wish.y);
          this.yaw += clamp(angleDiff(this.yaw, target), -2 * dt, 2 * dt);
        }
        this.vel.x = Math.sin(this.yaw) * sp;
        this.vel.z = Math.cos(this.yaw) * sp;
        if ((this.slideT > 0.35 && sp < 3.2) || this.slideT > 1.2) {
          if (this.setCrouch(false)) {
            this.state = 'getup';
            this.getupT = 0;
          } else {
            // stuck under something: crawl
            this.vel.x = wish.x * 2.5;
            this.vel.z = wish.y * 2.5;
          }
        }
        break;
      }
      default:
        this.moveToward(0, 0, 40 * dt);
    }

    // gravity
    if (!this.grounded || this.vel.y > 0) {
      const rising = this.vel.y > 0;
      const mult = !rising ? 1.45 : inp.jumpHeld || this.state !== 'move' || this.launchT > 0 ? 1 : 2.3;
      this.vel.y -= GRAVITY * mult * dt;
      if (this.vel.y < -32) this.vel.y = -32;
    } else {
      this.vel.y = -1.5;
    }

    // ---- integrate through the character controller
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    if (this.groundPlatform) {
      // ride along: move with the platform first, then walk relative to it
      const d = this.groundPlatform.delta;
      const t0 = this.body.translation();
      const carried = { x: t0.x + d.x, y: t0.y + d.y, z: t0.z + d.z };
      this.body.setTranslation(carried, true);
      this.physics.world.propagateModifiedBodyPositionsToColliders();
      if (this.vel.y < 0) desired.y = Math.max(desired.y, -0.02);
    }
    desired.x += this.conveyorVel.x * dt;
    desired.z += this.conveyorVel.z * dt;
    this.cc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, MOVE_FILTER);
    const mv = this.cc.computedMovement();
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);

    const wasGrounded = this.grounded;
    this.grounded = this.cc.computedGrounded();
    this.groundPlatform = null;
    this.conveyorVel.set(0, 0, 0);
    this.groundTag = null;
    for (let i = 0; i < this.cc.numComputedCollisions(); i++) {
      const c = this.cc.computedCollision(i);
      if (!c || !c.collider) continue;
      if (c.normal1.y > 0.5) {
        const tag = this.physics.tagOf(c.collider);
        if (tag) {
          this.groundTag = tag.kind;
          if (tag.kind === 'platform') this.groundPlatform = this.platforms.get(tag.id) ?? null;
          if (tag.kind === 'conveyor') this.conveyorVel.copy(tag.velocity);
        }
        this.grounded = true;
      } else if (c.normal1.y < -0.5 && this.vel.y > 0) {
        this.vel.y = 0; // bonked head
      }
    }
    // Robust ground probe: a short downward ball cast under the capsule tells us
    // what we're standing on (moving platform, conveyor) even when the
    // controller reports no contact while resting.
    if (this.vel.y <= 0.01) {
      const hh = this.crouched ? CROUCH_HH : STAND_HH;
      const probe = this.physics.world.castShape(
        { x: next.x, y: next.y - hh + 0.05, z: next.z },
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 0, y: -1, z: 0 },
        this.probeShape,
        0,
        0.22,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        MOVE_FILTER,
        this.collider,
      );
      if (probe && probe.normal1.y > 0.4) {
        this.grounded = true;
        const tag = this.physics.tagOf(probe.collider);
        if (tag) {
          this.groundTag = tag.kind;
          if (tag.kind === 'platform') this.groundPlatform = this.platforms.get(tag.id) ?? null;
          if (tag.kind === 'conveyor') this.conveyorVel.copy(tag.velocity);
        }
      }
    }

    // lifts: never let a rising platform pass up through the feet
    const hh2 = this.crouched ? CROUCH_CENTER : STAND_CENTER;
    if (this.groundPlatform) this.ride = this.groundPlatform;
    const rd = this.ride;
    if (rd && rd.top && rd.contains) {
      const top = rd.top();
      const fy = next.y - hh2;
      if (rd.contains(next.x, next.z) && this.vel.y <= 0.5 && fy < top + 0.25 && fy > top - 0.9) {
        if (fy < top) {
          next.y = top + hh2;
          this.body.setNextKinematicTranslation(next);
        }
        this.grounded = true;
        this.groundPlatform = rd;
        this.groundTag = 'platform';
      } else if (!rd.contains(next.x, next.z) || fy > top + 1.5) this.ride = null;
    }

    if (this.grounded) {
      if (!wasGrounded) {
        const impact = -this.lastVy;
        if (this.state === 'dive') {
          this.state = 'slide';
          this.slideT = 0.1;
          this.bean.onLand(1.3);
          this.events.land?.(impact + 6);
        } else if (impact > 3) {
          this.bean.onLand(clamp(impact / 14, 0.25, 1.3));
          this.events.land?.(impact);
        }
      }
      if (this.vel.y < 0) this.vel.y = 0;
      this.coyote = 0.12;
      this.airTime = 0;
      if (this.state === 'move' || this.state === 'getup') this.diveReady = true;
    } else {
      this.airTime += dt;
    }
    this.lastVy = this.vel.y;

    // derived values for animation
    this.feet.set(next.x, next.y - (this.crouched ? CROUCH_CENTER : STAND_CENTER), next.z);
    const sp = this.horizontalSpeed;
    this.accel = (sp - this.prevSpeed) / Math.max(dt, 1e-4);
    this.prevSpeed = sp;
    this.turnRate = angleDiff(prevYaw, this.yaw) / Math.max(dt, 1e-4);
    this.dustT -= dt;
    this.syncVisual(dt);
  }

  private moveToward(tx: number, tz: number, maxDelta: number) {
    const dx = tx - this.vel.x;
    const dz = tz - this.vel.z;
    const d = Math.hypot(dx, dz);
    if (d <= maxDelta || d < 1e-5) {
      this.vel.x = tx;
      this.vel.z = tz;
    } else {
      this.vel.x += (dx / d) * maxDelta;
      this.vel.z += (dz / d) * maxDelta;
    }
  }

  /** Emits a dust puff if the player is sliding/sprinting (rate limited). */
  wantsDust() {
    if (this.dustT > 0 || !this.grounded) return false;
    if (this.state === 'slide' || (this.sprinting && this.horizontalSpeed > 7)) {
      this.dustT = this.state === 'slide' ? 0.06 : 0.22;
      return true;
    }
    return false;
  }

  private animState(): BeanState {
    switch (this.state) {
      case 'dive':
        return 'dive';
      case 'slide':
        return 'slide';
      case 'knocked':
        return 'knocked';
      case 'getup':
        return 'getup';
      case 'interact':
        return 'interact';
      case 'celebrate':
        return 'celebrate';
      case 'caught':
        return 'caught';
      case 'frozen':
        return 'idle';
      case 'zip':
        return 'hang';
      default:
        if (!this.grounded && this.airTime > 0.06) return 'air';
        return this.horizontalSpeed > 0.4 ? 'run' : 'idle';
    }
  }

  private syncVisual(dt: number) {
    if (this.state !== 'knocked') {
      this.bean.root.position.copy(this.feet);
      this.bean.root.rotation.set(0, this.yaw, 0);
      // zipline cables hang for a full-size robber: lift the smaller one so its hands still reach
      if (this.state === 'zip') this.bean.root.position.y += 2.05 * (1 - K) * 0.92;
    }
    this.bean.update(dt, {
      state: this.animState(),
      speed: this.horizontalSpeed,
      maxSpeed: SPRINT_SPEED,
      vy: this.vel.y,
      turnRate: this.turnRate,
      sprinting: this.sprinting,
      accel: this.accel,
    });
    // blob shadow
    const c = this.center;
    const hit = this.physics.rayWorldHit(c, new THREE.Vector3(0, -1, 0), 25, G.WORLD | G.PROPS);
    if (hit) {
      const h = hit.timeOfImpact;
      const groundY = c.y - h;
      const height = Math.max(0, groundY < this.feet.y ? this.feet.y - groundY : 0);
      this.blob.visible = true;
      this.blob.position.set(c.x, groundY + 0.03, c.z);
      const s = clamp(1.1 - height * 0.04, 0.5, 1.1);
      this.blob.scale.set(s, s, s);
      (this.blob.material as THREE.MeshBasicMaterial).opacity = clamp(0.85 - height * 0.05, 0.25, 0.85);
    } else this.blob.visible = false;
  }

  // --------------------------------------------------------------- ragdoll
  /** Knock the player over with a physics tumble. Returns false if immune. */
  knock(impulse: THREE.Vector3, force = false) {
    if (this.state === 'knocked' || (this.invuln > 0 && !force)) return false;
    const c = this.body.translation();
    this.state = 'knocked';
    this.knockT = 0;
    this.collider.setEnabled(false);
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(c.x, c.y + (this.crouched ? 0.1 : 0), c.z)
      .setLinvel(this.vel.x * 0.4 + impulse.x, Math.max(this.vel.y * 0.3, 0) + impulse.y, this.vel.z * 0.4 + impulse.z)
      .setAngvel({ x: (Math.random() - 0.5) * 9, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 9 })
      .setLinearDamping(0.35)
      .setAngularDamping(1.2)
      .setCcdEnabled(true);
    this.rag = this.physics.world.createRigidBody(bd);
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(RAG_R).setRestitution(0.45).setFriction(0.9).setDensity(1.2).setCollisionGroups(RAGDOLL_GROUPS),
      this.rag,
    );
    this.events.knocked?.();
    return true;
  }

  private updateRagdoll(dt: number) {
    if (!this.rag) return;
    this.knockT += dt;
    const t = this.rag.translation();
    const r = this.rag.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    this.bean.setRagdollPose(new THREE.Vector3(t.x, t.y, t.z), q);
    this.feet.set(t.x, t.y - RAG_R, t.z);
    const lv = this.rag.linvel();
    this.vel.set(lv.x, lv.y, lv.z);
    this.bean.update(dt, { state: 'knocked', speed: 0, maxSpeed: SPRINT_SPEED, vy: 0, turnRate: 0, sprinting: false, accel: 0 });
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    // blob follows the ball
    const hit = this.physics.rayWorldHit(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(0, -1, 0), 25, G.WORLD | G.PROPS);
    if (hit) {
      this.blob.position.set(t.x, t.y - hit.timeOfImpact + 0.03, t.z);
      this.blob.visible = true;
    }
    if ((this.knockT > 0.85 && speed < 1.8) || this.knockT > 2.6) this.recover();
  }

  private recover() {
    if (!this.rag) return;
    const t = this.rag.translation();
    const r = this.rag.rotation();
    this.physics.removeBody(this.rag);
    this.rag = null;
    const origin = new THREE.Vector3(t.x, t.y + 0.3, t.z);
    const toi = this.physics.rayWorld(origin, new THREE.Vector3(0, -1, 0), 4, G.WORLD | G.PROPS);
    const feetY = toi !== null ? origin.y - toi : t.y - RAG_R;
    this.setCrouch(false, true);
    const p = { x: t.x, y: feetY + STAND_CENTER + 0.04, z: t.z };
    this.body.setTranslation(p, true);
    this.body.setNextKinematicTranslation(p);
    this.collider.setEnabled(true);
    this.physics.world.propagateModifiedBodyPositionsToColliders();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    if (Math.hypot(fwd.x, fwd.z) > 0.1) this.yaw = Math.atan2(fwd.x, fwd.z);
    this.feet.set(p.x, feetY, p.z);
    this.bean.endRagdoll(this.feet, this.yaw);
    this.vel.set(0, 0, 0);
    this.state = 'getup';
    this.getupT = 0;
    this.invuln = 1.3;
    this.grounded = true;
    this.events.recovered?.();
  }

  setState(s: PlayerState) {
    if (this.state === 'knocked' && s !== 'knocked') this.recover();
    if (s === 'interact' || s === 'frozen' || s === 'celebrate' || s === 'caught') {
      this.vel.x = 0;
      this.vel.z = 0;
      if (this.crouched) this.setCrouch(false);
    }
    this.state = s;
  }

  /** Bounce pad / steam blast: throw the robber straight up (keeps horizontal speed). */
  /** Hit by another robber: slide back and stay frozen in ice. */
  snowFreeze(dir: THREE.Vector3, knock: number, seconds: number) {
    if (this.state === 'knocked' || this.state === 'zip') return false;
    this.iceT = seconds;
    this.launch(3 + knock * 0.15, dir.clone().setY(0).normalize().multiplyScalar(knock * 0.8));
    return true;
  }

  /** Animation name for the shared-world state stream. */
  get netAnim(): BeanState {
    return this.animState();
  }

  launch(vy: number, push?: THREE.Vector3) {
    if (this.state === 'knocked' || this.state === 'zip') return;
    if (this.state === 'slide' || this.state === 'dive') {
      this.setCrouch(false, false);
      this.state = 'move';
    }
    if (push) {
      this.vel.x += push.x;
      this.vel.z += push.z;
    }
    this.vel.y = vy;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.launchT = (vy / GRAVITY) * 0.95;
    this.bean.onJump();
  }

  /** Zipline: the body follows the trolley (no collisions) until released. */
  carry(feet: THREE.Vector3, yaw: number, dt: number) {
    if (this.state !== 'zip') {
      if (this.state === 'knocked') this.recover();
      if (this.crouched) this.setCrouch(false, true);
      this.state = 'zip';
    }
    const p = { x: feet.x, y: feet.y + STAND_CENTER, z: feet.z };
    this.body.setNextKinematicTranslation(p);
    this.vel.set((feet.x - this.feet.x) / Math.max(dt, 1e-4), 0, (feet.z - this.feet.z) / Math.max(dt, 1e-4));
    this.feet.copy(feet);
    this.yaw = yaw;
    this.grounded = false;
    this.airTime = 1;
    this.syncVisual(dt);
  }

  /** Let go of the zipline with some carried momentum. */
  release(vel: THREE.Vector3) {
    if (this.state !== 'zip') return;
    this.state = 'move';
    this.vel.copy(vel);
    this.grounded = false;
    this.diveReady = true;
    this.lastVy = vel.y;
  }

  faceTowards(p: THREE.Vector3) {
    this.yaw = Math.atan2(p.x - this.feet.x, p.z - this.feet.z);
  }

  dispose(scene: THREE.Scene) {
    this.bean.dispose();
    scene.remove(this.blob);
    this.blob.geometry.dispose();
  }
}
