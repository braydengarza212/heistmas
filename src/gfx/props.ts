import * as THREE from 'three';
import {
  capsule,
  mergeAllMeshes,
  coinGeo,
  cone,
  cyl,
  fluff,
  fluffySphere,
  fluffyTorus,
  gemGeo,
  goldBarGeo,
  rbox,
  sphere,
  star3D,
  taperedTube,
  torus,
} from './geom';
import { Mats } from './materials';
import { TextureLib } from './textures';
import { mulberry32 } from '../core/math';

// ======================================================================
// Instanced fields (string-light bulbs and tree ornaments)
// ======================================================================

export const sharedTime = { value: 0 };

const BULB_COLORS = [0xff3b4e, 0x3bff8a, 0xffd23b, 0x3b9bff, 0xff7b2b, 0xffffff];

export class BulbField {
  private pos: THREE.Vector3[] = [];
  private col: THREE.Color[] = [];
  private scl: number[] = [];

  add(p: THREE.Vector3, colorHex?: number, scale = 1) {
    this.pos.push(p.clone());
    const hex = colorHex ?? BULB_COLORS[this.pos.length % BULB_COLORS.length];
    this.col.push(new THREE.Color(hex));
    this.scl.push(scale);
  }

  get count() {
    return this.pos.length;
  }

  build(brightness = 6, radius = 0.055) {
    const geo = sphere(radius, 8, 6).clone();
    const n = this.pos.length;
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) phase[i] = Math.random();
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = sharedTime;
      // capped: fairy lights twinkle brightly but never flare into glare
      sh.uniforms.uBright = { value: Math.min(brightness, 3.2) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uTime;\nvarying float vTw;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvTw = 0.35 + 0.65 * smoothstep(-0.2, 0.9, sin(uTime * (1.6 + aPhase * 1.8) + aPhase * 6.2831));',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vTw;\nuniform float uBright;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTw * uBright;');
    };
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.makeScale(this.scl[i], this.scl[i] * 1.25, this.scl[i]);
      m.setPosition(this.pos[i]);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, this.col[i]);
    }
    mesh.count = n;
    mesh.frustumCulled = false;
    mesh.userData.noAO = true;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }
}

export class OrnamentField {
  private items: { p: THREE.Vector3; c: THREE.Color; s: number }[] = [];
  add(p: THREE.Vector3, hex: number, s = 1) {
    this.items.push({ p: p.clone(), c: new THREE.Color(hex), s });
  }
  build() {
    const geo = sphere(0.1, 12, 9);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.75, roughness: 0.18, clearcoat: 1 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, this.items.length));
    const m = new THREE.Matrix4();
    this.items.forEach((it, i) => {
      m.makeScale(it.s, it.s, it.s);
      m.setPosition(it.p);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, it.c);
    });
    mesh.count = this.items.length;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

const ORN_COLORS = [0xd31f2b, 0xf2c14e, 0x2a6bd7, 0xe8e8f0, 0x9b3fd1, 0x1d9a55];

// ======================================================================
// Props
// ======================================================================

function m(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Gift box with wrap pattern, ribbon cross and a looped bow (merged to 2 draw calls). */
export function present(w: number, h: number, d: number, variant: number, ribbon = 0xf2c14e, gold = false, withBow = true) {
  const g = new THREE.Group();
  const wrap = gold ? Mats.goldPresent() : Mats.gift(variant);
  const r = Math.min(w, h, d) * 0.08;
  m(rbox(w, h, d, r, 3), wrap, g, 0, h / 2, 0);
  const rib = gold ? Mats.ribbon(0xd31f2b) : Mats.ribbon(ribbon);
  const t = Math.min(w, d) * 0.16;
  m(rbox(w + 0.02, h + 0.02, t, Math.min(r, t / 2.2), 2), rib, g, 0, h / 2, 0);
  m(rbox(t, h + 0.02, d + 0.02, Math.min(r, t / 2.2), 2), rib, g, 0, h / 2, 0);
  const s = Math.min(w, d) * 0.5;
  if (withBow) {
    for (const side of [-1, 1]) {
      const loop = m(torus(s * 0.34, s * 0.11, 8, 16), rib, g, side * s * 0.32, h + s * 0.18, 0);
      loop.rotation.set(0, Math.PI / 2, side * 0.5);
      loop.scale.set(1, 0.75, 1);
    }
    m(sphere(s * 0.16, 12, 8), rib, g, 0, h + s * 0.06, 0);
  }
  return mergeAllMeshes(g);
}

/** Stylized toy Christmas tree with scalloped tiers. */
export function christmasTree(
  height: number,
  opts: { bulbs?: BulbField; ornaments?: OrnamentField; snow?: boolean; seed?: number; star?: boolean; at?: THREE.Vector3 } = {},
) {
  const g = new THREE.Group();
  const off = opts.at ?? new THREE.Vector3();
  const rnd = mulberry32(opts.seed ?? 7);
  const trunkH = height * 0.12;
  m(cyl(height * 0.06, height * 0.075, trunkH, 12), Mats.bark(), g, 0, trunkH / 2, 0);
  const tiers = height > 5 ? 5 : 4;
  const baseR = height * 0.36;
  let y = trunkH * 0.7;
  const tierH = (height * 0.86) / tiers;
  for (let i = 0; i < tiers; i++) {
    const k = i / tiers;
    const R = baseR * (1 - k * 0.72);
    const h = tierH * 1.45;
    const geo = tierGeometry(R, h, 9 + i, rnd() * 10);
    m(geo, i % 2 ? Mats.pineDark() : Mats.pine(), g, 0, y, 0);
    if (opts.snow) {
      const cap = tierGeometry(R * 0.72, h * 0.45, 9 + i, rnd() * 10);
      m(cap, Mats.snowCap(), g, 0, y + h * 0.6, 0);
    }
    if (opts.ornaments) {
      const n = Math.round(6 + R * 5);
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2 + rnd() * 0.5;
        const yy = y + h * (0.05 + rnd() * 0.25);
        const rr = R * (1 - (yy - y) / h) * 0.98;
        opts.ornaments.add(
          new THREE.Vector3(Math.sin(a) * rr, yy - 0.04, Math.cos(a) * rr).add(off),
          ORN_COLORS[Math.floor(rnd() * ORN_COLORS.length)],
          0.9 + (height / 9) * 0.9,
        );
      }
    }
    y += tierH;
  }
  if (opts.bulbs) {
    const turns = tiers * 1.4;
    const n = Math.round(height * 22);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const a = t * turns * Math.PI * 2;
      const yy = trunkH * 0.7 + t * height * 0.83;
      const k = (yy - trunkH * 0.7) / (height * 0.9);
      const tierPos = ((yy - trunkH * 0.7) % tierH) / (tierH * 1.45);
      const R = baseR * (1 - k * 0.72) * (1 - tierPos) * 0.98 + 0.05;
      opts.bulbs.add(new THREE.Vector3(Math.sin(a) * R, yy, Math.cos(a) * R).add(off));
    }
  }
  if (opts.star !== false) {
    const star = m(star3D(height * 0.07, height * 0.03, height * 0.02), Mats.glow(0xffc84a, 4), g, 0, y + height * 0.06, 0);
    star.castShadow = false;
  }
  return g;
}

function tierGeometry(R: number, h: number, lobes: number, seed: number) {
  const pts = [
    new THREE.Vector2(0.001, h),
    new THREE.Vector2(R * 0.2, h * 0.82),
    new THREE.Vector2(R * 0.55, h * 0.45),
    new THREE.Vector2(R * 0.88, h * 0.12),
    new THREE.Vector2(R, 0.02 * h),
    new THREE.Vector2(R * 0.92, -0.04 * h),
    new THREE.Vector2(R * 0.55, 0.0),
    new THREE.Vector2(0.001, 0.08 * h),
  ];
  const geo = new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(16), 36);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(x, z);
    const edge = 1 - Math.min(1, y / (h * 0.5));
    const wave = 1 + Math.sin(a * lobes + seed) * 0.07 * edge;
    pos.setXYZ(i, x * wave, y - Math.max(0, Math.sin(a * lobes + seed)) * 0.05 * h * edge, z * wave);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Snowy pine for outdoor areas. */
export function snowyPine(height: number, seed = 1) {
  return christmasTree(height, { snow: true, seed, star: false });
}

/** Marble column with gold base/capital and a garland spiral. */
export function column(height: number, radius: number, bulbs?: BulbField, at = new THREE.Vector3()) {
  const g = new THREE.Group();
  const shaftMat = Mats.marbleCream(1, 2);
  m(cyl(radius, radius * 1.05, height - 0.9, 28), shaftMat, g, 0, (height - 0.9) / 2 + 0.45, 0);
  // flutes as thin dark-gold strips
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const f = m(rbox(0.05, height - 1.2, 0.03, 0.012), Mats.goldSatin(), g, Math.sin(a) * radius, height / 2, Math.cos(a) * radius);
    f.rotation.y = a;
  }
  m(rbox(radius * 2.7, 0.3, radius * 2.7, 0.08), Mats.marbleCream(), g, 0, 0.15, 0);
  m(cyl(radius * 1.2, radius * 1.25, 0.18, 28), Mats.gold(), g, 0, 0.39, 0);
  m(cyl(radius * 1.35, radius * 1.1, 0.3, 28), Mats.gold(), g, 0, height - 0.3, 0);
  m(rbox(radius * 2.9, 0.22, radius * 2.9, 0.06), Mats.marbleCream(), g, 0, height - 0.08, 0);
  // garland spiral
  const pts: THREE.Vector3[] = [];
  const turns = 2.2;
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const a = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.sin(a) * (radius + 0.12), 0.8 + t * (height - 1.8), Math.cos(a) * (radius + 0.12)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const gar = fluff(new THREE.TubeGeometry(curve, 160, 0.13, 8, false), 0.035, 18, 4);
  m(gar, Mats.pine(), g);
  if (bulbs) for (let i = 0; i <= 40; i++) bulbs.add(curve.getPointAt(i / 40).add(new THREE.Vector3(0, 0.08, 0)).add(at));
  // bow at the top
  bow(g, 0, height - 0.75, radius + 0.2, 0.55);
  return g;
}

export function bow(parent: THREE.Object3D, x: number, y: number, z: number, s = 0.5, color = 0xd31f2b) {
  const rib = Mats.ribbon(color);
  for (const side of [-1, 1]) {
    const loop = m(torus(s * 0.32, s * 0.1, 8, 18), rib, parent, x + side * s * 0.3, y, z);
    loop.rotation.set(0, 0, side * 0.45);
    loop.scale.set(1, 0.7, 0.6);
    const tail = m(rbox(s * 0.16, s * 0.55, s * 0.05, s * 0.03), rib, parent, x + side * s * 0.14, y - s * 0.32, z);
    tail.rotation.z = side * 0.3;
  }
  m(sphere(s * 0.13, 12, 8), rib, parent, x, y, z);
}

/** Evergreen wreath with bow and ornaments. */
export function wreath(R: number) {
  const g = new THREE.Group();
  const geo = fluff(new THREE.TorusGeometry(R, R * 0.28, 14, 40), R * 0.07, 9 / R, 3);
  m(geo, Mats.pine(), g);
  const rnd = mulberry32(Math.round(R * 100));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const o = m(sphere(R * 0.09, 10, 8), Mats.plastic(ORN_COLORS[Math.floor(rnd() * 3)]), g, Math.cos(a) * R, Math.sin(a) * R, R * 0.2);
    o.castShadow = false;
  }
  bow(g, 0, -R * 0.95, R * 0.25, R * 0.9);
  return g;
}

/** Catenary garland between two points; bulbs optional. */
export function garland(a: THREE.Vector3, b: THREE.Vector3, sag: number, parent: THREE.Object3D, bulbs?: BulbField, thickness = 0.14) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const len = a.distanceTo(b);
  const geo = fluff(new THREE.TubeGeometry(curve, Math.max(16, Math.round(len * 6)), thickness, 8, false), thickness * 0.3, 16, 2);
  m(geo, Mats.pine(), parent);
  if (bulbs) {
    const n = Math.max(4, Math.round(len * 2.2));
    for (let i = 0; i <= n; i++) bulbs.add(curve.getPointAt(i / n).add(new THREE.Vector3(0, -thickness * 0.8, 0)));
  }
  return curve;
}

/** Simple wire string-light strand (thin dark cable) with bulbs. */
export function lightString(a: THREE.Vector3, b: THREE.Vector3, sag: number, parent: THREE.Object3D, bulbs: BulbField, spacing = 0.45) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const len = a.distanceTo(b);
  m(new THREE.TubeGeometry(curve, 24, 0.015, 4, false), Mats.rubber(), parent).castShadow = false;
  const n = Math.max(3, Math.round(len / spacing));
  for (let i = 1; i < n; i++) bulbs.add(curve.getPointAt(i / n).add(new THREE.Vector3(0, -0.06, 0)));
}

/** Street lamp with lantern, wreath and snow cap. Returns the bulb position. */
export function lampPost(parent: THREE.Object3D, x: number, y: number, z: number, h = 4.2) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  m(cyl(0.09, 0.12, h, 12), Mats.darkMetal(), g, 0, h / 2, 0);
  m(cyl(0.22, 0.28, 0.4, 16), Mats.darkMetal(), g, 0, 0.2, 0);
  m(cyl(0.3, 0.22, 0.12, 16), Mats.darkMetal(), g, 0, h + 0.06, 0);
  const lantern = m(cyl(0.22, 0.16, 0.5, 6, false), Mats.glass(), g, 0, h + 0.37, 0);
  lantern.castShadow = false;
  m(sphere(0.12, 12, 10), Mats.glow(0xffc070, 6), g, 0, h + 0.36, 0).castShadow = false;
  m(cone(0.32, 0.3, 6), Mats.darkMetal(), g, 0, h + 0.77, 0);
  m(sphere(0.2, 12, 8), Mats.snowCap(), g, 0, h + 0.85, 0).scale.set(1.3, 0.45, 1.3);
  const wr = wreath(0.28);
  wr.position.set(0, h * 0.62, 0.14);
  g.add(wr);
  return new THREE.Vector3(x, y + h + 0.36, z);
}

/** Velvet bench with gold legs. */
export function bench(len: number) {
  const g = new THREE.Group();
  m(rbox(len, 0.22, 0.75, 0.1, 4), Mats.velvet(), g, 0, 0.55, 0);
  m(rbox(len, 0.7, 0.2, 0.09, 4), Mats.velvet(), g, 0, 0.95, -0.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m(cyl(0.05, 0.04, 0.45, 8), Mats.gold(), g, sx * (len / 2 - 0.15), 0.22, sz * 0.25);
  return g;
}

/** Velvet rope stanchion pair. */
export function stanchion(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  for (const p of [a, b]) {
    m(cyl(0.2, 0.24, 0.06, 16), Mats.gold(), parent, p.x, p.y + 0.03, p.z);
    m(cyl(0.035, 0.035, 0.95, 10), Mats.gold(), parent, p.x, p.y + 0.5, p.z);
    m(sphere(0.07, 12, 10), Mats.gold(), parent, p.x, p.y + 1.0, p.z);
  }
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y += 0.62;
  const curve = new THREE.QuadraticBezierCurve3(a.clone().setY(a.y + 0.9), mid, b.clone().setY(b.y + 0.9));
  m(new THREE.TubeGeometry(curve, 16, 0.04, 8, false), Mats.velvet(), parent);
}

export function candyCane(h: number) {
  const g = new THREE.Group();
  const curve = new THREE.CurvePath<THREE.Vector3>();
  curve.add(new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, h * 0.78, 0)));
  curve.add(
    new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, h * 0.78, 0),
      new THREE.Vector3(0, h * 1.02, 0),
      new THREE.Vector3(h * 0.3, h * 1.02, 0),
      new THREE.Vector3(h * 0.3, h * 0.82, 0),
    ),
  );
  const tube = new THREE.TubeGeometry(curve, 48, h * 0.045, 12, false);
  m(tube, Mats.candy(6, 1), g);
  return g;
}

/** Money: green cash stack with a paper band. */
export function cashStack() {
  const g = new THREE.Group();
  m(rbox(0.42, 0.14, 0.22, 0.02), Mats.matte(0x3f8f4f, 0.6), g, 0, 0.07, 0);
  m(rbox(0.1, 0.15, 0.23, 0.01), Mats.matte(0xf5ecd0, 0.5), g, 0, 0.07, 0);
  return g;
}

export function moneyBag(scale = 1) {
  const g = new THREE.Group();
  const body = m(fluffySphere(0.32 * scale, 0.02 * scale, 4, 3), Mats.burlap(), g, 0, 0.3 * scale, 0);
  body.scale.set(1, 0.95, 1);
  m(cyl(0.08 * scale, 0.14 * scale, 0.14 * scale, 12), Mats.burlap(), g, 0, 0.62 * scale, 0);
  m(torus(0.1 * scale, 0.025 * scale, 8, 16), Mats.ribbon(0xf2c14e), g, 0, 0.6 * scale, 0).rotation.x = Math.PI / 2;
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.34 * scale, 0.34 * scale), patchMaterial());
  patch.position.set(0, 0.3 * scale, 0.33 * scale);
  g.add(patch);
  return g;
}

let _patchMat: THREE.MeshStandardMaterial | null = null;
function patchMaterial() {
  return (_patchMat ??= new THREE.MeshStandardMaterial({ map: TextureLib.sackPatch(), transparent: true, alphaTest: 0.3, metalness: 0.4, roughness: 0.4 }));
}

export function goldBar() {
  const g = new THREE.Group();
  m(goldBarGeo(), Mats.gold(), g, 0, 0.1, 0);
  return g;
}

export function gem(color = 0x8fe9ff, r = 0.32) {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.1,
    roughness: 0.02,
    clearcoat: 1,
    iridescence: 1,
    iridescenceIOR: 1.8,
    emissive: new THREE.Color(color).multiplyScalar(0.25),
    envMapIntensity: 2.5,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(gemGeo(r), mat);
  mesh.castShadow = true;
  return mesh;
}

/** Instanced coin mountain (decorative). */
export function coinPile(radius: number, height: number, count: number, seed = 1) {
  const geo = coinGeo();
  const inst = new THREE.InstancedMesh(geo, Mats.gold(), count);
  const rnd = mulberry32(seed);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rnd()) * radius;
    const a = rnd() * Math.PI * 2;
    const hh = height * Math.pow(1 - r / radius, 1.3);
    p.set(Math.cos(a) * r, rnd() * hh, Math.sin(a) * r);
    e.set((rnd() - 0.5) * 1.2, rnd() * 6.28, (rnd() - 0.5) * 1.2);
    q.setFromEuler(e);
    mtx.compose(p, q, s);
    inst.setMatrixAt(i, mtx);
  }
  inst.castShadow = true;
  inst.receiveShadow = true;
  // inner mound so the pile reads as solid
  const g = new THREE.Group();
  g.add(inst);
  const mound = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.98, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), Mats.goldSatin());
  mound.scale.y = (height * 0.92) / radius;
  mound.receiveShadow = true;
  g.add(mound);
  return g;
}

/** Ornate chandelier hanging from (0,0,0) downward. Returns group. */
export function chandelier(bulbs: BulbField, scale = 1, at = new THREE.Vector3()) {
  const g = new THREE.Group();
  m(cyl(0.03, 0.03, 1.6 * scale, 6), Mats.gold(), g, 0, -0.8 * scale, 0);
  for (const [r, y] of [
    [1.1, -1.8],
    [0.7, -2.2],
  ] as const) {
    const ring = m(torus(r * scale, 0.05 * scale, 8, 40), Mats.gold(), g, 0, y * scale, 0);
    ring.rotation.x = Math.PI / 2;
    const n = Math.round(r * 10);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * r * scale;
      const z = Math.sin(a) * r * scale;
      m(cyl(0.035 * scale, 0.035 * scale, 0.18 * scale, 8), Mats.matte(0xfff3dc, 0.4), g, x, (y + 0.1) * scale, z);
      bulbs.add(new THREE.Vector3(x, (y + 0.24) * scale, z).add(at), 0xffd9a0, 1.2 * scale);
      const crystal = m(cone(0.04 * scale, 0.16 * scale, 6), Mats.glass(), g, x * 0.92, (y - 0.15) * scale, z * 0.92);
      crystal.rotation.x = Math.PI;
      crystal.castShadow = false;
    }
  }
  m(sphere(0.18 * scale, 16, 12), Mats.gold(), g, 0, -2.45 * scale, 0);
  return g;
}

/** Security camera on a wall mount. */
export function securityCam() {
  const g = new THREE.Group();
  m(rbox(0.12, 0.3, 0.12, 0.03), Mats.darkMetal(), g, 0, -0.15, 0);
  const head = new THREE.Group();
  head.position.y = -0.32;
  g.add(head);
  m(rbox(0.26, 0.22, 0.5, 0.06), Mats.plastic(0xe9edf2), head, 0, 0, 0.12);
  m(cyl(0.07, 0.07, 0.06, 16), Mats.blackGloss(), head, 0, 0, 0.39).rotation.x = Math.PI / 2;
  m(sphere(0.025, 8, 6), Mats.glow(0xff2a3d, 6), head, 0.08, 0.06, 0.37).castShadow = false;
  g.userData.head = head;
  return g;
}

/** Laser emitter node (housing + glowing lens). */
export function laserEmitter(color = 0xff2a3d) {
  const g = new THREE.Group();
  m(rbox(0.26, 0.26, 0.2, 0.06), Mats.darkMetal(), g);
  const lens = m(sphere(0.07, 12, 10), Mats.glow(color, 7), g, 0, 0, 0.1);
  lens.castShadow = false;
  return g;
}

/** Golden snowflake decoration (flat, for walls). */
export function snowflake(r: number, mat: THREE.Material) {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / 6) * Math.PI * 2;
    g.add(arm);
    m(rbox(r * 0.12, r, r * 0.06, r * 0.03), mat, arm, 0, r / 2, 0);
    for (const s of [-1, 1]) {
      const twig = m(rbox(r * 0.08, r * 0.35, r * 0.05, r * 0.02), mat, arm, s * r * 0.1, r * 0.62, 0);
      twig.rotation.z = -s * 0.8;
    }
  }
  return g;
}

/** Decorative giant ornament bauble (wall/ceiling decor). */
export function bauble(r: number, color: number) {
  const g = new THREE.Group();
  m(sphere(r, 24, 18), new THREE.MeshPhysicalMaterial({ color, metalness: 0.7, roughness: 0.15, clearcoat: 1 }), g);
  m(cyl(r * 0.22, r * 0.22, r * 0.25, 12), Mats.gold(), g, 0, r * 1.02, 0);
  m(torus(r * 0.12, r * 0.03, 6, 12), Mats.gold(), g, 0, r * 1.2, 0);
  return g;
}

export function curvedBezier(points: THREE.Vector3[], r0: number, r1: number, mat: THREE.Material, parent: THREE.Object3D) {
  const curve = new THREE.CatmullRomCurve3(points);
  return m(taperedTube(curve, r0, r1, 32, 12), mat, parent);
}

export { m as meshIn, capsule };
