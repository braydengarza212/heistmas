import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/** Collision group bits. */
export const G = {
  WORLD: 1 << 0,
  PLAYER: 1 << 1,
  LOOT: 1 << 2,
  PROPS: 1 << 3,
  GUARD: 1 << 4,
  RAGDOLL: 1 << 5,
  HAZARD: 1 << 6,
  DEBRIS: 1 << 7,
  CAMERA_BLOCK: 1 << 8,
};

export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

export const WORLD_GROUPS = groups(G.WORLD | G.CAMERA_BLOCK, 0xffff);
export const HAZARD_GROUPS = groups(G.HAZARD | G.WORLD, 0xffff);

export type ColliderTag =
  | { kind: 'world' }
  | { kind: 'platform'; id: number }
  | { kind: 'conveyor'; velocity: THREE.Vector3 }
  | { kind: 'hazard'; id: number }
  | { kind: 'prop'; id: number }
  | { kind: 'door'; id: number }
  /** Slippery surface (icy rooftops). */
  | { kind: 'ice' };

const UP = { x: 0, y: 0, z: 0, w: 1 };

export class Physics {
  readonly world: RAPIER.World;
  readonly tags = new Map<number, ColliderTag>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -22, z: 0 });
    this.world.timestep = 1 / 60;
  }

  tag(c: RAPIER.Collider, t: ColliderTag) {
    this.tags.set(c.handle, t);
    return c;
  }

  tagOf(c: RAPIER.Collider | null | undefined): ColliderTag | undefined {
    return c ? this.tags.get(c.handle) : undefined;
  }

  /** Static box collider; position = center, size = full extents. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0, grp = WORLD_GROUPS) {
    const desc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z).setCollisionGroups(grp);
    if (rotY) desc.setRotation(quatY(rotY));
    return this.world.createCollider(desc);
  }

  boxRot(x: number, y: number, z: number, w: number, h: number, d: number, q: THREE.Quaternion, grp = WORLD_GROUPS) {
    const desc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
      .setTranslation(x, y, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setCollisionGroups(grp);
    return this.world.createCollider(desc);
  }

  cylinder(x: number, y: number, z: number, r: number, h: number, grp = WORLD_GROUPS) {
    return this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(x, y, z).setCollisionGroups(grp),
    );
  }

  ball(x: number, y: number, z: number, r: number, grp = WORLD_GROUPS) {
    return this.world.createCollider(RAPIER.ColliderDesc.ball(r).setTranslation(x, y, z).setCollisionGroups(grp));
  }

  /** Kinematic body with a single collider; returns both. */
  kinematic(desc: RAPIER.ColliderDesc, x: number, y: number, z: number) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    const col = this.world.createCollider(desc, body);
    return { body, col };
  }

  dynamic(desc: RAPIER.ColliderDesc, x: number, y: number, z: number, opts: { ccd?: boolean; linDamp?: number; angDamp?: number } = {}) {
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(opts.linDamp ?? 0.05)
      .setAngularDamping(opts.angDamp ?? 0.3)
      .setCcdEnabled(!!opts.ccd);
    const body = this.world.createRigidBody(bd);
    const col = this.world.createCollider(desc, body);
    return { body, col };
  }

  removeBody(body: RAPIER.RigidBody) {
    for (let i = 0; i < body.numColliders(); i++) this.tags.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  removeCollider(c: RAPIER.Collider) {
    this.tags.delete(c.handle);
    this.world.removeCollider(c, true);
  }

  /** Ray cast against world geometry only. Returns hit distance or null. */
  rayWorld(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mask = G.WORLD) {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(0xffff, mask));
    return hit ? hit.timeOfImpact : null;
  }

  rayWorldHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, mask = G.WORLD) {
    const ray = new RAPIER.Ray(origin, dir);
    return this.world.castRayAndGetNormal(ray, maxDist, true, undefined, groups(0xffff, mask));
  }

  dispose() {
    this.world.free();
    this.tags.clear();
  }
}

export function quatY(a: number) {
  return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
}

export const IDENTITY = UP;

export { RAPIER };
