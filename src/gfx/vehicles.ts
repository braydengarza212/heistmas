import * as THREE from 'three';
import { cyl, rbox, sphere, star3D, fluffySphere, mergeMeshes } from './geom';
import { Mats } from './materials';
import { TextureLib } from './textures';

/**
 * Procedural vehicles for the getaway: a delivery van (the getaway car), a
 * police cruiser, a snowplow truck and a police helicopter. Every vehicle is
 * built in a local frame where +X is forward, +Y up and +Z the right-hand
 * side, standing on y = 0. Liveries and names are invented for the game.
 */

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- materials
const matCache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    m.name = key;
    matCache.set(key, m);
  }
  return m;
}

export const VMats = {
  paint: (hex: number) =>
    cached(`paint${hex}`, () => new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.45, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.07 })),
  glass: () =>
    cached('vglass', () => new THREE.MeshPhysicalMaterial({ color: 0x080c14, metalness: 0.25, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.7, side: THREE.DoubleSide })),
  trim: () => cached('vtrim', () => new THREE.MeshStandardMaterial({ color: 0x141519, roughness: 0.62, metalness: 0.1 })),
  rubber: () => cached('vrubber', () => new THREE.MeshStandardMaterial({ color: 0x18191d, roughness: 0.92 })),
  rim: () => cached('vrim', () => new THREE.MeshPhysicalMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.26 })),
  rimDark: () => cached('vrimDark', () => new THREE.MeshPhysicalMaterial({ color: 0x2c3036, metalness: 0.9, roughness: 0.35 })),
  interior: () => cached('vinterior', () => new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.85, side: THREE.BackSide })),
  under: () => cached('vunder', () => new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.95 })),
  yellow: () =>
    cached('vplowYellow', () => new THREE.MeshPhysicalMaterial({ color: 0xf2bd16, metalness: 0.35, roughness: 0.45, clearcoat: 0.6, side: THREE.DoubleSide })),
  decal: (key: string, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 1024, h = 512) =>
    cached(`decal${key}`, () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d')!, w, h);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return new THREE.MeshPhysicalMaterial({ map: t, transparent: true, roughness: 0.35, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    }),
};

// ------------------------------------------------------------------ helpers
function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Flat polygon (in the XY plane) lying on a vehicle side at depth z, facing ±Z. */
function sidePoly(parent: THREE.Object3D, pts: [number, number][], z: number, mat: THREE.Material) {
  // double-sided glass, so one polygon serves both sides of the vehicle
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return add(parent, new THREE.ShapeGeometry(shape), mat, 0, 0, z, false);
}

/** A flat quad lying on a sloped panel: center (x, y), slope from a→b in XY, width along Z. */
function slopeQuad(parent: THREE.Object3D, a: [number, number], b: [number, number], width: number, inset: number, offset: number, mat: THREE.Material) {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], 0);
  const len = dir.length();
  dir.normalize();
  const n = new THREE.Vector3(dir.y, -dir.x, 0);
  if (n.y < 0) n.negate(); // windshields and rear windows face up-and-out
  const geo = new THREE.PlaneGeometry(width, len - inset * 2);
  const m = new THREE.Mesh(geo, mat);
  const xAxis = new THREE.Vector3().crossVectors(dir, n);
  m.matrix.makeBasis(xAxis, dir, n);
  m.matrix.setPosition((a[0] + b[0]) / 2 + n.x * offset, (a[1] + b[1]) / 2 + n.y * offset, 0);
  m.matrix.decompose(m.position, m.quaternion, m.scale);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const tireCache = new Map<string, THREE.BufferGeometry>();
/** Tire with a rounded sidewall, axle along Z. */
function tireGeo(r: number, w: number) {
  const key = `${r}_${w}`;
  let g = tireCache.get(key);
  if (g) return g;
  const ri = r * 0.66;
  const hw = w / 2;
  const pts = [
    new THREE.Vector2(ri, -hw * 0.92),
    new THREE.Vector2(r * 0.86, -hw),
    new THREE.Vector2(r * 0.97, -hw * 0.86),
    new THREE.Vector2(r, -hw * 0.5),
    new THREE.Vector2(r, hw * 0.5),
    new THREE.Vector2(r * 0.97, hw * 0.86),
    new THREE.Vector2(r * 0.86, hw),
    new THREE.Vector2(ri, hw * 0.92),
  ];
  g = new THREE.LatheGeometry(pts, 32);
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  tireCache.set(key, g);
  return g;
}

export interface Wheel {
  /** Steering pivot at the wheel center. */
  steer: THREE.Group;
  /** Spins about local Z. */
  spin: THREE.Group;
  front: boolean;
  side: number;
  radius: number;
}

export interface VehicleRig {
  root: THREE.Group;
  /** Sprung body: pitch / roll / heave relative to the root. */
  body: THREE.Group;
  wheels: Wheel[];
  headLamps: THREE.Mesh[];
  tailLamps: THREE.Mesh[];
  /** Headlight beam cones (additive), may be empty. */
  beams: THREE.Mesh[];
  exhaust: THREE.Object3D | null;
  length: number;
  width: number;
}

function makeWheel(parent: THREE.Object3D, x: number, r: number, w: number, z: number, front: boolean, dark = false, dual = false): Wheel {
  const steer = new THREE.Group();
  steer.position.set(x, r, z);
  parent.add(steer);
  const spin = new THREE.Group();
  steer.add(spin);
  const side = Math.sign(z) || 1;
  add(spin, tireGeo(r, w), VMats.rubber());
  if (dual) add(spin, tireGeo(r, w), VMats.rubber(), 0, 0, -side * w * 1.02);
  const rimMat = dark ? VMats.rimDark() : VMats.rim();
  const rim = add(spin, cyl(r * 0.64, r * 0.64, w * 0.8, 24), rimMat);
  rim.rotation.x = Math.PI / 2;
  // spokes on the outer face (visible spin)
  const face = side * w * 0.41;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const sp = add(spin, rbox(r * 0.5, r * 0.11, w * 0.08, 0.01), rimMat, Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, face);
    sp.rotation.z = a;
  }
  const hub = add(spin, cyl(r * 0.17, r * 0.19, w * 0.12, 16), VMats.trim(), 0, 0, face + side * 0.01);
  hub.rotation.x = Math.PI / 2;
  // brake disc behind the spokes
  const disc = add(spin, cyl(r * 0.5, r * 0.5, w * 0.06, 20), Mats.gunmetal(), 0, 0, side * w * 0.2);
  disc.rotation.x = Math.PI / 2;
  return { steer, spin, front, side, radius: r };
}

function beamCone(len: number, r0: number, r1: number, color: number, strength = 0.22) {
  const geo = new THREE.CylinderGeometry(r1, r0, len, 20, 1, true);
  geo.translate(0, len / 2, 0);
  geo.rotateZ(-Math.PI / 2); // along +X
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
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
      uniform vec3 uColor; uniform float uStrength;
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = (1.0 - vAlong) * (1.0 - vAlong) * edge * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.userData.noAO = true;
  m.renderOrder = 5;
  m.castShadow = false;
  return m;
}

function plateTexture(text: string, bg = '#f6f1e3', fg = '#1a2340') {
  return cached(`plate${text}`, () => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(2, 2, 252, 60, 8);
    ctx.fill();
    ctx.strokeStyle = fg;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.font = 'bold 40px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 35);
    ctx.font = 'bold 10px Arial, sans-serif';
    ctx.fillText('NORTH POLE', 128, 9);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, metalness: 0.3 });
  });
}

/** Sprung body + wheels + lamps; keeps static parts merged per material. */
function finalize(rig: VehicleRig, keep: THREE.Object3D[]) {
  const statics: THREE.Mesh[] = [];
  rig.body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let p: THREE.Object3D | null = m;
    while (p && p !== rig.body) {
      if (keep.includes(p)) return;
      p = p.parent;
    }
    if ((m.material as THREE.Material).transparent || m.material instanceof THREE.ShaderMaterial) return;
    statics.push(m);
  });
  mergeMeshes(rig.body, statics);
}

// =====================================================================
// Getaway van — "Snowflake Parcel Express"
// =====================================================================

export interface VanRig extends VehicleRig {
  doors: THREE.Group[];
  interiorLight: THREE.Mesh;
  /** Where the robber lands inside the cargo bay (local). */
  cargo: THREE.Vector3;
}

const VAN_GREEN = 0x0f5236;

function vanLivery(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  // red sweep stripe
  ctx.fillStyle = '#c8162a';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.78);
  ctx.bezierCurveTo(w * 0.35, h * 0.62, w * 0.62, h * 0.95, w, h * 0.7);
  ctx.lineTo(w, h * 0.82);
  ctx.bezierCurveTo(w * 0.62, h * 1.05, w * 0.35, h * 0.74, 0, h * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.74);
  ctx.bezierCurveTo(w * 0.35, h * 0.58, w * 0.62, h * 0.91, w, h * 0.66);
  ctx.lineTo(w, h * 0.69);
  ctx.bezierCurveTo(w * 0.62, h * 0.94, w * 0.35, h * 0.61, 0, h * 0.77);
  ctx.closePath();
  ctx.fill();
  // snowflake badge
  const cx = w * 0.13;
  const cy = h * 0.36;
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 14;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * 92, cy + Math.sin(a) * 92);
    ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 52, cy + Math.sin(a) * 52);
      ctx.lineTo(cx + Math.cos(a) * 52 + Math.cos(a + s * 0.9) * 30, cy + Math.sin(a) * 52 + Math.sin(a + s * 0.9) * 30);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 112px "Titan One", "Arial Black", sans-serif';
  ctx.fillText('SNOWFLAKE', w * 0.25, h * 0.42, w * 0.71);
  ctx.font = 'bold 60px "Titan One", "Arial Black", sans-serif';
  ctx.fillStyle = '#f2c14e';
  ctx.fillText('PARCEL EXPRESS', w * 0.26, h * 0.57, w * 0.7);
  ctx.font = 'bold 32px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('NEXT-DAY SLEIGH DELIVERY  ·  1-800-HO-HO-HO', w * 0.26, h * 0.66, w * 0.7);
}

export function buildVan(): VanRig {
  const root = new THREE.Group();
  root.name = 'GetawayVan';
  const body = new THREE.Group();
  root.add(body);
  const paint = VMats.paint(VAN_GREEN);
  const trim = VMats.trim();
  const glass = VMats.glass();

  // ---- cab: extruded side profile (hood, raked windshield, roof)
  const cab = new THREE.Shape();
  cab.moveTo(0.6, 0.42);
  cab.lineTo(1.282, 0.42);
  cab.absarc(1.75, 0.37, 0.47, Math.PI - 0.1, 0.1, true);
  cab.lineTo(2.62, 0.42);
  cab.quadraticCurveTo(2.8, 0.44, 2.82, 0.62);
  cab.lineTo(2.84, 0.98);
  cab.quadraticCurveTo(2.84, 1.18, 2.66, 1.24);
  cab.lineTo(2.05, 1.4);
  cab.lineTo(1.3, 2.3);
  cab.quadraticCurveTo(1.16, 2.5, 0.92, 2.52);
  cab.lineTo(0.6, 2.52);
  cab.closePath();
  const cabGeo = new THREE.ExtrudeGeometry(cab, { depth: 1.9, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 4, curveSegments: 16 });
  cabGeo.translate(0, 0, -0.95);
  add(body, cabGeo, paint);

  // ---- cargo box (open at the back so the doors can swing)
  const sideShape = new THREE.Shape();
  sideShape.moveTo(-2.85, 0.4);
  sideShape.lineTo(-1.98, 0.4);
  sideShape.absarc(-1.55, 0.37, 0.43, Math.PI - 0.07, 0.07, true);
  sideShape.lineTo(0.64, 0.4);
  sideShape.lineTo(0.64, 2.52);
  sideShape.lineTo(-2.85, 2.52);
  sideShape.closePath();
  const sideGeo = new THREE.ExtrudeGeometry(sideShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.03, bevelSegments: 2, curveSegments: 14 });
  add(body, sideGeo, paint, 0, 0, 0.948);
  add(body, sideGeo, paint, 0, 0, -0.988);
  add(body, rbox(3.55, 0.09, 2.04, 0.045), paint, -1.1, 2.52, 0); // roof
  add(body, rbox(3.5, 0.08, 1.96, 0.03), trim, -1.1, 0.42, 0); // floor
  for (const s of [-1, 1]) add(body, rbox(0.1, 2.12, 0.14, 0.04), paint, -2.82, 1.46, s * 0.94); // rear pillars
  add(body, rbox(0.1, 0.14, 2.02, 0.04), paint, -2.82, 2.45, 0); // header
  add(body, rbox(0.14, 0.1, 2.0, 0.03), Mats.steelPlain(), -2.84, 0.46, 0); // sill plate
  // interior (seen through the open rear doors) + loot
  add(body, new THREE.BoxGeometry(3.4, 1.98, 1.88), VMats.interior(), -1.08, 1.47, 0, false);
  const lamp = add(body, rbox(0.9, 0.04, 0.3, 0.02), Mats.glow(0xffd9a0, 3), -1.4, 2.43, 0, false);
  for (const [x, z, s] of [
    [-0.5, -0.45, 0.75],
    [-0.15, 0.4, 0.9],
    [-0.9, 0.55, 0.6],
  ] as const) {
    const sack = add(body, fluffySphere(0.42, 0.06, Math.round(x * 10)), Mats.burlap(), x, 0.46 + 0.36 * s, z);
    sack.scale.set(s, s * 0.9, s);
  }
  add(body, rbox(0.55, 0.45, 0.5, 0.04), Mats.gift(2), -0.55, 0.69, -0.1);

  // ---- glass
  slopeQuad(body, [2.05, 1.4], [1.3, 2.3], 1.76, 0.07, 0.052, glass); // windshield
  const cabWin: [number, number][] = [
    [0.72, 1.5],
    [1.86, 1.5],
    [1.25, 2.26],
    [0.72, 2.26],
  ];
  sidePoly(body, cabWin, 1.0035, glass);
  sidePoly(body, cabWin, -1.0035, glass);
  // A-pillar trim + wipers
  for (const s of [-1, 1]) {
    const p = add(body, rbox(1.2, 0.07, 0.07, 0.02), trim, 1.68, 1.86, s * 0.93);
    p.rotation.z = -0.875;
  }
  for (const z of [-0.45, 0.35]) {
    const wp = add(body, rbox(0.04, 0.03, 0.62, 0.01), trim, 2.02, 1.46, z);
    wp.rotation.y = 0.12;
  }

  // ---- front fascia
  add(body, rbox(0.3, 0.34, 2.08, 0.1), trim, 2.8, 0.58, 0); // bumper
  add(body, rbox(0.06, 0.12, 1.1, 0.03), Mats.blackGloss(), 2.95, 0.55, 0); // lower intake
  add(body, rbox(0.07, 0.34, 1.16, 0.05), Mats.blackGloss(), 2.86, 0.95, 0); // grille
  for (const y of [0.85, 0.95, 1.05]) add(body, rbox(0.03, 0.03, 1.12, 0.012), Mats.chrome(), 2.9, y, 0);
  const emblem = add(body, star3D(0.09, 0.04, 0.03, 6), Mats.chrome(), 2.92, 0.95, 0);
  emblem.rotation.y = Math.PI / 2;
  const headLamps: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    add(body, rbox(0.1, 0.21, 0.46, 0.05), Mats.chrome(), 2.82, 1.08, s * 0.72);
    headLamps.push(add(body, rbox(0.05, 0.16, 0.4, 0.04), Mats.glow(0xfff4dc, 4), 2.865, 1.09, s * 0.72, false));
    add(body, rbox(0.03, 0.025, 0.36, 0.01), Mats.glow(0xe9f1ff, 7), 2.87, 0.975, s * 0.72, false); // DRL strip
    const fog = add(body, cyl(0.055, 0.055, 0.05, 14), Mats.glow(0xfff0c8, 3), 2.95, 0.52, s * 0.78, false);
    fog.rotation.z = Math.PI / 2;
    add(body, rbox(0.06, 0.06, 0.1, 0.02), Mats.glow(0xff9a1a, 3), 2.62, 0.78, s * 1.0, false); // side marker
  }
  const plateF = add(body, new THREE.PlaneGeometry(0.52, 0.13), plateTexture('H31STM'), 2.958, 0.6, 0, false);
  plateF.rotation.y = Math.PI / 2;
  // mirrors
  for (const s of [-1, 1]) {
    add(body, rbox(0.06, 0.05, 0.24, 0.02), trim, 1.66, 1.7, s * 1.1);
    add(body, rbox(0.16, 0.28, 0.1, 0.04), trim, 1.62, 1.72, s * 1.23);
    const mg = add(body, new THREE.PlaneGeometry(0.08, 0.22), glass, 1.535, 1.72, s * 1.23, false);
    mg.rotation.y = -Math.PI / 2;
  }
  // ---- sides: seams, handles, step, decals
  for (const s of [-1, 1]) {
    for (const x of [0.64, 1.98]) add(body, rbox(0.014, x > 1 ? 0.58 : 1.98, 0.014, 0.004), trim, x, x > 1 ? 1.12 : 1.42, s * 1.004, false);
    add(body, rbox(0.16, 0.04, 0.03, 0.012), Mats.chrome(), 0.86, 1.4, s * 1.012);
  }
  add(body, rbox(0.014, 1.95, 0.014, 0.004), trim, -0.32, 1.42, 1.006, false); // sliding door seam
  add(body, rbox(0.95, 0.014, 0.014, 0.004), trim, 0.16, 2.3, 1.006, false); // slide rail
  add(body, rbox(0.16, 0.04, 0.03, 0.012), Mats.chrome(), 0.42, 1.4, 1.012);
  add(body, rbox(1.0, 0.05, 0.2, 0.02), trim, 0.12, 0.36, 1.03); // step
  const livery = VMats.decal('van', vanLivery);
  const decR = add(body, new THREE.PlaneGeometry(3.25, 1.62), livery, -1.12, 1.47, 1.008, false);
  const decL = add(body, new THREE.PlaneGeometry(3.25, 1.62), livery, -1.12, 1.47, -1.008, false);
  decL.rotation.y = Math.PI;
  void decR;

  // ---- rear: doors, lamps, bumper, plate, exhaust
  const doors: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(-2.865, 0, s * 0.875);
    body.add(pivot);
    add(pivot, rbox(0.05, 1.96, 0.86, 0.025), paint, 0, 1.46, -s * 0.43);
    add(pivot, rbox(0.02, 0.5, 0.6, 0.02), glass, -0.03, 1.98, -s * 0.46);
    add(pivot, rbox(0.012, 1.9, 0.012, 0.004), trim, -0.028, 1.46, -s * 0.858);
    if (s > 0) add(pivot, rbox(0.04, 0.16, 0.04, 0.01), Mats.chrome(), -0.04, 1.32, -0.76);
    if (s < 0) {
      const pr = add(pivot, new THREE.PlaneGeometry(0.52, 0.13), plateTexture('H31STM'), -0.03, 0.82, 0.43, false);
      pr.rotation.y = -Math.PI / 2;
    }
    doors.push(pivot);
  }
  const tailLamps: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    tailLamps.push(add(body, rbox(0.05, 0.62, 0.1, 0.03), Mats.glow(0xff1a2a, 2.2), -2.875, 1.24, s * 0.95, false));
    add(body, rbox(0.05, 0.14, 0.1, 0.03), Mats.glow(0xffa21a, 1.5), -2.875, 0.86, s * 0.95, false);
    add(body, rbox(0.05, 0.1, 0.1, 0.03), Mats.glow(0xffffff, 1.2), -2.875, 1.62, s * 0.95, false);
  }
  add(body, rbox(0.04, 0.05, 0.5, 0.02), Mats.glow(0xff1a2a, 2.2), -2.84, 2.5, 0, false); // third brake light
  add(body, rbox(0.24, 0.26, 2.06, 0.08), trim, -2.9, 0.5, 0);
  add(body, rbox(0.12, 0.05, 0.9, 0.02), Mats.steelPlain(), -2.98, 0.62, 0);
  const pipe = add(body, cyl(0.045, 0.05, 0.3, 14), Mats.chrome(), -2.82, 0.32, 0.62);
  pipe.rotation.z = Math.PI / 2;
  const exhaust = new THREE.Object3D();
  exhaust.position.set(-3.0, 0.32, 0.62);
  body.add(exhaust);

  // ---- underbody, arch liners, mud flaps
  add(body, rbox(4.9, 0.12, 1.4, 0.04), VMats.under(), 0.0, 0.36, 0, false);
  for (const [x, r] of [
    [1.75, 0.44],
    [-1.55, 0.42],
  ] as const) {
    const liner = add(body, new THREE.CylinderGeometry(r, r, 1.96, 20, 1, true, -Math.PI / 2, Math.PI), VMats.under(), x, 0.37, 0, false);
    liner.rotation.x = Math.PI / 2;
    (liner.material as THREE.Material).side = THREE.DoubleSide;
    for (const s of [-1, 1]) add(body, rbox(0.025, 0.3, 0.26, 0.01), trim, x - 0.52, 0.31, s * 0.86);
  }
  // snow on the roof
  const snow = add(body, fluffySphere(1, 0.06, 5), Mats.snowCap(), -1.05, 2.56, 0);
  snow.scale.set(1.62, 0.1, 0.92);
  const snow2 = add(body, fluffySphere(1, 0.06, 9), Mats.snowCap(), 0.85, 2.56, 0);
  snow2.scale.set(0.32, 0.06, 0.82);

  // ---- getaway driver (seen through the windshield)
  const drv = new THREE.Group();
  drv.position.set(1.12, 1.28, -0.46);
  body.add(drv);
  add(drv, sphere(0.3, 16, 12), Mats.matte(0x7a1620, 0.7), 0, 0.15, 0).scale.set(1, 1.15, 1);
  add(drv, sphere(0.2, 16, 12), Mats.matte(0xe8b48f, 0.6), 0.02, 0.62, 0);
  add(drv, sphere(0.21, 16, 10), Mats.matte(0x1d6b46, 0.8), -0.01, 0.7, 0).scale.set(1, 0.7, 1);
  add(drv, rbox(0.05, 0.06, 0.3, 0.02), Mats.blackGloss(), 0.19, 0.64, 0);
  const wheelRing = add(drv, new THREE.TorusGeometry(0.19, 0.025, 8, 24), trim, 0.38, 0.28, 0);
  wheelRing.rotation.y = Math.PI / 2;
  wheelRing.rotation.x = 0.5;

  // ---- wheels
  const wheels = [
    makeWheel(body.parent!, 1.75, 0.37, 0.25, 0.87, true),
    makeWheel(body.parent!, 1.75, 0.37, 0.25, -0.87, true),
    makeWheel(body.parent!, -1.55, 0.37, 0.25, 0.87, false),
    makeWheel(body.parent!, -1.55, 0.37, 0.25, -0.87, false),
  ];

  // ---- headlight beams
  const beams: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const b = beamCone(9, 0.1, 1.5, 0xfff1d0, 0.12);
    b.position.set(2.9, 1.08, s * 0.72);
    b.rotation.z = -0.06;
    body.add(b);
    beams.push(b);
  }

  const rig: VanRig = { root, body, wheels, headLamps, tailLamps, beams, exhaust, length: 5.8, width: 2.05, doors, interiorLight: lamp, cargo: new THREE.Vector3(-1.6, 0.5, 0) };
  finalize(rig, [...doors, ...headLamps, ...tailLamps, lamp, exhaust]);
  return rig;
}

// =====================================================================
// Police cruiser — North Pole Police
// =====================================================================

export interface PoliceRig extends VehicleRig {
  red: THREE.Mesh[];
  blue: THREE.Mesh[];
}

function policeDoors(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#f4f6fa';
  ctx.beginPath();
  ctx.roundRect(w * 0.02, h * 0.04, w * 0.96, h * 0.9, 26);
  ctx.fill();
  ctx.fillStyle = '#c8162a';
  ctx.fillRect(w * 0.02, h * 0.8, w * 0.96, h * 0.07);
  ctx.fillStyle = '#14213d';
  ctx.font = 'bold 150px "Titan One", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('POLICE', w * 0.55, h * 0.42);
  ctx.font = 'bold 44px Arial, sans-serif';
  ctx.fillText('NORTH POLE · TO PROTECT AND PRESENT', w * 0.55, h * 0.66);
  // star badge
  const cx = w * 0.1;
  const cy = h * 0.42;
  ctx.fillStyle = '#d9a82b';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * TAU;
    const r = i % 2 ? 34 : 78;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

/** Sedan shell shared by the police cruiser and parked civilian cars. */
function sedanShell(body: THREE.Group, paint: THREE.Material) {
  const glass = VMats.glass();
  const p = new THREE.Shape();
  p.moveTo(-2.42, 0.44);
  p.lineTo(-1.89, 0.42);
  p.absarc(-1.45, 0.34, 0.45, Math.PI - 0.18, 0.18, true);
  p.lineTo(0.96, 0.42);
  p.absarc(1.4, 0.34, 0.45, Math.PI - 0.18, 0.18, true);
  p.lineTo(2.28, 0.4);
  p.quadraticCurveTo(2.44, 0.44, 2.46, 0.6);
  p.lineTo(2.47, 0.78);
  p.quadraticCurveTo(2.45, 0.9, 2.28, 0.93);
  p.lineTo(0.95, 1.03);
  p.lineTo(0.28, 1.4);
  p.quadraticCurveTo(0.12, 1.47, -0.2, 1.47);
  p.lineTo(-0.82, 1.46);
  p.lineTo(-1.62, 1.08);
  p.lineTo(-2.3, 1.02);
  p.quadraticCurveTo(-2.46, 0.98, -2.47, 0.84);
  p.closePath();
  const geo = new THREE.ExtrudeGeometry(p, { depth: 1.76, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 4, curveSegments: 16 });
  geo.translate(0, 0, -0.88);
  add(body, geo, paint);
  slopeQuad(body, [0.95, 1.03], [0.28, 1.4], 1.6, 0.06, 0.056, glass);
  slopeQuad(body, [-1.62, 1.08], [-0.82, 1.46], 1.56, 0.06, 0.056, glass);
  const winF: [number, number][] = [
    [-0.08, 1.08],
    [0.86, 1.08],
    [0.28, 1.38],
    [-0.08, 1.42],
  ];
  const winR: [number, number][] = [
    [-1.48, 1.1],
    [-0.16, 1.08],
    [-0.16, 1.42],
    [-0.8, 1.42],
  ];
  for (const z of [0.9405, -0.9405]) {
    sidePoly(body, winF, z, glass);
    sidePoly(body, winR, z, glass);
  }
}

export function buildPoliceCar(unit = 7): PoliceRig {
  const root = new THREE.Group();
  root.name = 'PoliceCar';
  const body = new THREE.Group();
  root.add(body);
  const trim = VMats.trim();
  sedanShell(body, VMats.paint(0x111c33));
  // door decals
  const dec = VMats.decal('police', policeDoors, 1024, 360);
  const dR = add(body, new THREE.PlaneGeometry(2.3, 0.62), dec, -0.25, 0.73, 0.942, false);
  const dL = add(body, new THREE.PlaneGeometry(2.3, 0.62), dec, -0.25, 0.73, -0.942, false);
  dL.rotation.y = Math.PI;
  void dR;
  // lightbar
  add(body, rbox(0.36, 0.08, 1.36, 0.03), trim, -0.28, 1.55, 0);
  const red: THREE.Mesh[] = [];
  const blue: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    red.push(add(body, rbox(0.3, 0.11, 0.2, 0.04), Mats.glow(0xff1a2a, 1), -0.28, 1.63, -0.56 + i * 0.21, false));
    blue.push(add(body, rbox(0.3, 0.11, 0.2, 0.04), Mats.glow(0x2a5bff, 1), -0.28, 1.63, 0.14 + i * 0.21, false));
  }
  // push bar, lamps, plates, mirrors
  for (const s of [-1, 1]) add(body, rbox(0.08, 0.5, 0.08, 0.03), trim, 2.55, 0.66, s * 0.42);
  for (const y of [0.52, 0.84]) add(body, rbox(0.08, 0.07, 1.0, 0.03), trim, 2.6, y, 0);
  const headLamps: THREE.Mesh[] = [];
  const tailLamps: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    headLamps.push(add(body, rbox(0.06, 0.12, 0.42, 0.04), Mats.glow(0xfff4dc, 3.5), 2.44, 0.8, s * 0.62, false));
    tailLamps.push(add(body, rbox(0.05, 0.12, 0.42, 0.04), Mats.glow(0xff1a2a, 2), -2.49, 0.86, s * 0.6, false));
    add(body, rbox(0.12, 0.16, 0.09, 0.03), trim, 0.82, 1.08, s * 1.0);
    add(body, rbox(0.14, 0.035, 0.03, 0.01), Mats.chrome(), 0.3, 0.92, s * 0.952);
    add(body, rbox(0.14, 0.035, 0.03, 0.01), Mats.chrome(), -0.62, 0.92, s * 0.952);
  }
  add(body, rbox(0.2, 0.24, 1.9, 0.08), trim, 2.38, 0.5, 0);
  add(body, rbox(0.2, 0.22, 1.9, 0.08), trim, -2.4, 0.52, 0);
  const plate = add(body, new THREE.PlaneGeometry(0.5, 0.12), plateTexture(`NPP-${unit}0${unit}`), -2.505, 0.62, 0, false);
  plate.rotation.y = -Math.PI / 2;
  const spot = add(body, cyl(0.06, 0.07, 0.14, 12), Mats.chrome(), 0.88, 1.12, -0.98);
  spot.rotation.z = Math.PI / 2;
  add(body, cyl(0.006, 0.006, 0.7, 6), trim, -1.9, 1.38, 0.5);
  add(body, rbox(4.3, 0.1, 1.3, 0.04), VMats.under(), 0, 0.32, 0, false);
  const snow = add(body, fluffySphere(1, 0.05, 3), Mats.snowCap(), -0.15, 1.5, 0);
  snow.scale.set(0.55, 0.05, 0.7);
  const wheels = [
    makeWheel(root, 1.4, 0.34, 0.24, 0.8, true, true),
    makeWheel(root, 1.4, 0.34, 0.24, -0.8, true, true),
    makeWheel(root, -1.45, 0.34, 0.24, 0.8, false, true),
    makeWheel(root, -1.45, 0.34, 0.24, -0.8, false, true),
  ];
  const beams: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const b = beamCone(7, 0.08, 1.2, 0xfff1d0, 0.1);
    b.position.set(2.5, 0.8, s * 0.62);
    b.rotation.z = -0.07;
    body.add(b);
    beams.push(b);
  }
  const rig: PoliceRig = { root, body, wheels, headLamps, tailLamps, beams, exhaust: null, length: 4.95, width: 1.9, red, blue };
  finalize(rig, [...red, ...blue, ...headLamps, ...tailLamps]);
  return rig;
}

/** Strobe pattern for a lightbar (call every frame). */
export function strobe(rig: PoliceRig, t: number, on = true) {
  const ph = (t * 2.2) % 1;
  const left = on && ((ph < 0.5 && Math.floor(t * 18) % 3 !== 2) || (ph > 0.9 && Math.floor(t * 30) % 2 === 0));
  const right = on && ((ph >= 0.5 && Math.floor(t * 18) % 3 !== 2) || (ph < 0.1 && Math.floor(t * 30) % 2 === 0));
  for (const m of rig.red) m.material = left ? Mats.glow(0xff1a2a, 9) : Mats.glow(0x3a0a0e, 1);
  for (const m of rig.blue) m.material = right ? Mats.glow(0x2a5bff, 10) : Mats.glow(0x0a1430, 1);
  return left ? 1 : right ? -1 : 0;
}

/** Parked civilian car (static: bake it into the level batch). */
export function buildSedan(color: number, seed = 1): THREE.Group {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  sedanShell(body, VMats.paint(color));
  const trim = VMats.trim();
  for (const s of [-1, 1]) {
    add(body, rbox(0.06, 0.12, 0.42, 0.04), Mats.glow(0x9a9480, 1), 2.44, 0.8, s * 0.62, false);
    add(body, rbox(0.05, 0.12, 0.42, 0.04), Mats.glow(0x5a0a10, 1), -2.49, 0.86, s * 0.6, false);
    add(body, rbox(0.12, 0.16, 0.09, 0.03), trim, 0.82, 1.08, s * 1.0);
  }
  add(body, rbox(0.2, 0.24, 1.9, 0.08), trim, 2.38, 0.5, 0);
  add(body, rbox(0.2, 0.22, 1.9, 0.08), trim, -2.4, 0.52, 0);
  add(body, rbox(4.3, 0.1, 1.3, 0.04), VMats.under(), 0, 0.32, 0, false);
  // heavy snow on a car that hasn't moved all night
  const snow = add(body, fluffySphere(1, 0.07, seed), Mats.snowCap(), -0.2, 1.48, 0);
  snow.scale.set(0.75, 0.16, 0.85);
  const hood = add(body, fluffySphere(1, 0.06, seed + 3), Mats.snowCap(), 1.6, 1.0, 0);
  hood.scale.set(0.75, 0.08, 0.85);
  const trunk = add(body, fluffySphere(1, 0.06, seed + 5), Mats.snowCap(), -1.95, 1.04, 0);
  trunk.scale.set(0.45, 0.07, 0.85);
  makeWheel(root, 1.4, 0.34, 0.24, 0.8, true);
  makeWheel(root, 1.4, 0.34, 0.24, -0.8, true);
  makeWheel(root, -1.45, 0.34, 0.24, 0.8, false);
  makeWheel(root, -1.45, 0.34, 0.24, -0.8, false);
  return root;
}

// =====================================================================
// Snowplow / salt truck
// =====================================================================

export interface PlowRig extends VehicleRig {
  beacon: THREE.Group;
  blade: THREE.Object3D;
}

export function buildPlowTruck(color = 0xf07f12): PlowRig {
  const root = new THREE.Group();
  root.name = 'PlowTruck';
  const body = new THREE.Group();
  root.add(body);
  const paint = VMats.paint(color);
  const trim = VMats.trim();
  const glass = VMats.glass();
  // chassis + cab-over cab
  add(body, rbox(6.9, 0.36, 1.05, 0.05), trim, -0.2, 0.98, 0);
  add(body, rbox(1.95, 2.05, 2.36, 0.16), paint, 2.05, 2.1, 0);
  add(body, rbox(0.05, 0.9, 2.0, 0.04), glass, 3.03, 2.5, 0);
  for (const s of [-1, 1]) add(body, rbox(0.95, 0.75, 0.04, 0.03), glass, 2.25, 2.52, s * 1.18);
  add(body, rbox(0.1, 0.42, 2.1, 0.04), trim, 3.06, 1.5, 0);
  for (const y of [1.38, 1.5, 1.62]) add(body, rbox(0.04, 0.04, 1.6, 0.01), Mats.chrome(), 3.12, y, 0);
  add(body, rbox(0.3, 0.3, 2.4, 0.08), trim, 3.05, 1.05, 0);
  const headLamps: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    headLamps.push(add(body, rbox(0.05, 0.16, 0.3, 0.04), Mats.glow(0xfff4dc, 4), 3.09, 1.32, s * 0.88, false));
    add(body, rbox(0.12, 0.3, 0.06, 0.03), trim, 2.6, 2.6, s * 1.32);
    add(body, rbox(0.06, 0.06, 0.24, 0.02), trim, 2.6, 2.6, s * 1.2);
  }
  // roof light bar + beacon
  add(body, rbox(0.3, 0.1, 1.6, 0.03), trim, 2.0, 3.18, 0);
  const beacon = new THREE.Group();
  beacon.position.set(2.0, 3.32, 0);
  body.add(beacon);
  add(beacon, cyl(0.16, 0.18, 0.2, 16), Mats.glow(0xff9a1a, 3.5), 0, 0, 0, false);
  add(beacon, rbox(0.06, 0.16, 0.34, 0.02), Mats.glow(0xffd27a, 9), 0.12, 0, 0, false);
  // dump body with salt load
  add(body, rbox(3.9, 1.35, 2.4, 0.08), paint, -1.35, 1.88, 0);
  add(body, rbox(3.7, 0.12, 2.2, 0.04), Mats.matte(0x6a6e78, 0.95), -1.35, 2.5, 0);
  const salt = add(body, fluffySphere(1, 0.08, 4), Mats.snowCap(), -1.35, 2.52, 0);
  salt.scale.set(1.7, 0.32, 1.0);
  add(body, rbox(0.4, 0.5, 0.5, 0.06), trim, -3.45, 1.15, 0); // spinner
  const stack = add(body, cyl(0.08, 0.08, 1.4, 12), Mats.chrome(), 0.95, 3.0, -1.0);
  void stack;
  add(body, cyl(0.28, 0.28, 0.8, 16), Mats.steelPlain(), 0.6, 1.0, 0.82).rotation.x = Math.PI / 2;
  // hazard chevrons on the back
  add(body, rbox(0.04, 0.6, 2.2, 0.02), Mats.hazard(2, 1), -3.33, 1.7, 0);
  const tailLamps: THREE.Mesh[] = [];
  for (const s of [-1, 1]) tailLamps.push(add(body, rbox(0.05, 0.16, 0.2, 0.03), Mats.glow(0xff1a2a, 2.2), -3.36, 1.3, s * 1.0, false));
  // plow blade (curved moldboard) on a frame
  add(body, rbox(0.7, 0.18, 1.2, 0.04), trim, 3.45, 0.8, 0);
  const blade = new THREE.Group();
  blade.position.set(4.35, 0.87, 0);
  blade.rotation.y = 0.32;
  body.add(blade);
  const mold = new THREE.CylinderGeometry(1.0, 1.0, 3.7, 20, 1, true, -0.85, 1.7);
  mold.rotateX(Math.PI / 2);
  mold.rotateZ(-Math.PI / 2);
  add(blade, mold, VMats.yellow());
  add(blade, rbox(0.1, 0.12, 3.72, 0.03), Mats.steelPlain(), -0.62, -0.76, 0);
  add(blade, rbox(0.06, 0.3, 3.7, 0.02), Mats.hazard(4, 1), -0.68, 0.72, 0);
  const wheels = [
    makeWheel(root, 2.2, 0.55, 0.36, 1.0, true, true),
    makeWheel(root, 2.2, 0.55, 0.36, -1.0, true, true),
    makeWheel(root, -1.0, 0.55, 0.32, 0.86, false, true, true),
    makeWheel(root, -1.0, 0.55, 0.32, -0.86, false, true, true),
    makeWheel(root, -2.3, 0.55, 0.32, 0.86, false, true, true),
    makeWheel(root, -2.3, 0.55, 0.32, -0.86, false, true, true),
  ];
  const beams: THREE.Mesh[] = [];
  const rig: PlowRig = { root, body, wheels, headLamps, tailLamps, beams, exhaust: null, length: 8.4, width: 2.5, beacon, blade };
  finalize(rig, [beacon, ...headLamps, ...tailLamps]);
  return rig;
}

// =====================================================================
// Police helicopter
// =====================================================================

export interface HeliRig {
  root: THREE.Group;
  rotor: THREE.Group;
  tailRotor: THREE.Group;
  /** Searchlight lamp (beam origin). */
  lamp: THREE.Object3D;
  beacons: THREE.Mesh[];
}

export function buildHelicopter(): HeliRig {
  const root = new THREE.Group();
  root.name = 'Helicopter';
  const paint = VMats.paint(0x121d36);
  const white = VMats.paint(0xe9edf3);
  const trim = VMats.trim();
  const glass = VMats.glass();
  const cabin = add(root, sphere(1, 28, 18), paint, 0, 0, 0);
  cabin.scale.set(2.3, 1.25, 1.2);
  const canopy = add(root, sphere(1, 28, 18, ), glass, 0.75, 0.12, 0);
  canopy.scale.set(1.55, 1.05, 1.08);
  const stripe = add(root, sphere(1, 28, 10), white, -0.2, -0.32, 0);
  stripe.scale.set(2.25, 0.5, 1.21);
  // tail boom + fin + stabilizer
  const boom = add(root, cyl(0.22, 0.42, 4.6, 16), paint, -3.9, 0.35, 0);
  boom.rotation.z = Math.PI / 2;
  add(root, rbox(0.9, 1.3, 0.08, 0.05), paint, -6.1, 0.95, 0);
  add(root, rbox(0.6, 0.06, 1.6, 0.03), white, -5.7, 0.4, 0);
  // skids
  for (const s of [-1, 1]) {
    add(root, rbox(3.2, 0.08, 0.08, 0.04), trim, 0.1, -1.55, s * 0.95);
    for (const x of [-0.8, 0.9]) {
      const strut = add(root, rbox(0.06, 0.5, 0.06, 0.02), trim, x, -1.28, s * 0.8);
      strut.rotation.x = s * 0.35;
    }
  }
  // rotor mast + blades
  add(root, cyl(0.16, 0.22, 0.5, 12), trim, -0.1, 1.35, 0);
  const rotor = new THREE.Group();
  rotor.position.set(-0.1, 1.62, 0);
  root.add(rotor);
  for (let i = 0; i < 4; i++) {
    const b = add(rotor, rbox(5.6, 0.04, 0.32, 0.02), trim, 0, 0, 0);
    b.geometry.translate(2.8, 0, 0);
    b.rotation.y = (i / 4) * TAU;
  }
  add(rotor, cyl(0.24, 0.24, 0.16, 12), Mats.chrome());
  const blur = add(rotor, new THREE.CircleGeometry(5.6, 40), new THREE.MeshBasicMaterial({ color: 0x0a0d14, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }), 0, 0.03, 0, false);
  blur.rotation.x = -Math.PI / 2;
  const tailRotor = new THREE.Group();
  tailRotor.position.set(-6.2, 1.05, 0.12);
  root.add(tailRotor);
  for (let i = 0; i < 2; i++) {
    const b = add(tailRotor, rbox(0.06, 1.3, 0.02, 0.01), trim);
    b.rotation.z = (i / 2) * Math.PI;
  }
  // searchlight under the nose
  const lampG = new THREE.Group();
  lampG.position.set(1.65, -0.95, 0.45);
  root.add(lampG);
  add(lampG, cyl(0.2, 0.24, 0.4, 16), Mats.chrome()).rotation.z = Math.PI / 2;
  add(lampG, cyl(0.19, 0.19, 0.03, 16), Mats.glow(0xf4f7ff, 10), 0.21, 0, 0, false).rotation.z = Math.PI / 2;
  const beacons = [
    add(root, sphere(0.08, 10, 8), Mats.glow(0xff2233, 6), 0.3, -0.2, -1.2, false),
    add(root, sphere(0.08, 10, 8), Mats.glow(0x22ff66, 6), 0.3, -0.2, 1.2, false),
    add(root, sphere(0.1, 10, 8), Mats.glow(0xff2233, 8), -0.2, 1.3, 0, false),
  ];
  const statics: THREE.Mesh[] = [];
  for (const c of root.children) {
    const m = c as THREE.Mesh;
    if (m.isMesh && !beacons.includes(m as THREE.Mesh<THREE.BufferGeometry, THREE.Material>) && !(m.material as THREE.Material).transparent) statics.push(m);
  }
  mergeMeshes(root, statics);
  return { root, rotor, tailRotor, lamp: lampG, beacons };
}

/** Radial glow decal used for the searchlight spot and headlight pools. */
export function glowDecal(size: number, color: number, opacity = 1) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: TextureLib.radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
      color: new THREE.Color(color).multiplyScalar(opacity),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -6,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.userData.noAO = true;
  m.renderOrder = 3;
  return m;
}

export { beamCone };
