import * as THREE from 'three';
import { Physics, G, groups } from '../physics';
import { StaticBatcher, rbox, cyl } from '../../gfx/geom';
import { Mats } from '../../gfx/materials';
import type { DecorKind } from '../heistObjects';

/**
 * Small helpers the level builders share: batched architecture with
 * colliders, world-scaled UVs, and a few shorthands.
 */

const uvBoxCache = new Map<string, THREE.BufferGeometry>();
/** Box with UVs in world units / tile so textures keep their scale. */
export function uvBox(w: number, h: number, d: number, tile: number) {
  const key = `${w.toFixed(2)},${h.toFixed(2)},${d.toFixed(2)},${tile}`;
  let g = uvBoxCache.get(key);
  if (g) return g;
  g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, (uv.getX(idx) * dims[f][0]) / tile, (uv.getY(idx) * dims[f][1]) / tile);
    }
  uvBoxCache.set(key, g);
  return g;
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const S1 = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export class Kit {
  constructor(
    readonly physics: Physics,
    readonly batch: StaticBatcher,
    readonly root: THREE.Group,
  ) {}

  /** Architectural block (world-scaled UVs) with optional collider. Position = center. */
  block(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    o: { tile?: number; col?: boolean; cast?: boolean; rotY?: number; recv?: boolean } = {},
  ) {
    const geo = uvBox(w, h, d, o.tile ?? 2);
    Q.setFromAxisAngle(UP, o.rotY ?? 0);
    M.compose(new THREE.Vector3(x, y, z), Q, S1);
    this.batch.add(geo, mat, M, o.cast ?? true, o.recv ?? true);
    if (o.col !== false) return this.physics.box(x, y, z, w, h, d, o.rotY ?? 0);
    return null;
  }

  /** Rounded decorative block (batched); collider optional. */
  rblock(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, r = 0.06, o: { col?: boolean; cast?: boolean; rotY?: number } = {}) {
    Q.setFromAxisAngle(UP, o.rotY ?? 0);
    M.compose(new THREE.Vector3(x, y, z), Q, S1);
    this.batch.add(rbox(w, h, d, r, 3), mat, M, o.cast ?? true, true);
    if (o.col) return this.physics.box(x, y, z, w, h, d, o.rotY ?? 0);
    return null;
  }

  cylinder(x: number, y: number, z: number, r: number, h: number, mat: THREE.Material, o: { col?: boolean; seg?: number; cast?: boolean; rt?: number } = {}) {
    M.compose(new THREE.Vector3(x, y, z), Q.identity(), S1);
    this.batch.add(cyl(o.rt ?? r, r, h, o.seg ?? 32), mat, M, o.cast ?? true, true);
    if (o.col) this.physics.cylinder(x, y, z, Math.max(r, o.rt ?? 0), h);
  }

  /** Bake a prop into the static batch. */
  prop(obj: THREE.Object3D, x: number, y: number, z: number, rotY = 0, scale = 1) {
    obj.position.set(x, y, z);
    obj.rotation.y = rotY;
    obj.scale.setScalar(scale);
    this.batch.addObject(obj);
  }

  /** Bake a prop and give it a solid box collider matching its bounds (camera passes through). */
  solidProp(obj: THREE.Object3D, x: number, y: number, z: number, rotY = 0, scale = 1, shrink = 0.85) {
    this.prop(obj, x, y, z, rotY, scale);
    const b = new THREE.Box3().setFromObject(obj);
    const c = b.getCenter(new THREE.Vector3());
    const s = b.getSize(new THREE.Vector3());
    this.physics.box(c.x, c.y, c.z, Math.max(0.2, s.x * shrink), Math.max(0.2, s.y), Math.max(0.2, s.z * shrink), 0, groups(G.WORLD, 0xffff));
  }

  /** Add a live (non-batched) object to the level. */
  live<T extends THREE.Object3D>(obj: T) {
    this.root.add(obj);
    return obj;
  }

  collider(x: number, y: number, z: number, w: number, h: number, d: number, rotY = 0) {
    return this.physics.box(x, y, z, w, h, d, rotY);
  }

  /** Invisible wall that doesn't block the camera. */
  barrier(x: number, y: number, z: number, w: number, h: number, d: number) {
    this.physics.box(x, y, z, w, h, d, 0, groups(G.WORLD, 0xffff));
  }

  carpet(x: number, z: number, w: number, len: number, y = 0.012) {
    const g = new THREE.PlaneGeometry(w, len);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / w));
    g.rotateX(-Math.PI / 2);
    M.compose(new THREE.Vector3(x, y, z), Q.identity(), S1);
    this.batch.add(g, Mats.carpet(1, 1), M, false, true);
  }

  /** Flat decal-like plane on the floor (batched, no collider). */
  floorPlane(x: number, y: number, z: number, w: number, d: number, mat: THREE.Material, rotY = 0) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    Q.setFromAxisAngle(UP, rotY);
    M.compose(new THREE.Vector3(x, y, z), Q, S1);
    this.batch.add(g, mat, M, false, true);
  }
}

export const box3 = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  new THREE.Box3(new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)));
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export type DecorFn = (kind: DecorKind, x: number, y: number, z: number, rotY?: number) => void;
