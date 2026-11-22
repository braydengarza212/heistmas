import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math';

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** Rounded box; radius is clamped so tiny boxes stay valid. */
export function rbox(w: number, h: number, d: number, r = 0.08, seg = 3) {
  const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return cached(`rbox${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${rr.toFixed(3)},${seg}`, () =>
    new RoundedBoxGeometry(w, h, d, seg, Math.max(0.001, rr)),
  );
}

export function sphere(r: number, ws = 24, hs = 16) {
  return cached(`sph${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
}

export function cyl(rt: number, rb: number, h: number, seg = 24, open = false) {
  return cached(`cyl${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
}

export function torus(R: number, r: number, rs = 12, ts = 32, arc = Math.PI * 2) {
  return cached(`tor${R},${r},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
}

export function capsule(r: number, len: number, cs = 6, rs = 14) {
  return cached(`cap${r},${len},${cs},${rs}`, () => new THREE.CapsuleGeometry(r, len, cs, rs));
}

export function cone(r: number, h: number, seg = 24) {
  return cached(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
}

/** Displaces vertices along normals with smooth noise: fur trims, snow, beards. */
export function fluff<T extends THREE.BufferGeometry>(geo: T, amount: number, freq = 6, seed = 1): T {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const s = seed * 13.37;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    const v =
      Math.sin(p.x * freq + s) * Math.sin(p.y * freq * 1.3 + s * 2) * Math.sin(p.z * freq * 0.9 + s * 3) +
      0.5 * Math.sin(p.x * freq * 2.7 + p.z * freq * 1.9 + s);
    p.addScaledVector(n, v * amount);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export function fluffyTorus(R: number, r: number, amount = 0.015, seed = 1) {
  return cached(`ftor${R},${r},${amount},${seed}`, () => fluff(new THREE.TorusGeometry(R, r, 14, 48), amount, 40, seed));
}

/** Smooth (vertex-merged) icosphere — avoids the faceted look of raw icosahedrons. */
export function smoothIco(r: number, detail = 4) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const uv = new Float32Array(n * 2);
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i).normalize();
    uv[i * 2] = 0.5 + Math.atan2(p.z, p.x) / (Math.PI * 2);
    uv[i * 2 + 1] = 0.5 + Math.asin(p.y) / Math.PI;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export function fluffySphere(r: number, amount = 0.02, seed = 1, detail = 4) {
  return cached(`fsph${r},${amount},${seed},${detail}`, () => fluff(smoothIco(r, detail), amount, 22, seed));
}

/** Five-pointed (or n-pointed) star shape. */
export function starShape(outer: number, inner: number, points = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

export function star3D(outer: number, inner: number, depth: number, points = 5) {
  return cached(`star${outer},${inner},${depth},${points}`, () => {
    const g = new THREE.ExtrudeGeometry(starShape(outer, inner, points), {
      depth,
      bevelEnabled: true,
      bevelThickness: depth * 0.5,
      bevelSize: outer * 0.08,
      bevelSegments: 3,
    });
    g.center();
    return g;
  });
}

/** Lathe from a smooth profile (points given bottom → top as [radius, y]). */
export function smoothLathe(points: [number, number][], samples = 40, segments = 48) {
  const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(samples).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  return new THREE.LatheGeometry(pts, segments);
}

/** Tapered tube along a curve (santa hat tips, candy canes, garlands). */
export function taperedTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, tubular = 32, radial = 16) {
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, c);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, p.x, p.y, p.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Rounded "pillow" slab used for platforms and cushions. */
export function pillow(w: number, h: number, d: number) {
  return rbox(w, h, d, Math.min(h * 0.45, 0.3), 4);
}

/** Gold coin geometry (with a raised rim). */
export function coinGeo() {
  return cached('coin', () => {
    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0, -0.025),
      new THREE.Vector2(0.15, -0.025),
      new THREE.Vector2(0.17, -0.015),
      new THREE.Vector2(0.17, 0.015),
      new THREE.Vector2(0.15, 0.025),
      new THREE.Vector2(0.13, 0.02),
      new THREE.Vector2(0, 0.02),
    ];
    return new THREE.LatheGeometry(pts, 14);
  });
}

/** Trapezoid gold bar. */
export function goldBarGeo() {
  return cached('goldbar', () => {
    const g = new RoundedBoxGeometry(0.62, 0.2, 0.3, 2, 0.03);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 0) {
        pos.setX(i, pos.getX(i) * 0.82);
        pos.setZ(i, pos.getZ(i) * 0.72);
      }
    }
    g.computeVertexNormals();
    return g;
  });
}

/** Brilliant-cut style gem built as a lathe with faceted (flat) shading. */
export function gemGeo(r = 0.35) {
  return cached('gem' + r, () => {
    const pts = [
      new THREE.Vector2(0.001, -r * 1.05),
      new THREE.Vector2(r, -r * 0.05),
      new THREE.Vector2(r * 0.98, r * 0.08),
      new THREE.Vector2(r * 0.62, r * 0.42),
      new THREE.Vector2(0.001, r * 0.42),
    ];
    const g = new THREE.LatheGeometry(pts, 10).toNonIndexed();
    g.computeVertexNormals();
    return g;
  });
}

// ------------------------------------------------------------------ batcher

interface BatchGroup {
  material: THREE.Material;
  cast: boolean;
  receive: boolean;
  geos: THREE.BufferGeometry[];
}

/**
 * Collects static meshes and merges them per material into a handful of draw
 * calls. Geometries are baked with their world transform.
 */
export class StaticBatcher {
  private groups = new Map<string, BatchGroup>();
  private tmp = new THREE.Matrix4();

  add(geo: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4, cast = true, receive = true) {
    const key = `${material.uuid}|${cast}|${receive}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { material, cast, receive, geos: [] };
      this.groups.set(key, g);
    }
    const clone = geo.clone();
    clone.applyMatrix4(matrix);
    for (const name of Object.keys(clone.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') clone.deleteAttribute(name);
    }
    if (!clone.attributes.uv) {
      const count = clone.attributes.position.count;
      clone.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (!clone.index) {
      const count = clone.attributes.position.count;
      const idx = new Uint32Array(count);
      for (let i = 0; i < count; i++) idx[i] = i;
      clone.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    clone.morphAttributes = {};
    g.geos.push(clone);
  }

  /** Adds a mesh (and its children) using their current world matrices. */
  addObject(obj: THREE.Object3D) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material)) {
        this.add(m.geometry, m.material as THREE.Material, m.matrixWorld, m.castShadow, m.receiveShadow);
      }
    });
  }

  build(parent: THREE.Object3D) {
    const out: THREE.Mesh[] = [];
    for (const g of this.groups.values()) {
      // Merge only geometries that share the same attribute layout.
      const byLayout = new Map<string, THREE.BufferGeometry[]>();
      for (const geo of g.geos) {
        const k = Object.keys(geo.attributes).sort().join(',');
        if (!byLayout.has(k)) byLayout.set(k, []);
        byLayout.get(k)!.push(geo);
      }
      for (const list of byLayout.values()) {
        const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        const mesh = new THREE.Mesh(merged, g.material);
        mesh.castShadow = g.cast;
        mesh.receiveShadow = g.receive;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        parent.add(mesh);
        out.push(mesh);
        if (list.length > 1) for (const geo of list) geo.dispose();
      }
    }
    this.groups.clear();
    return out;
  }
}

/**
 * Merges the given meshes (all descendants of `parent`) into one mesh per
 * material, baked in `parent`'s local space. Cuts draw calls for props that
 * are built from many small parts.
 */
export function mergeMeshes(parent: THREE.Object3D, meshes: THREE.Mesh[]) {
  if (meshes.length < 2) return;
  parent.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
  const m = new THREE.Matrix4();
  for (const mesh of meshes) {
    const mat = mesh.material as THREE.Material;
    if (!groups.has(mat)) groups.set(mat, { geos: [], cast: false });
    const g = groups.get(mat)!;
    const geo = mesh.geometry.clone();
    m.multiplyMatrices(inv, mesh.matrixWorld);
    geo.applyMatrix4(m);
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.index) {
      const idx = new Uint32Array(geo.attributes.position.count);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    g.geos.push(geo);
    g.cast = g.cast || mesh.castShadow;
    mesh.removeFromParent();
  }
  for (const [mat, g] of groups) {
    const layouts = new Map<string, THREE.BufferGeometry[]>();
    for (const geo of g.geos) {
      const k = Object.keys(geo.attributes).sort().join(',');
      if (!layouts.has(k)) layouts.set(k, []);
      layouts.get(k)!.push(geo);
    }
    for (const list of layouts.values()) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      const out = new THREE.Mesh(merged, mat);
      out.castShadow = g.cast;
      out.receiveShadow = true;
      parent.add(out);
    }
  }
}

/** Merge every mesh under `root` (when nothing inside animates separately). */
export function mergeAllMeshes<T extends THREE.Object3D>(root: T): T {
  const list: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mm = o as THREE.Mesh;
    if (mm.isMesh && !(mm as unknown as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(mm.material)) list.push(mm);
  });
  mergeMeshes(root, list);
  // drop now-empty helper groups
  for (const c of [...root.children]) if (!(c as THREE.Mesh).isMesh && c.children.length === 0) c.removeFromParent();
  return root;
}

/** Helper to compose a transform matrix quickly. */
export function mat(
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return m;
}

export function seeded(seed: number) {
  return mulberry32(seed);
}
