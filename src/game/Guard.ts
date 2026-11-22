import { CHAR_SCALE as K } from './scale';
import * as THREE from 'three';
import { RAPIER, Physics, G, groups } from './physics';
import { PenguinModel, VisionCone, type PenguinAnim } from '../characters/Penguin';
import { angleDiff, clamp, dampAngle } from '../core/math';

export type GuardState = 'patrol' | 'investigate' | 'chase' | 'search' | 'stunned' | 'celebrate' | 'return' | 'lunge';

export interface GuardConfig {
  route: THREE.Vector3[];
  zone: THREE.Box3;
  elite?: boolean;
  wait?: number;
  name?: string;
}

export interface GuardContext {
  time: number;
  playerChest: THREE.Vector3;
  playerFeet: THREE.Vector3;
  playerHidden: boolean;
  playerSprinting: boolean;
  playerVulnerable: boolean;
  stars: number;
}

export interface GuardEvents {
  spotted: (g: Guard) => void;
  suspicious: (g: Guard) => void;
  caught: (g: Guard) => void;
  lostTrack: (g: Guard) => void;
}

const RANGE = [9, 10.5, 12, 12.5, 13.5, 15];
const HALF = [0.55, 0.62, 0.7, 0.72, 0.76, 0.82];
const CHASE_SPEED = [5.6, 5.6, 6.4, 6.9, 7.4, 8.1];
const GUARD_GROUPS = groups(G.GUARD, G.WORLD | G.PROPS);
const MOVE_FILTER = groups(G.GUARD, G.WORLD | G.PROPS);

function iconTexture(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 84px "Titan One", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let ICONS: { q: THREE.SpriteMaterial; ex: THREE.SpriteMaterial } | null = null;
function icons() {
  if (!ICONS)
    ICONS = {
      q: new THREE.SpriteMaterial({ map: iconTexture('?', '#f2b21b'), depthTest: false }),
      ex: new THREE.SpriteMaterial({ map: iconTexture('!', '#e8283a'), depthTest: false }),
    };
  return ICONS;
}

const C_IDLE = new THREE.Color(1.0, 0.86, 0.35);
const C_SUS = new THREE.Color(1.0, 0.55, 0.12);
const C_ALERT = new THREE.Color(1.0, 0.15, 0.15);
const C_STUN = new THREE.Color(0.4, 0.6, 1.0);

export class Guard {
  readonly model: PenguinModel;
  readonly cone = new VisionCone();
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  state: GuardState = 'patrol';
  stateT = 0;
  meter = 0;
  private routeIdx = 0;
  private waiting = 0;
  private target = new THREE.Vector3();
  readonly lastSeen = new THREE.Vector3();
  private lostT = 0;
  private stuckT = 0;
  private lungeCooldown = 3 + Math.random() * 3;
  private lungeDir = new THREE.Vector3();
  private icon: THREE.Sprite;
  private iconPop = 0;
  private lookOffset = 0;
  private vy = 0;
  seesPlayer = false;
  private eye = new THREE.Vector3();
  private col = new THREE.Color();
  events: Partial<GuardEvents> = {};
  readonly elite: boolean;

  constructor(
    private physics: Physics,
    private cc: RAPIER.KinematicCharacterController,
    scene: THREE.Scene,
    readonly cfg: GuardConfig,
  ) {
    this.elite = !!cfg.elite;
    this.model = new PenguinModel(this.elite);
    scene.add(this.model.root);
    this.model.root.scale.setScalar(K);
    this.model.root.add(this.cone.fan);
    this.cone.fan.position.y = 0.06;
    // the vision cone keeps its real reach while the penguin is smaller
    this.cone.fan.scale.setScalar(1 / K);
    this.model.root.add(this.cone.beam);
    this.cone.beam.position.set(0.3, 0.95, 0.35);
    this.cone.beam.scale.setScalar(1 / K);
    const start = cfg.route[0];
    this.pos.copy(start);
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + 0.72 * K, start.z));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(0.3 * K, 0.42 * K).setCollisionGroups(GUARD_GROUPS), this.body);
    if (cfg.route.length > 1) this.yaw = Math.atan2(cfg.route[1].x - start.x, cfg.route[1].z - start.z);
    this.icon = new THREE.Sprite(icons().q);
    this.icon.scale.setScalar(0.001);
    this.icon.position.y = 2.25;
    this.icon.renderOrder = 20;
    this.model.root.add(this.icon);
    this.routeIdx = cfg.route.length > 1 ? 1 : 0;
  }

  get busy() {
    return this.state === 'stunned' || this.state === 'celebrate';
  }

  /** Something made a noise nearby (sprinting, smashing decorations...). */
  hear(p: THREE.Vector3, loudness: number, stars: number) {
    if (this.busy || this.state === 'chase' || this.state === 'lunge') return;
    const d = this.pos.distanceTo(p);
    if (d > loudness) return;
    this.target.copy(p);
    this.setState('investigate');
    this.meter = Math.max(this.meter, stars >= 1 ? 0.45 : 0.3);
    this.events.suspicious?.(this);
  }

  /** Alerted by radio: go to where the player was seen. */
  radio(p: THREE.Vector3) {
    if (this.busy || this.state === 'chase' || this.state === 'lunge') return;
    this.lastSeen.copy(p);
    this.target.copy(p);
    this.setState('search');
  }

  private stunTime = 3;

  /** Snowball hit: blasted back and frozen, even if already dazed. */
  suppress(dir: THREE.Vector3, seconds: number, knock = 9) {
    this.state = 'stunned';
    this.stateT = 0;
    this.stunTime = seconds;
    this.vel.copy(dir).setY(0).normalize().multiplyScalar(knock);
    this.vy = 3 + knock * 0.28;
    this.model.bounce(0.9);
    this.meter = 0;
  }

  stun(dir: THREE.Vector3) {
    if (this.state === 'stunned') return false;
    this.stunTime = 3;
    this.setState('stunned');
    this.vel.copy(dir).setY(0).normalize().multiplyScalar(5);
    this.model.bounce(0.6);
    this.meter = 0;
    return true;
  }

  private setState(s: GuardState) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    if (s === 'chase' || s === 'investigate') this.iconPop = 1;
  }

  update(dt: number, ctx: GuardContext) {
    this.stateT += dt;
    const stars = ctx.stars;
    const range = RANGE[stars] + (this.elite ? 2 : 0);
    const half = HALF[stars] + (this.elite ? 0.05 : 0);
    this.cone.setShape(range, half);

    // ---- perception
    this.seesPlayer = false;
    if (!ctx.playerHidden && !this.busy) this.seesPlayer = this.canSee(ctx.playerChest, range, half);
    if (this.seesPlayer) {
      const d = this.pos.distanceTo(ctx.playerFeet);
      const close = 1 + 1.6 * (1 - d / range);
      const rate = 1.0 * close * (ctx.playerSprinting ? 1.5 : 1) * (stars >= 2 ? 2.4 : stars >= 1 ? 1.4 : 1) * (this.elite ? 1.4 : 1);
      this.meter = Math.min(1, this.meter + rate * dt);
      this.lastSeen.copy(ctx.playerFeet);
      this.lostT = 0;
    } else if (this.state !== 'chase' && this.state !== 'lunge') {
      this.meter = Math.max(0, this.meter - 0.35 * dt);
    }
    // very close, even from behind: they feel you
    if (!ctx.playerHidden && !this.busy && this.state !== 'chase' && this.pos.distanceTo(ctx.playerFeet) < 1.8 + stars * 0.3) {
      this.meter = Math.min(1, this.meter + 1.2 * dt);
      if (this.state === 'patrol') {
        this.target.copy(ctx.playerFeet);
        this.setState('investigate');
      }
    }

    // ---- state machine
    let speed = 0;
    let face: THREE.Vector3 | null = null;
    const route = this.cfg.route;
    switch (this.state) {
      case 'patrol': {
        if (this.meter > 0.3) {
          this.target.copy(this.lastSeen);
          this.setState('investigate');
          this.events.suspicious?.(this);
          break;
        }
        if (route.length > 1) {
          const wp = route[this.routeIdx];
          if (this.waiting > 0) {
            this.waiting -= dt;
            this.lookOffset = Math.sin(this.stateT * 1.3) * 0.9;
            if (this.waiting <= 0) this.routeIdx = (this.routeIdx + 1) % route.length;
          } else {
            this.lookOffset = 0;
            speed = this.elite ? 3.4 : 2.6 + stars * 0.25;
            face = wp;
            if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.6) this.waiting = this.cfg.wait ?? 1.6;
          }
        } else {
          this.lookOffset = Math.sin(this.stateT * 0.6) * 1.3;
        }
        break;
      }
      case 'investigate': {
        this.lookOffset = 0;
        if (this.meter >= 1) {
          this.spotted();
          break;
        }
        if (this.seesPlayer) this.target.copy(ctx.playerFeet);
        const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
        face = this.target;
        speed = this.stateT < 0.8 ? 0 : d > 1.2 ? 2.4 : 0;
        if (this.stateT > 6 && !this.seesPlayer) this.setState('return');
        break;
      }
      case 'chase': {
        const knows = stars >= 5;
        if (this.seesPlayer || knows) {
          this.lastSeen.copy(ctx.playerFeet);
          this.lostT = 0;
        } else this.lostT += dt;
        if (this.lostT > 3.5) {
          this.target.copy(this.lastSeen);
          this.setState('search');
          this.events.lostTrack?.(this);
          break;
        }
        if (!this.inZone(ctx.playerFeet, 4)) {
          this.lostT += dt * 2;
        }
        face = this.lastSeen;
        speed = CHASE_SPEED[stars] + (this.elite ? 0.6 : 0);
        const d = this.pos.distanceTo(ctx.playerFeet);
        this.lungeCooldown -= dt;
        if (this.lungeCooldown <= 0 && d > 3 && d < 8.5 && this.seesPlayer && stars >= 2) {
          this.lungeCooldown = 4 + Math.random() * 3;
          this.lungeDir.set(ctx.playerFeet.x - this.pos.x, 0, ctx.playerFeet.z - this.pos.z).normalize();
          this.setState('lunge');
        }
        if (d < 1.15 && ctx.playerVulnerable) {
          this.events.caught?.(this);
          this.setState('celebrate');
        }
        break;
      }
      case 'lunge': {
        // comedic penguin belly-slide toward where the player was
        const k = this.stateT;
        speed = k < 0.25 ? 0 : 12 * (1 - clamp((k - 0.25) / 0.9, 0, 1)) + 2;
        face = this.pos.clone().add(this.lungeDir);
        if (k > 0.25) {
          this.vel.x = this.lungeDir.x * speed;
          this.vel.z = this.lungeDir.z * speed;
        }
        if (this.pos.distanceTo(ctx.playerFeet) < 1.25 && ctx.playerVulnerable && k > 0.25) {
          this.events.caught?.(this);
          this.setState('celebrate');
          break;
        }
        if (k > 1.25) this.setState('chase');
        break;
      }
      case 'search': {
        if (this.meter >= 1 || (this.seesPlayer && stars >= 2)) {
          this.spotted();
          break;
        }
        const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
        if (d > 1) {
          face = this.target;
          speed = 3.6 + stars * 0.3;
        } else {
          this.lookOffset = Math.sin(this.stateT * 2.2) * 1.2;
        }
        if (this.stateT > 7) this.setState('return');
        break;
      }
      case 'return': {
        if (this.meter > 0.3) {
          this.setState('investigate');
          this.target.copy(this.lastSeen);
          break;
        }
        // head back to the nearest patrol point
        let best = 0;
        let bd = Infinity;
        route.forEach((p, i) => {
          const d = p.distanceTo(this.pos);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        if (bd < 0.8) {
          this.routeIdx = best;
          this.setState('patrol');
        } else {
          face = route[best];
          speed = 2.8;
        }
        break;
      }
      case 'stunned': {
        this.vel.multiplyScalar(Math.exp(-4 * dt));
        if (this.stateT > this.stunTime) {
          this.target.copy(ctx.playerFeet);
          this.lastSeen.copy(ctx.playerFeet);
          this.setState(stars >= 2 ? 'chase' : 'search');
        }
        break;
      }
      case 'celebrate': {
        if (this.stateT > 1.8) {
          this.target.copy(ctx.playerFeet);
          this.setState('search');
        }
        break;
      }
    }

    // ---- locomotion
    if (this.state !== 'stunned' && this.state !== 'lunge') {
      if (face && speed > 0) {
        const dx = face.x - this.pos.x;
        const dz = face.z - this.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        const tx = (dx / l) * speed;
        const tz = (dz / l) * speed;
        const a = 1 - Math.exp(-8 * dt);
        this.vel.x += (tx - this.vel.x) * a;
        this.vel.z += (tz - this.vel.z) * a;
      } else {
        this.vel.x *= Math.exp(-10 * dt);
        this.vel.z *= Math.exp(-10 * dt);
      }
    }
    if (this.state === 'celebrate' || this.state === 'investigate') {
      if (this.state === 'celebrate') {
        this.vel.x *= Math.exp(-10 * dt);
        this.vel.z *= Math.exp(-10 * dt);
      }
    }
    // turn toward movement (or the thing being looked at)
    let yawTarget = this.yaw;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'lunge') yawTarget = Math.atan2(this.lungeDir.x, this.lungeDir.z);
    else if (hs > 0.4) yawTarget = Math.atan2(this.vel.x, this.vel.z);
    else if (face) yawTarget = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
    if (this.state !== 'stunned') this.yaw = dampAngle(this.yaw, yawTarget, this.state === 'chase' ? 10 : 5, dt);

    // gravity + character controller
    this.vy = Math.max(-20, this.vy - 25 * dt);
    const desired = { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt };
    // keep guards inside their zone
    const nx = this.pos.x + desired.x;
    const nz = this.pos.z + desired.z;
    const z = this.cfg.zone;
    if (nx < z.min.x || nx > z.max.x) desired.x = 0;
    if (nz < z.min.z || nz > z.max.z) desired.z = 0;
    this.cc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, MOVE_FILTER);
    const mv = this.cc.computedMovement();
    if (this.cc.computedGrounded()) this.vy = 0;
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    if (next.y < -10) {
      // fell somewhere silly: return to route start
      const s = this.cfg.route[0];
      next.x = s.x;
      next.y = s.y + 0.72 * K;
      next.z = s.z;
    }
    this.body.setNextKinematicTranslation(next);
    this.pos.set(next.x, next.y - 0.72 * K, next.z);
    // stuck detection while patrolling
    if (speed > 0.5 && Math.hypot(mv.x, mv.z) < speed * dt * 0.2) {
      this.stuckT += dt;
      if (this.stuckT > 1.2) {
        this.stuckT = 0;
        if (this.state === 'patrol') this.routeIdx = (this.routeIdx + 1) % Math.max(1, route.length);
        if (this.state === 'investigate' || this.state === 'search') this.setState('return');
      }
    } else this.stuckT = 0;

    // ---- visuals
    const anim: PenguinAnim =
      this.state === 'stunned'
        ? 'stunned'
        : this.state === 'celebrate'
          ? 'celebrate'
          : this.state === 'lunge' && this.stateT > 0.25
            ? 'slide'
            : this.state === 'chase'
              ? this.stateT < 0.45
                ? 'alert'
                : 'chase'
              : this.state === 'investigate'
                ? 'suspicious'
                : this.state === 'search'
                  ? 'search'
                  : hs > 0.3
                    ? 'walk'
                    : 'idle';
    this.model.anim = anim;
    this.model.lookYaw = this.lookOffset;
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    this.model.update(dt, hs);

    // vision cone color by state
    const alertness = this.state === 'chase' || this.state === 'lunge' ? 2 : this.meter > 0.05 || this.state === 'investigate' || this.state === 'search' ? 1 : 0;
    this.col.copy(this.state === 'stunned' ? C_STUN : alertness === 2 ? C_ALERT : alertness === 1 ? C_SUS : C_IDLE);
    const lookRot = this.lookOffset;
    this.cone.fan.rotation.z = lookRot;
    this.cone.beam.rotation.y = lookRot;
    this.cone.setState(this.col, this.meter, this.state === 'stunned' ? 0.12 : 0.55, ctx.time);

    // ? / ! icon
    const showQ = this.state === 'investigate' || this.state === 'search' || (this.state === 'patrol' && this.meter > 0.15);
    const showEx = this.state === 'chase' || this.state === 'lunge';
    this.icon.material = showEx ? icons().ex : icons().q;
    this.iconPop = Math.max(0, this.iconPop - dt * 3);
    const targetScale = showEx || showQ ? 0.62 + this.iconPop * 0.5 : 0.001;
    const sc = this.icon.scale.x + (targetScale - this.icon.scale.x) * (1 - Math.exp(-14 * dt));
    this.icon.scale.setScalar(sc);
    this.icon.visible = sc > 0.01;
    this.icon.position.y = 2.15 + Math.sin(ctx.time * 6) * 0.05;
  }

  private spotted() {
    this.setState('chase');
    this.meter = 1;
    this.model.bounce(0.7);
    this.events.spotted?.(this);
  }

  /** Force into chase (lockdown / alarm radio). */
  alert(p: THREE.Vector3) {
    if (this.busy) return;
    this.lastSeen.copy(p);
    if (this.state !== 'chase' && this.state !== 'lunge') {
      this.setState('chase');
      this.meter = 1;
    }
  }

  inZone(p: THREE.Vector3, margin = 0) {
    const z = this.cfg.zone;
    return p.x > z.min.x - margin && p.x < z.max.x + margin && p.z > z.min.z - margin && p.z < z.max.z + margin && p.y > z.min.y - 2 && p.y < z.max.y + 2;
  }

  private canSee(target: THREE.Vector3, range: number, half: number) {
    this.eye.set(this.pos.x, this.pos.y + 1.1 * K, this.pos.z);
    const dx = target.x - this.eye.x;
    const dy = target.y - this.eye.y;
    const dz = target.z - this.eye.z;
    const d = Math.hypot(dx, dz);
    if (d > range || Math.abs(dy) > 3.5) return false;
    const facing = this.yaw + this.lookOffset;
    const ang = Math.abs(angleDiff(facing, Math.atan2(dx, dz)));
    if (ang > half && d > 1.2) return false;
    const dir = new THREE.Vector3(dx, dy, dz);
    const dist = dir.length();
    dir.multiplyScalar(1 / dist);
    const hit = this.physics.rayWorld(this.eye, dir, dist - 0.4, G.WORLD);
    return hit === null;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.model.root);
    this.cone.dispose();
    this.physics.removeBody(this.body);
  }
}
