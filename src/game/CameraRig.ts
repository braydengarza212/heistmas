import * as THREE from 'three';
import { Physics, G } from './physics';
import { clamp, damp, dampVec3, noise1 } from '../core/math';
import { CHAR_SCALE as K } from './scale';

/** Third-person orbit camera with smoothing, collision avoidance and shake. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0.32;
  distance = 6.4 * K;
  private curDist = 6.4 * K;
  readonly focus = new THREE.Vector3();
  private trauma = 0;
  private t = 0;
  private fov = 62;
  sensitivity = 1;
  /** Lens override for cinematic shots (degrees); null = gameplay FOV. */
  fovOverride: number | null = null;
  invertY = false;
  shakeEnabled = true;
  /** 0 = gameplay follow, 1 = fully cinematic */
  cineBlend = 0;
  cineTarget = 0;
  readonly cinePos = new THREE.Vector3();
  readonly cineLook = new THREE.Vector3();
  private followPos = new THREE.Vector3();
  private followLook = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private snapped = false;
  /** 0 = centred follow, 1 = over the right shoulder (aiming / camera lock) */
  shoulderTarget = 0;
  private shoulder = 0;
  private pivot = new THREE.Vector3();

  constructor(private physics: Physics) {
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.08, 900);
  }

  /** Point the camera behind a heading (radians, 0 = +Z). */
  setBehind(heading: number) {
    this.yaw = heading + Math.PI;
  }

  addTrauma(a: number) {
    this.trauma = clamp(this.trauma + a, 0, 1);
  }

  /** Movement basis from the camera (forward/right on the XZ plane). */
  moveVector(x: number, y: number, out: THREE.Vector2) {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    out.set(fx * y + rx * x, fz * y + rz * x);
    const l = out.length();
    if (l > 1) out.multiplyScalar(1 / l);
    return out;
  }

  look(dx: number, dy: number) {
    const s = 0.0024 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch += (this.invertY ? -dy : dy) * s;
    this.pitch = clamp(this.pitch, -0.3, 1.2);
  }

  zoom(delta: number) {
    this.distance = clamp(this.distance + delta * 0.6 * K, 4.2 * K, 9.5);
  }

  snap(focus: THREE.Vector3) {
    this.focus.copy(focus);
    this.curDist = this.distance;
    this.snapped = true;
  }

  update(dt: number, focusTarget: THREE.Vector3, speed: number, sprinting: boolean, diving: boolean) {
    this.t += dt;
    if (!this.snapped) this.snap(focusTarget);
    // focus smoothing: tight horizontally, a little looser vertically
    this.focus.x = damp(this.focus.x, focusTarget.x, 16, dt);
    this.focus.z = damp(this.focus.z, focusTarget.z, 16, dt);
    this.focus.y = damp(this.focus.y, focusTarget.y, 9, dt);

    // over-the-shoulder pivot: slide right of the robber (never through a wall) so the crosshair sits clear of them
    this.shoulder = damp(this.shoulder, this.shoulderTarget, 7, dt);
    const sideDir = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let side = 0.85 * K * this.shoulder;
    if (side > 0.01) {
      const w = this.physics.rayWorld(this.focus, sideDir, side + 0.3, G.CAMERA_BLOCK);
      if (w !== null) side = Math.max(0, Math.min(side, w - 0.3));
    }
    this.pivot.copy(this.focus).addScaledVector(sideDir, side);
    this.pivot.y += 0.25 * K * this.shoulder;

    const desired = (this.distance + clamp(speed - 6, 0, 4) * 0.18 * K) * (1 - 0.22 * this.shoulder);
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();

    // collision: center ray + four offset rays approximate a sphere sweep
    let hitDist = desired;
    const right = this.tmp.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const offsets = [
      [0, 0],
      [0.28 * K, 0],
      [-0.28 * K, 0],
      [0, 0.24 * K],
      [0, -0.24 * K],
    ];
    for (const [ox, oy] of offsets) {
      const o = this.pivot.clone().addScaledVector(right, ox);
      o.y += oy;
      const d = this.physics.rayWorld(o, this.dir, desired + 0.3, G.CAMERA_BLOCK);
      if (d !== null) hitDist = Math.min(hitDist, d - 0.35);
    }
    hitDist = Math.max(0.9 * K, hitDist);
    this.curDist = hitDist < this.curDist ? damp(this.curDist, hitDist, 28, dt) : damp(this.curDist, hitDist, 3.5, dt);

    // when a wall pushes the camera in, rise up so the robber stays readable
    const squeeze = 1 - Math.min(1, this.curDist / Math.max(1, desired));
    this.followPos.copy(this.pivot).addScaledVector(this.dir, this.curDist);
    if (squeeze > 0.05) {
      const head = this.physics.rayWorld(this.followPos, new THREE.Vector3(0, 1, 0), 2.2, G.CAMERA_BLOCK);
      const room = head === null ? 1.6 : Math.max(0, head - 0.35);
      this.followPos.y += Math.min(squeeze * 1.6, room);
    }
    this.followLook.copy(this.pivot);
    this.followLook.y -= squeeze * 0.4;

    // cinematic blend
    this.cineBlend = damp(this.cineBlend, this.cineTarget, 3.2, dt);
    const pos = this.followPos.clone().lerp(this.cinePos, this.cineBlend);
    const look = this.followLook.clone().lerp(this.cineLook, this.cineBlend);

    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.3);
    if (this.shakeEnabled && this.trauma > 0) {
      const s = this.trauma * this.trauma;
      pos.x += noise1(this.t * 23) * 0.35 * s;
      pos.y += noise1(this.t * 25 + 50) * 0.3 * s;
      pos.z += noise1(this.t * 21 + 90) * 0.35 * s;
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    if (this.shakeEnabled && this.trauma > 0) this.camera.rotateZ(noise1(this.t * 19 + 7) * 0.05 * this.trauma * this.trauma);

    const targetFov = this.fovOverride ?? 62 + (sprinting ? 6 : 0) + (diving ? 7 : 0);
    this.fov = this.fovOverride !== null ? damp(this.fov, targetFov, 14, dt) : damp(this.fov, targetFov, 5, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  get forwardYaw() {
    return this.yaw + Math.PI;
  }

  /** Utility for cinematic setups. */
  setCinematic(pos: THREE.Vector3, look: THREE.Vector3, on = true) {
    this.cinePos.copy(pos);
    this.cineLook.copy(look);
    this.cineTarget = on ? 1 : 0;
  }

  forceCinematic(pos: THREE.Vector3, look: THREE.Vector3) {
    this.cinePos.copy(pos);
    this.cineLook.copy(look);
    this.cineTarget = 1;
    this.cineBlend = 1;
  }
}

export { dampVec3 };
