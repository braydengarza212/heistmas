import * as THREE from 'three';
import {
  capsule,
  cone,
  cyl,
  fluff,
  fluffySphere,
  fluffyTorus,
  rbox,
  smoothIco,
  smoothLathe,
  sphere,
  star3D,
  taperedTube,
  torus,
} from '../gfx/geom';
import { TextureLib } from '../gfx/textures';
import { Mats } from '../gfx/materials';
import { HATS, MASKS, SACKS, SKINS, type HatKind, type Outfit, type SkinStyle } from './outfits';
import { Spring, clamp, damp, lerp, noise1, smoothstep } from '../core/math';

export type BeanState =
  | 'idle'
  | 'run'
  | 'air'
  | 'dive'
  | 'slide'
  | 'knocked'
  | 'getup'
  | 'interact'
  | 'celebrate'
  | 'caught'
  | 'hang'
  | 'menu';

export type Expression = 'normal' | 'happy' | 'dizzy' | 'surprised' | 'determined';

export interface BeanAnimInput {
  state: BeanState;
  speed: number;
  maxSpeed: number;
  vy: number;
  turnRate: number;
  sprinting: boolean;
  /** forward acceleration in m/s² (for sack swing) */
  accel: number;
}

// Bean silhouette: [radius, height] from the soles up.
export const PROFILE: [number, number][] = [
  [0.0, 0.14],
  [0.24, 0.155],
  [0.38, 0.21],
  [0.465, 0.31],
  [0.505, 0.46],
  [0.51, 0.62],
  [0.5, 0.8],
  [0.47, 0.98],
  [0.42, 1.14],
  [0.345, 1.28],
  [0.245, 1.39],
  [0.12, 1.46],
  [0.0, 1.49],
];

const SAMPLED = (() => {
  const curve = new THREE.SplineCurve(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)));
  return curve.getPoints(240);
})();

/** Body radius at a given height (used to fit accessories to the surface). */
export function radiusAt(y: number) {
  for (let i = 1; i < SAMPLED.length; i++) {
    const a = SAMPLED[i - 1];
    const b = SAMPLED[i];
    if ((y >= a.y && y <= b.y) || (y <= a.y && y >= b.y)) {
      const t = (y - a.y) / (b.y - a.y || 1);
      return lerp(a.x, b.x, t);
    }
  }
  return 0;
}

/** Point on the body surface at height y and azimuth theta (0 = facing +Z). */
function surface(y: number, theta: number, out = 0) {
  const r = radiusAt(y) + out;
  return new THREE.Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r);
}

const PIVOT_Y = 0.78;

function bodyMaterial(style: SkinStyle) {
  const common = { vertexColors: true } as const;
  switch (style.finish) {
    case 'gold':
      return new THREE.MeshPhysicalMaterial({
        ...common,
        metalness: 0.95,
        roughness: 0.22,
        clearcoat: 0.6,
        clearcoatRoughness: 0.1,
      });
    case 'fur':
      return new THREE.MeshPhysicalMaterial({
        ...common,
        roughness: 0.85,
        sheen: 1,
        sheenColor: new THREE.Color(0xd8ffb0),
        sheenRoughness: 0.5,
      });
    case 'snow':
      return new THREE.MeshPhysicalMaterial({
        ...common,
        roughness: 0.55,
        sheen: 0.8,
        sheenColor: new THREE.Color(0xbfe0ff),
        clearcoat: 0.25,
        clearcoatRoughness: 0.4,
      });
    case 'satin':
      return new THREE.MeshPhysicalMaterial({
        ...common,
        roughness: 0.38,
        clearcoat: 0.7,
        clearcoatRoughness: 0.18,
        sheen: 0.35,
        sheenColor: new THREE.Color(0xffffff),
      });
    default:
      return new THREE.MeshPhysicalMaterial({
        ...common,
        roughness: 0.5,
        clearcoat: 0.35,
        clearcoatRoughness: 0.3,
        sheen: 0.7,
        sheenColor: new THREE.Color(0xff6a5a),
        sheenRoughness: 0.4,
      });
  }
}

function buildBodyGeometry(style: SkinStyle) {
  const geo = smoothLathe(PROFILE, 72, 72);
  if (style.finish === 'fur') fluff(geo, 0.006, 70, 3);
  if (style.finish === 'snow') fluff(geo, 0.004, 40, 5);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const suit = new THREE.Color(style.body);
  const face = new THREE.Color(style.face);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const theta = Math.atan2(x, z);
    const dy = (y - 1.07) / 0.3;
    const dt = theta / 1.05;
    const d = dt * dt + dy * dy;
    const w = 1 - smoothstep(0.86, 1.0, d);
    c.copy(suit).lerp(face, w);
    // Subtle vertical gradient makes the toy-like body read rounder.
    const shade = 0.88 + 0.12 * smoothstep(0.1, 1.2, y);
    colors[i * 3] = c.r * shade;
    colors[i * 3 + 1] = c.g * shade;
    colors[i * 3 + 2] = c.b * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

interface Eye {
  group: THREE.Group;
  open: THREE.Group;
  pupil: THREE.Mesh;
  happy: THREE.Mesh;
  dizzy: THREE.Group;
}

export class Bean {
  readonly root = new THREE.Group();
  /** Body-center pivot: leaning, diving, tumbling. */
  readonly pivot = new THREE.Group();
  private body = new THREE.Group();
  private legs = new THREE.Group();
  private outfitGroup = new THREE.Group();
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private eyes: Eye[] = [];
  private brows: THREE.Mesh[] = [];
  private mouth!: THREE.Mesh;
  private hatPivot = new THREE.Group();
  private hatTip: THREE.Object3D | null = null;
  private tails: THREE.Group[] = [];
  private sackPivot = new THREE.Group();
  private sackScale = new THREE.Group();
  private sackGoodies = new THREE.Group();

  outfit: Outfit;
  style!: SkinStyle;
  expression: Expression = 'normal';
  /** Overrides expression for a short time (e.g. surprised on hit). */
  private exprTimer = 0;
  private exprOverride: Expression | null = null;

  private t = Math.random() * 10;
  private phase = 0;
  private blinkTimer = 2;
  private blink = 0;
  private squash = new Spring(1, 320, 13);
  private leanPitch = 0;
  private leanRoll = 0;
  private divePitch = new Spring(0, 140, 16);
  private hatSwingX = new Spring(0, 70, 6);
  private hatSwingZ = new Spring(0, 70, 6);
  private sackSwing = new Spring(0, 50, 5);
  private sackSwingZ = new Spring(0, 50, 5);
  private sackPop = new Spring(0, 220, 9);
  private sackFill = 0;
  private sackFillShown = 0;
  private lookX = 0;
  private lookY = 0;
  private lookTimer = 0;
  private lookTarget = new THREE.Vector2();
  private flail = 0;
  /** world-space eye target (menu: look at the camera) */
  lookAtWorld: THREE.Vector3 | null = null;
  private prevState: BeanState = 'idle';

  constructor(outfit: Outfit) {
    this.outfit = { ...outfit };
    this.root.add(this.pivot);
    this.pivot.position.y = PIVOT_Y;
    this.pivot.add(this.body);
    this.pivot.add(this.legs);
    this.body.position.y = -PIVOT_Y;
    this.legs.position.y = -PIVOT_Y;
    this.body.add(this.outfitGroup);
    this.build();
  }

  // ------------------------------------------------------------- building
  setOutfit(outfit: Outfit) {
    this.outfit = { ...outfit };
    this.build();
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, cast = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  private mat(hex: number, opts: THREE.MeshPhysicalMaterialParameters = {}) {
    return this.track(
      new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.25, ...opts }),
    );
  }

  private fur(hex: number) {
    return this.track(
      new THREE.MeshPhysicalMaterial({
        color: hex,
        roughness: 0.85,
        sheen: 0.5,
        sheenColor: new THREE.Color(0xeeeeff),
        sheenRoughness: 0.6,
      }),
    );
  }

  private clear() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    const groups = [this.outfitGroup, this.legL, this.legR, this.armL, this.armR, this.hatPivot, this.sackPivot];
    for (const g of groups) g.clear();
    this.sackScale.clear();
    this.sackGoodies.clear();
    this.eyes = [];
    this.brows = [];
    this.tails = [];
    this.hatTip = null;
  }

  private build() {
    this.clear();
    const style = (this.style = SKINS[this.outfit.skin] ?? SKINS['skin.criminal']);
    const maskStyle = MASKS[this.outfit.mask] ?? MASKS['mask.bandit'];
    const g = this.outfitGroup;

    // --- body
    const bodyGeo = this.track(buildBodyGeometry(style));
    const bodyMat = this.track(bodyMaterial(style));
    this.mesh(bodyGeo, bodyMat, g);

    const trimMat = style.fluffyTrim ? this.fur(style.trim) : this.mat(style.trim, { roughness: 0.45 });
    // hem trim
    const hemY = 0.24;
    const hem = this.mesh(this.track(fluff(new THREE.TorusGeometry(radiusAt(hemY) + 0.008, style.fluffyTrim ? 0.06 : 0.035, 12, 56), style.fluffyTrim ? 0.012 : 0, 40, 2)), trimMat, g);
    hem.rotation.x = Math.PI / 2;
    hem.position.y = hemY;

    if (style.frontPlacket) {
      const pl = this.mesh(this.track(fluff(new THREE.CapsuleGeometry(0.07, 0.17, 6, 12), 0.01, 40, 7)), trimMat, g);
      const p = surface(0.4, 0, -0.01);
      pl.position.copy(p);
      pl.scale.set(0.9, 1, 0.45);
      pl.rotation.x = -0.12;
    }

    if (style.belt) {
      const beltMat = this.mat(style.beltColor, { roughness: 0.3, clearcoat: 1 });
      const y0 = 0.5;
      const y1 = 0.63;
      const pts = [
        new THREE.Vector2(radiusAt(y0) - 0.005, y0 - 0.005),
        new THREE.Vector2(radiusAt(y0) + 0.02, y0),
        new THREE.Vector2(radiusAt(y1) + 0.02, y1),
        new THREE.Vector2(radiusAt(y1) - 0.005, y1 + 0.005),
      ];
      this.mesh(this.track(new THREE.LatheGeometry(pts, 64)), beltMat, g);
      const buckleMat = this.mat(style.buckle, { metalness: 1, roughness: 0.2, clearcoat: 0 });
      const buckle = this.mesh(rbox(0.21, 0.16, 0.05, 0.02), buckleMat, g);
      buckle.position.copy(surface(0.565, 0, 0.035));
      const hole = this.mesh(rbox(0.11, 0.07, 0.03, 0.01), beltMat, g);
      hole.position.copy(surface(0.565, 0, 0.055));
    }

    if (style.coalButtons) {
      const coal = this.mat(0x1a1a1f, { roughness: 0.7 });
      for (const y of [0.36, 0.55, 0.74]) {
        const b = this.mesh(sphere(0.045, 12, 10), coal, g);
        b.position.copy(surface(y, 0, 0.012));
      }
    }

    // --- face
    this.buildFace(style, maskStyle);

    // --- scarf
    if (style.scarf) {
      const [a, b] = style.scarf;
      const scarfMat = this.mat(a, { roughness: 0.8, sheen: 1, sheenColor: new THREE.Color(b), clearcoat: 0 });
      const sc = this.mesh(this.track(new THREE.TorusGeometry(radiusAt(0.9) + 0.035, 0.065, 12, 48)), scarfMat, g);
      sc.rotation.x = Math.PI / 2;
      sc.position.y = 0.9;
      sc.scale.z = 1.2;
      const end = this.mesh(rbox(0.16, 0.36, 0.06, 0.03), this.mat(b, { roughness: 0.8, sheen: 1, clearcoat: 0 }), g);
      end.position.copy(surface(0.74, 0.55, 0.06));
      end.rotation.set(0.1, 0.55, -0.15);
    }

    // --- arms
    for (const side of [-1, 1]) {
      const arm = side < 0 ? this.armL : this.armR;
      arm.position.set(side * 0.46, 0.86, 0.02);
      g.add(arm);
      const sleeve = this.mesh(capsule(0.092, 0.16, 6, 12), bodyMat, arm);
      sleeve.position.y = -0.15;
      // fake vertex colors for the sleeve geometry (needs a color attribute)
      if (!sleeve.geometry.attributes.color) {
        const sg = this.track(sleeve.geometry.clone());
        const cnt = sg.attributes.position.count;
        const col = new Float32Array(cnt * 3);
        const cc = new THREE.Color(style.body);
        for (let i = 0; i < cnt; i++) {
          col[i * 3] = cc.r;
          col[i * 3 + 1] = cc.g;
          col[i * 3 + 2] = cc.b;
        }
        sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
        sleeve.geometry = sg;
      }
      const cuff = this.mesh(style.fluffyTrim ? fluffyTorus(0.085, 0.042, 0.01, 4) : torus(0.088, 0.03, 10, 24), trimMat, arm);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.26;
      const glove = this.mesh(sphere(0.105, 20, 14), this.mat(style.gloves, { roughness: 0.35, clearcoat: 0.8 }), arm);
      glove.position.y = -0.35;
      glove.scale.set(1, 0.92, 1);
      const thumb = this.mesh(sphere(0.045, 12, 8), glove.material as THREE.Material, arm);
      thumb.position.set(-side * 0.06, -0.31, 0.07);
    }

    // --- legs
    for (const side of [-1, 1]) {
      const leg = side < 0 ? this.legL : this.legR;
      leg.position.set(side * 0.19, 0.21, 0);
      this.legs.add(leg);
      this.mesh(capsule(0.085, 0.05, 6, 10), this.mat(style.pants, { roughness: 0.6 }), leg).position.y = -0.04;
      const boot = this.mesh(sphere(0.13, 20, 14), this.mat(style.boots, { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }), leg);
      boot.position.set(0, -0.125, 0.04);
      boot.scale.set(1.0, 0.72, 1.35);
      if (style.fluffyTrim) {
        const bc = this.mesh(fluffyTorus(0.085, 0.035, 0.008, 6), trimMat, leg);
        bc.rotation.x = Math.PI / 2;
        bc.position.y = -0.04;
      }
    }

    // --- hat
    let hatKind: HatKind = style.defaultHat;
    const hatDef = HATS[this.outfit.hat];
    if (hatDef && hatDef.kind !== 'auto') hatKind = hatDef.kind;
    this.hatPivot.position.set(0, 1.31, -0.01);
    g.add(this.hatPivot);
    this.buildHat(hatKind, style);

    // --- sack
    this.buildSack();
  }

  private buildFace(style: SkinStyle, mask: (typeof MASKS)[string]) {
    const g = this.outfitGroup;
    // mask band
    const y0 = 0.99;
    const y1 = 1.2;
    const bandPts = [
      new THREE.Vector2(radiusAt(y0) - 0.006, y0 - 0.006),
      new THREE.Vector2(radiusAt(y0) + 0.026, y0 + 0.004),
      new THREE.Vector2(radiusAt((y0 + y1) / 2) + 0.03, (y0 + y1) / 2),
      new THREE.Vector2(radiusAt(y1) + 0.026, y1 - 0.004),
      new THREE.Vector2(radiusAt(y1) - 0.006, y1 + 0.006),
    ];
    let maskMat: THREE.Material;
    if (mask.stripe !== undefined && !(mask.color === 0xf7f2ea && mask.stripe === 0xd31f2b)) {
      const t = stripeTexture(mask.color, mask.stripe);
      maskMat = this.track(new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.25, clearcoat: 1 }));
    } else if (mask.stripe !== undefined) {
      const t = TextureLib.candyStripe().clone();
      t.repeat.set(10, 1);
      t.needsUpdate = true;
      maskMat = this.track(new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.25, clearcoat: 1 }));
    } else if (mask.metallic) {
      maskMat = this.track(new THREE.MeshPhysicalMaterial({ color: mask.color, metalness: 1, roughness: 0.18 }));
    } else if (mask.starry) {
      maskMat = this.track(
        new THREE.MeshPhysicalMaterial({ color: mask.color, roughness: 0.3, clearcoat: 1, sheen: 1, sheenColor: new THREE.Color(0x8fa6ff) }),
      );
    } else {
      maskMat = this.track(new THREE.MeshPhysicalMaterial({ color: mask.color, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 }));
    }
    this.mesh(this.track(new THREE.LatheGeometry(new THREE.SplineCurve(bandPts).getPoints(16), 72)), maskMat, g);
    if (mask.starry) {
      const starMat = Mats.glow(0xfff1b0, 2.2);
      for (let i = 0; i < 9; i++) {
        const th = Math.PI + (i - 4) * 0.42;
        if (Math.abs(Math.atan2(Math.sin(th), Math.cos(th))) < 0.55) continue;
        const s = this.mesh(star3D(0.022, 0.009, 0.004), starMat, g, false);
        s.position.copy(surface(1.06 + (i % 3) * 0.05, th, 0.032));
        s.lookAt(s.position.clone().multiplyScalar(2).setY(s.position.y));
      }
    }
    // knot + tails at the back of the head
    const knot = this.mesh(sphere(0.06, 14, 10), maskMat, g);
    knot.position.copy(surface(1.1, Math.PI, 0.03));
    for (const side of [-1, 1]) {
      const tail = new THREE.Group();
      tail.position.copy(surface(1.1, Math.PI + side * 0.08, 0.04));
      g.add(tail);
      const tm = this.mesh(rbox(0.07, 0.24, 0.025, 0.012), maskMat, tail);
      tm.position.y = -0.11;
      tail.rotation.set(0.35, side * 0.25, side * 0.35);
      this.tails.push(tail);
    }

    // eyes
    const white = this.track(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1 }));
    const black = this.track(new THREE.MeshPhysicalMaterial({ color: 0x0b0b10, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }));
    const shine = Mats.glow(0xffffff, 1.6);
    for (const side of [-1, 1]) {
      const theta = side * 0.3;
      const group = new THREE.Group();
      group.position.copy(surface(1.095, theta, 0.03));
      group.rotation.y = theta;
      g.add(group);
      const open = new THREE.Group();
      group.add(open);
      const sclera = this.mesh(sphere(0.085, 24, 16), white, open, false);
      sclera.scale.set(1, 1.22, 0.45);
      const pupil = this.mesh(sphere(0.05, 18, 12), black, open, false);
      pupil.position.z = 0.03;
      pupil.scale.set(1, 1.15, 0.55);
      const hl = this.mesh(sphere(0.016, 8, 6), shine, pupil, false);
      hl.position.set(0.018, 0.02, 0.035);
      const happy = this.mesh(torus(0.05, 0.017, 8, 18, Math.PI), white, group, false);
      happy.position.set(0, -0.01, 0.02);
      happy.visible = false;
      const dizzy = new THREE.Group();
      for (const r of [0.785, -0.785]) {
        const bar = this.mesh(capsule(0.014, 0.1, 4, 8), white, dizzy, false);
        bar.rotation.z = r;
      }
      dizzy.position.z = 0.025;
      dizzy.visible = false;
      group.add(dizzy);
      this.eyes.push({ group, open, pupil, happy, dizzy });

      const brow = this.mesh(capsule(0.024, 0.09, 4, 8), this.mat(style.brows, { roughness: 0.7, clearcoat: 0 }), g);
      brow.position.copy(surface(1.235, side * 0.3, 0.035));
      brow.rotation.set(0, theta, Math.PI / 2 + side * 0.12);
      this.brows.push(brow);
    }

    // nose
    if (style.carrotNose) {
      const n = this.mesh(cone(0.05, 0.26, 16), this.mat(style.nose, { roughness: 0.5 }), g);
      n.position.copy(surface(1.0, 0, 0.11));
      n.rotation.x = Math.PI / 2;
    } else {
      const n = this.mesh(sphere(0.058, 16, 12), this.mat(style.nose, { roughness: 0.35, clearcoat: 0.6 }), g);
      n.position.copy(surface(0.985, 0, 0.035));
    }

    if (style.elfEars) {
      const earMat = this.mat(style.face, { roughness: 0.5 });
      for (const side of [-1, 1]) {
        const ear = this.mesh(cone(0.07, 0.24, 12), earMat, g);
        ear.position.copy(surface(1.08, side * 1.5, 0.05));
        ear.rotation.set(0, 0, -side * 1.15);
        ear.scale.set(1, 1, 0.55);
      }
    }

    // mouth (visible when surprised / scared)
    this.mouth = this.mesh(sphere(0.045, 14, 10), black, g, false);
    this.mouth.position.copy(surface(0.86, 0, 0.012));
    this.mouth.scale.set(1, 1.2, 0.4);
    this.mouth.visible = !style.beard;

    // beard + mustache
    if (style.beard) {
      const beardMat = this.fur(style.beardColor);
      const geos: THREE.BufferGeometry[] = [];
      const add = (y: number, th: number, r: number, out: number) => {
        const s = smoothIco(r, 2);
        const p = surface(y, th, out);
        s.translate(p.x, p.y, p.z);
        geos.push(s);
      };
      const N = 11;
      for (let i = 0; i < N; i++) {
        const k = i / (N - 1) - 0.5;
        const th = k * 1.75;
        const y = 0.63 + 0.34 * Math.pow(Math.abs(k * 2), 1.8);
        add(y, th, 0.115 - Math.abs(k) * 0.04, 0.02);
      }
      for (let i = 0; i < 6; i++) {
        const k = i / 5 - 0.5;
        add(0.78 + Math.abs(k) * 0.12, k * 1.1, 0.1, 0.035);
      }
      add(0.66, 0, 0.12, 0.05);
      const merged = this.track(mergeAll(geos));
      fluff(merged, 0.012, 30, 9);
      this.mesh(merged, beardMat, g);
      // handlebar mustache
      for (const side of [-1, 1]) {
        const curve = new THREE.CubicBezierCurve3(
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(side * 0.09, -0.045, 0.0),
          new THREE.Vector3(side * 0.19, -0.01, -0.04),
          new THREE.Vector3(side * 0.2, 0.06, -0.07),
        );
        const m = this.mesh(this.track(taperedTube(curve, 0.05, 0.016, 24, 12)), beardMat, g);
        m.position.copy(surface(0.93, 0, 0.045));
      }
    }
  }

  private buildHat(kind: HatKind, style: SkinStyle) {
    const hp = this.hatPivot;
    const trim = this.fur(style.hatTrim);
    if (kind === 'santa') {
      const mat = this.track(
        new THREE.MeshPhysicalMaterial({
          color: style.hatColor,
          roughness: style.finish === 'gold' ? 0.25 : 0.55,
          metalness: style.finish === 'gold' ? 0.9 : 0,
          sheen: 0.9,
          sheenColor: new THREE.Color(0xffa0a0),
        }),
      );
      const curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.3, 0.02),
        new THREE.Vector3(0.02, 0.5, -0.12),
        new THREE.Vector3(0.06, 0.44, -0.42),
      );
      this.mesh(this.track(taperedTube(curve, 0.33, 0.035, 40, 24)), mat, hp);
      const brim = this.mesh(fluffyTorus(0.33, 0.085, 0.016, 11), trim, hp);
      brim.rotation.x = Math.PI / 2;
      brim.position.y = 0.02;
      const tip = new THREE.Group();
      tip.position.set(0.06, 0.44, -0.42);
      hp.add(tip);
      this.mesh(fluffySphere(0.1, 0.018, 3), trim, tip);
      this.hatTip = tip;
      hp.rotation.set(-0.12, 0, 0.1);
    } else if (kind === 'beanie') {
      const mat = this.mat(style.hatColor, { roughness: 0.85, clearcoat: 0, sheen: 1, sheenColor: new THREE.Color(0xffffff) });
      const dome = this.mesh(this.track(new THREE.SphereGeometry(0.36, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)), mat, hp);
      dome.scale.set(1, 0.85, 1);
      dome.position.y = -0.02;
      const cuff = this.mesh(this.track(fluff(new THREE.TorusGeometry(0.34, 0.075, 12, 48), 0.006, 90, 1)), this.mat(style.hatTrim, { roughness: 0.8, clearcoat: 0 }), hp);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = 0.02;
      const tip = new THREE.Group();
      tip.position.set(0, 0.32, 0);
      hp.add(tip);
      this.mesh(fluffySphere(0.11, 0.025, 5), this.fur(style.hatTrim), tip);
      this.hatTip = tip;
    } else if (kind === 'tophat') {
      const mat = this.mat(style.hatColor, { roughness: 0.35, clearcoat: 0.8, sheen: 0.4 });
      const crown = this.mesh(cyl(0.25, 0.23, 0.42, 32), mat, hp);
      crown.position.y = 0.23;
      const brim = this.mesh(cyl(0.4, 0.4, 0.035, 40), mat, hp);
      brim.position.y = 0.03;
      const band = this.mesh(cyl(0.236, 0.234, 0.08, 32), this.mat(style.hatTrim, { roughness: 0.4 }), hp);
      band.position.y = 0.09;
      const leafMat = this.mat(0x1d7a3e, { roughness: 0.4 });
      for (const s of [-1, 1]) {
        const leaf = this.mesh(sphere(0.06, 12, 8), leafMat, hp);
        leaf.position.set(0.14 + s * 0.05, 0.11, 0.2);
        leaf.scale.set(1.4, 0.5, 0.3);
        leaf.rotation.z = s * 0.5;
      }
      const berry = this.mat(0xd31f2b, { roughness: 0.2, clearcoat: 1 });
      for (let i = 0; i < 3; i++) this.mesh(sphere(0.025, 10, 8), berry, hp).position.set(0.14 + (i - 1) * 0.03, 0.13 + (i % 2) * 0.02, 0.23);
      hp.rotation.set(-0.08, 0, -0.12);
      this.hatTip = null;
    } else if (kind === 'elf') {
      const mat = this.mat(style.hatColor, { roughness: 0.5, sheen: 0.6 });
      const curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.35, 0),
        new THREE.Vector3(0.1, 0.55, -0.05),
        new THREE.Vector3(0.36, 0.5, -0.12),
      );
      this.mesh(this.track(taperedTube(curve, 0.32, 0.03, 40, 24)), mat, hp);
      const brim = this.mesh(torus(0.32, 0.06, 12, 48), this.mat(style.hatTrim, { roughness: 0.4 }), hp);
      brim.rotation.x = Math.PI / 2;
      brim.position.y = 0.02;
      // zig-zag trim points
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const p = this.mesh(cone(0.05, 0.1, 6), brim.material as THREE.Material, hp);
        p.position.set(Math.sin(a) * 0.34, -0.03, Math.cos(a) * 0.34);
        p.rotation.x = Math.PI;
      }
      const tip = new THREE.Group();
      tip.position.set(0.36, 0.5, -0.12);
      hp.add(tip);
      const bell = this.mesh(sphere(0.06, 16, 12), Mats.gold(), tip);
      bell.position.y = -0.04;
      this.hatTip = tip;
    } else if (kind === 'antlers') {
      const band = this.mesh(torus(0.3, 0.025, 8, 40), this.mat(0x6b3f1d, { roughness: 0.6 }), hp);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.0;
      const antMat = this.mat(0x8a5a2b, { roughness: 0.55, clearcoat: 0.3 });
      for (const s of [-1, 1]) {
        const main = new THREE.CubicBezierCurve3(
          new THREE.Vector3(s * 0.2, 0, 0),
          new THREE.Vector3(s * 0.28, 0.2, 0),
          new THREE.Vector3(s * 0.42, 0.35, -0.05),
          new THREE.Vector3(s * 0.5, 0.5, -0.1),
        );
        this.mesh(this.track(taperedTube(main, 0.05, 0.022, 20, 10)), antMat, hp);
        const branch = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(s * 0.33, 0.25, -0.02),
          new THREE.Vector3(s * 0.32, 0.38, 0.02),
          new THREE.Vector3(s * 0.28, 0.48, 0.06),
        );
        this.mesh(this.track(taperedTube(branch, 0.03, 0.016, 12, 8)), antMat, hp);
        // jingle bells hanging on the antlers
        const bell = this.mesh(sphere(0.045, 12, 10), Mats.gold(), hp);
        bell.position.set(s * 0.42, 0.3, -0.05);
      }
      this.hatTip = null;
    } else if (kind === 'crown') {
      const ringMat = this.track(new THREE.MeshPhysicalMaterial({ color: 0xf5bf45, metalness: 1, roughness: 0.2, side: THREE.DoubleSide }));
      const ring = this.mesh(cyl(0.3, 0.29, 0.14, 40, true), ringMat, hp);
      ring.position.y = 0.07;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const sp = this.mesh(cone(0.05, 0.16, 8), Mats.gold(), hp);
        sp.position.set(Math.sin(a) * 0.29, 0.2, Math.cos(a) * 0.29);
        const jewel = this.mesh(sphere(0.03, 10, 8), Mats.glow(i % 2 ? 0xff3355 : 0x33ff99, 1.4), hp, false);
        jewel.position.set(Math.sin(a) * 0.305, 0.07, Math.cos(a) * 0.305);
        const ball = this.mesh(sphere(0.022, 8, 6), Mats.gold(), hp);
        ball.position.set(Math.sin(a) * 0.29, 0.29, Math.cos(a) * 0.29);
      }
      hp.rotation.set(-0.1, 0, 0.12);
      this.hatTip = null;
    } else if (kind === 'headband') {
      const mat = this.mat(style.hatColor, { roughness: 0.5, sheen: 0.6 });
      const band = this.mesh(torus(radiusAt(1.27) + 0.01, 0.04, 10, 48), mat, hp);
      band.rotation.x = Math.PI / 2;
      band.position.set(0, -0.04, 0.01);
      band.scale.set(1, 1, 0.6);
      const knotPos = surface(1.27, Math.PI, 0.02);
      const tip = new THREE.Group();
      tip.position.set(knotPos.x, knotPos.y - 1.31 - 0.04, knotPos.z + 0.01);
      hp.add(tip);
      this.mesh(sphere(0.05, 12, 8), mat, tip);
      for (const s of [-1, 1]) {
        const tail = this.mesh(rbox(0.06, 0.5, 0.02, 0.01), mat, tip);
        tail.position.set(s * 0.04, -0.22, -0.06);
        tail.rotation.set(0.5, 0, s * 0.25);
      }
      this.hatTip = tip;
    } else if (kind === 'earmuffs') {
      // headband over the crown with two fluffy muffs at ear height
      // the muffs sit on the sides of the head at eye level; the band arches over the top
      const earY = 1.12 - 1.31;
      const side = radiusAt(1.12) + 0.035;
      const bandMat = this.mat(style.hatColor, { roughness: 0.35, clearcoat: 0.8 });
      const band = this.mesh(torus(side, 0.032, 8, 48, Math.PI), bandMat, hp);
      band.rotation.set(0, 0, 0);
      band.position.y = earY;
      band.scale.set(1, 0.86, 1);
      const muff = this.fur(style.hatTrim);
      for (const s of [-1, 1]) {
        const m = this.mesh(fluffySphere(0.14, 0.03, 7 + s), muff, hp);
        m.position.set(s * (side + 0.02), earY, 0);
        m.scale.set(0.62, 1, 1);
      }
      this.hatTip = null;
    } else if (kind === 'star') {
      // a gold star bobbing on a spring above a thin headband
      const bandMat = this.mat(style.hatColor, { roughness: 0.4, clearcoat: 0.6 });
      const band = this.mesh(torus(0.3, 0.028, 8, 40), bandMat, hp);
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.02;
      const tip = new THREE.Group();
      tip.position.set(0, 0.36, 0);
      hp.add(tip);
      // the spring: a little helix
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * Math.PI * 10;
        pts.push(new THREE.Vector3(Math.cos(a) * 0.035, (i / 60) * 0.34, Math.sin(a) * 0.035));
      }
      const spring = this.mesh(this.track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.008, 6)), Mats.chrome(), hp);
      spring.position.y = 0.0;
      const star = this.mesh(this.track(star3D(0.13, 0.06, 0.05)), Mats.gold(), tip);
      star.rotation.y = Math.PI / 2;
      const glow = this.mesh(this.track(star3D(0.07, 0.033, 0.06)), Mats.glow(0xffd34a, 2), tip, false);
      glow.rotation.y = Math.PI / 2;
      this.hatTip = tip;
    } else if (kind === 'pudding') {
      // a Christmas pudding: dark fruity dome, white icing drips and a sprig of holly
      const pud = this.mat(0x4a2414, { roughness: 0.75, clearcoat: 0.2 });
      const dome = this.mesh(this.track(new THREE.SphereGeometry(0.33, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2)), pud, hp);
      dome.scale.set(1, 0.9, 1);
      dome.position.y = -0.03;
      const icing = this.mat(0xfdfaf3, { roughness: 0.3, clearcoat: 1 });
      const cap = this.mesh(this.track(new THREE.SphereGeometry(0.335, 28, 8, 0, Math.PI * 2, 0, 0.75)), icing, hp);
      cap.scale.set(1, 0.9, 1);
      cap.position.y = -0.03;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.2;
        const drip = this.mesh(capsuleGeo(0.03, 0.06 + (i % 3) * 0.03), icing, hp);
        drip.position.set(Math.sin(a) * 0.23, 0.12 - (i % 3) * 0.015, Math.cos(a) * 0.23);
      }
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4;
        const r = 0.31;
        const y = -0.02 + (i % 4) * 0.035;
        const rr = Math.sqrt(Math.max(0, r * r - y * y * 1.2));
        const raisin = this.mesh(sphere(0.018, 6, 5), this.mat(0x1a0c06, { roughness: 0.5 }), hp);
        raisin.position.set(Math.sin(a) * rr, y, Math.cos(a) * rr);
      }
      const leafMat = this.mat(0x1d7a3e, { roughness: 0.4, clearcoat: 0.5 });
      for (const s of [-1, 1]) {
        const leaf = this.mesh(sphere(0.07, 12, 8), leafMat, hp);
        leaf.position.set(s * 0.06, 0.29, 0);
        leaf.scale.set(1.5, 0.35, 0.7);
        leaf.rotation.y = s * 0.5;
      }
      const berry = this.mat(0xd31f2b, { roughness: 0.2, clearcoat: 1 });
      for (let i = 0; i < 3; i++) this.mesh(sphere(0.03, 10, 8), berry, hp).position.set((i - 1) * 0.035, 0.32, (i % 2) * 0.03);
      this.hatTip = null;
    }
  }

  private buildSack() {
    const sack = SACKS[this.outfit.sack] ?? SACKS['sack.burlap'];
    const sp = this.sackPivot;
    sp.position.set(0, 1.0, -0.3);
    this.body.add(sp);
    sp.add(this.sackScale);
    let mat: THREE.Material;
    switch (sack.kind) {
      case 'velvet':
        mat = this.track(new THREE.MeshPhysicalMaterial({ color: 0xb3121f, roughness: 0.7, sheen: 1, sheenColor: new THREE.Color(0xff7070) }));
        break;
      case 'gold':
        mat = this.track(new THREE.MeshPhysicalMaterial({ color: 0xf2b93b, metalness: 0.9, roughness: 0.3, sheen: 0.4 }));
        break;
      case 'candy': {
        const t = TextureLib.candyStripe().clone();
        t.repeat.set(3, 2);
        t.needsUpdate = true;
        mat = this.track(new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.4, clearcoat: 0.6 }));
        break;
      }
      case 'midnight':
        mat = this.track(new THREE.MeshPhysicalMaterial({ color: 0x1b2466, roughness: 0.65, sheen: 1, sheenColor: new THREE.Color(0x9fb3ff) }));
        break;
      case 'frost':
        mat = this.track(new THREE.MeshPhysicalMaterial({ color: 0xbfe9ff, roughness: 0.15, metalness: 0.1, clearcoat: 1, iridescence: 0.6, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) }));
        break;
      case 'holly':
        mat = this.track(new THREE.MeshPhysicalMaterial({ color: 0x17703a, roughness: 0.6, sheen: 1, sheenColor: new THREE.Color(0x9cffb8) }));
        break;
      case 'ginger':
        mat = this.track(new THREE.MeshPhysicalMaterial({ color: 0xb06a32, roughness: 0.7, clearcoat: 0.15 }));
        break;
      default:
        mat = this.track(new THREE.MeshStandardMaterial({ map: TextureLib.burlap(), roughness: 0.95 }));
    }
    const profile: [number, number][] = [
      [0.0, -0.66],
      [0.2, -0.64],
      [0.34, -0.54],
      [0.4, -0.36],
      [0.37, -0.17],
      [0.26, -0.04],
      [0.11, 0.03],
      [0.085, 0.08],
      [0.14, 0.15],
      [0.1, 0.17],
    ];
    const geo = this.track(smoothLathe(profile, 40, 36));
    fluff(geo, 0.012, 9, 2);
    const bag = this.mesh(geo, mat, this.sackScale);
    bag.rotation.y = 0.4;
    const tie = this.mesh(torus(0.095, 0.03, 8, 20), this.mat(sack.tie, { roughness: 0.6 }), this.sackScale);
    tie.rotation.x = Math.PI / 2;
    tie.position.y = 0.06;
    // gold "$" patch on the outside of the sack
    const patchMat = this.track(
      new THREE.MeshStandardMaterial({ map: TextureLib.sackPatch(), transparent: true, alphaTest: 0.3, roughness: 0.4, metalness: 0.4 }),
    );
    const patch = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.34, 0.34)), patchMat);
    patch.position.set(0, -0.36, -0.405);
    patch.rotation.y = Math.PI;
    this.sackScale.add(patch);

    // presents peeking out of the opening once the sack is fuller
    this.sackScale.add(this.sackGoodies);
    const gifts = [0, 3, 5];
    gifts.forEach((v, i) => {
      const box = this.mesh(rbox(0.13, 0.13, 0.13, 0.02), Mats.gift(v), this.sackGoodies);
      box.position.set((i - 1) * 0.07, 0.17 + (i % 2) * 0.03, (i % 2) * 0.04);
      box.rotation.set(0.3 * i, 0.5 * i, 0.2);
    });
    const coin = this.mesh(cyl(0.06, 0.06, 0.015, 16), Mats.gold(), this.sackGoodies);
    coin.position.set(0.02, 0.22, -0.05);
    coin.rotation.set(1.2, 0, 0.4);

    // strap across the chest
    const strap = this.mesh(torus(0.5, 0.022, 8, 48), this.mat(sack.tie === 0xd31f2b ? 0x6b3f1d : sack.tie, { roughness: 0.6 }), this.outfitGroup);
    strap.position.set(0, 0.78, 0.0);
    strap.rotation.set(Math.PI / 2 + 0.15, 0.55, 0);
    strap.scale.set(1.0, 1.0, 0.85);
    strap.renderOrder = 1;
    this.applySackScale();
  }

  private applySackScale() {
    const s = 0.62 + 0.95 * Math.sqrt(this.sackFillShown) + this.sackPop.value * 0.25;
    this.sackScale.scale.setScalar(s);
    this.sackScale.position.set(0.0, 0.05 * s, -0.22 * s);
    this.sackGoodies.visible = this.sackFillShown > 0.2;
  }

  // ------------------------------------------------------------ reactions
  /** 0..1 — how full the loot sack is. */
  setLoot(fill: number) {
    this.sackFill = clamp(fill, 0, 1);
  }
  onPickup(big = false) {
    this.sackPop.kick(big ? 9 : 5);
    this.sackSwing.kick(big ? -4 : -2);
  }
  onJump() {
    this.squash.value = 0.82;
    this.squash.kick(4);
    this.hatSwingX.kick(-4);
    this.sackSwing.kick(3);
  }
  onLand(intensity: number) {
    const k = clamp(intensity, 0.2, 1.4);
    this.squash.value = 1 - 0.28 * k;
    this.squash.velocity = 0;
    this.hatSwingX.kick(6 * k);
    this.sackSwing.kick(-5 * k);
  }
  flash(expr: Expression, time = 1.2) {
    this.exprOverride = expr;
    this.exprTimer = time;
  }
  setVisible(v: boolean) {
    this.root.visible = v;
  }

  // ------------------------------------------------------------- animation
  update(dt: number, inp: BeanAnimInput) {
    this.t += dt;
    const t = this.t;
    const st = inp.state;
    if (st !== this.prevState) {
      if (st === 'getup') this.divePitch.value = Math.min(this.divePitch.value, 1.4);
      this.prevState = st;
    }

    // sack fill animates in
    this.sackFillShown = damp(this.sackFillShown, this.sackFill, 6, dt);
    this.sackPop.update(0, dt);
    this.applySackScale();

    const speedK = clamp(inp.speed / Math.max(1, inp.maxSpeed), 0, 1.3);
    const moving = (st === 'run' || st === 'idle') && inp.speed > 0.4;

    // ---- stride
    if (moving) this.phase += dt * (5.5 + inp.speed * 1.05);
    else this.phase = damp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, 8, dt);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const runAmt = moving ? clamp(inp.speed / 4, 0, 1) : 0;

    // ---- squash & stretch
    let targetSquash = 1;
    if (st === 'air') targetSquash = 1 + clamp(inp.vy * 0.012, -0.06, 0.12);
    if (st === 'idle' || st === 'menu') targetSquash = 1 + Math.sin(t * 2.2) * 0.018;
    if (moving) targetSquash = 1 + Math.abs(c) * 0.06 * runAmt - 0.03 * runAmt;
    const sq = this.squash.update(targetSquash, dt);
    const inv = 1 / Math.sqrt(Math.max(0.5, sq));
    this.body.scale.set(inv, sq, inv);

    // ---- lean
    let pitch = 0;
    let roll = 0;
    let bob = 0;
    if (moving) {
      pitch = 0.1 + speedK * (inp.sprinting ? 0.24 : 0.14);
      roll = clamp(-inp.turnRate * 0.07 * speedK, -0.38, 0.38) + s * 0.05 * runAmt;
      bob = Math.abs(s) * 0.08 * runAmt;
    }
    if (st === 'air') pitch = clamp(-inp.vy * 0.015, -0.2, 0.15) + speedK * 0.12;
    this.leanPitch = damp(this.leanPitch, pitch, 10, dt);
    this.leanRoll = damp(this.leanRoll, roll, 8, dt);

    // dive / slide orientation
    let diveTarget = 0;
    let pivotY = PIVOT_Y;
    if (st === 'dive') {
      diveTarget = 1.45;
      pivotY = 0.62;
    } else if (st === 'slide') {
      diveTarget = 1.52;
      pivotY = 0.46;
    } else if (st === 'caught') {
      diveTarget = -0.15;
    }
    const dp = this.divePitch.update(diveTarget, dt);
    if (st !== 'knocked') {
      this.pivot.position.y = damp(this.pivot.position.y, pivotY + bob, 14, dt);
      this.pivot.rotation.set(this.leanPitch + dp, 0, this.leanRoll, 'YXZ');
    }

    // ---- limbs
    const armL = this.armL.rotation;
    const armR = this.armR.rotation;
    const legL = this.legL.rotation;
    const legR = this.legR.rotation;
    let aLx = 0,
      aLz = 0.18,
      aRx = 0,
      aRz = -0.18,
      lLx = 0,
      lRx = 0;
    if (st === 'idle' || st === 'menu') {
      const br = Math.sin(t * 2.2) * 0.05;
      aLz = 0.2 + br;
      aRz = -0.2 - br;
      aLx = Math.sin(t * 1.3) * 0.06;
      aRx = -Math.sin(t * 1.3) * 0.06;
    }
    if (moving) {
      const amp = 0.9 + speedK * 0.6;
      aLx = s * amp * runAmt;
      aRx = -s * amp * runAmt;
      aLz = 0.3 + Math.abs(s) * 0.15;
      aRz = -0.3 - Math.abs(s) * 0.15;
      lLx = -s * 0.95 * runAmt;
      lRx = s * 0.95 * runAmt;
    }
    if (st === 'air') {
      const up = inp.vy > 0 ? 1 : 0.7;
      const fl = noise1(t * 9) * 0.5;
      aLz = 2.3 * up + fl;
      aRz = -2.3 * up - noise1(t * 9 + 4) * 0.5;
      aLx = -0.3 + noise1(t * 7 + 1) * 0.4;
      aRx = -0.3 + noise1(t * 7 + 7) * 0.4;
      lLx = 0.4 + noise1(t * 6) * 0.4;
      lRx = -0.3 + noise1(t * 6 + 3) * 0.4;
    }
    if (st === 'dive' || st === 'slide') {
      aLx = -2.9;
      aRx = -2.9;
      aLz = 0.25;
      aRz = -0.25;
      lLx = 0.5 + Math.sin(t * 20) * (st === 'dive' ? 0.25 : 0.08);
      lRx = 0.5 - Math.sin(t * 20) * (st === 'dive' ? 0.25 : 0.08);
    }
    if (st === 'knocked') {
      this.flail += dt * 14;
      aLz = 1.6 + noise1(this.flail) * 1.2;
      aRz = -1.6 + noise1(this.flail + 9) * 1.2;
      aLx = noise1(this.flail + 3) * 1.5;
      aRx = noise1(this.flail + 5) * 1.5;
      lLx = noise1(this.flail + 11) * 1.2;
      lRx = noise1(this.flail + 13) * 1.2;
    }
    if (st === 'interact') {
      aLx = -1.25 + Math.sin(t * 14) * 0.12;
      aRx = -1.25 + Math.cos(t * 13) * 0.12;
      aLz = -0.2;
      aRz = 0.2;
    }
    if (st === 'celebrate') {
      const w = Math.sin(t * 12);
      aLz = 2.6 + w * 0.3;
      aRz = -2.6 + w * 0.3;
      aLx = 0;
      aRx = 0;
      this.pivot.position.y = PIVOT_Y + Math.abs(Math.sin(t * 6)) * 0.35;
    }
    if (st === 'caught') {
      aLz = 2.8;
      aRz = -2.8;
      aLx = Math.sin(t * 20) * 0.1;
      aRx = -Math.sin(t * 20) * 0.1;
    }
    if (st === 'hang') {
      // both hands on the zipline trolley overhead, legs swinging in the wind
      aLz = 2.75;
      aRz = -2.75;
      aLx = -0.35;
      aRx = -0.35;
      lLx = 0.35 + Math.sin(t * 5.5) * 0.35;
      lRx = 0.15 - Math.sin(t * 5.5 + 0.6) * 0.35;
    }
    const k = 1 - Math.exp(-18 * dt);
    armL.x += (aLx - armL.x) * k;
    armL.z += (aLz - armL.z) * k;
    armR.x += (aRx - armR.x) * k;
    armR.z += (aRz - armR.z) * k;
    legL.x += (lLx - legL.x) * k;
    legR.x += (lRx - legR.x) * k;

    // ---- hat & accessories secondary motion
    const hatTargetX = moving ? -0.25 * speedK : 0;
    this.hatSwingX.update(hatTargetX + (st === 'air' ? clamp(inp.vy * 0.03, -0.3, 0.3) : 0), dt);
    this.hatSwingZ.update(-this.leanRoll * 0.8 + (moving ? s * 0.06 : 0), dt);
    if (this.hatTip) {
      this.hatTip.rotation.x = this.hatSwingX.value * 0.9;
      this.hatTip.rotation.z = this.hatSwingZ.value;
    }
    this.hatPivot.position.y = 1.31 + (st === 'idle' ? Math.sin(t * 2.2) * 0.006 : 0);
    for (let i = 0; i < this.tails.length; i++) {
      const side = i === 0 ? -1 : 1;
      const flutter = moving ? Math.sin(t * 18 + i) * 0.25 * speedK : Math.sin(t * 2 + i) * 0.04;
      this.tails[i].rotation.x = 0.35 + speedK * 0.9 + flutter;
      this.tails[i].rotation.z = side * 0.35;
    }

    // sack swing (opposes acceleration, bounces with stride)
    const sackTarget = clamp(-inp.accel * 0.02, -0.4, 0.4) + (moving ? Math.abs(c) * 0.08 * runAmt : 0);
    this.sackSwing.update(sackTarget, dt);
    this.sackSwingZ.update(this.leanRoll * -0.5 + (moving ? s * 0.07 * runAmt : 0), dt);
    this.sackPivot.rotation.set(-0.15 + this.sackSwing.value, 0, this.sackSwingZ.value);

    // ---- face
    if (this.exprTimer > 0) {
      this.exprTimer -= dt;
      if (this.exprTimer <= 0) this.exprOverride = null;
    }
    let expr: Expression = this.expression;
    if (st === 'knocked') expr = 'dizzy';
    else if (st === 'celebrate') expr = 'happy';
    else if (st === 'caught') expr = 'surprised';
    else if (st === 'dive' || st === 'slide' || (inp.sprinting && moving)) expr = 'determined';
    if (this.exprOverride) expr = this.exprOverride;
    if (this.style.scowl && expr === 'normal') expr = 'determined';

    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.14;
      this.blinkTimer = 1.8 + Math.random() * 3.5;
    }
    this.blink = Math.max(0, this.blink - dt);
    const blinkScale = this.blink > 0 ? 0.12 : 1;

    // eye darting / look target
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = 0.8 + Math.random() * 2;
      this.lookTarget.set((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.025);
    }
    if (this.lookAtWorld) {
      const local = this.root.worldToLocal(this.lookAtWorld.clone());
      const ang = Math.atan2(local.x, local.z);
      this.lookTarget.set(clamp(ang * 0.05, -0.025, 0.025), clamp((local.y - 1.1) * 0.01, -0.02, 0.02));
    }
    this.lookX = damp(this.lookX, this.lookTarget.x, 10, dt);
    this.lookY = damp(this.lookY, this.lookTarget.y, 10, dt);

    for (const e of this.eyes) {
      const open = expr === 'normal' || expr === 'surprised' || expr === 'determined';
      e.open.visible = open;
      e.happy.visible = expr === 'happy';
      e.dizzy.visible = expr === 'dizzy';
      const sc = expr === 'surprised' ? 1.25 : 1;
      e.open.scale.set(sc, sc * (expr === 'determined' ? 0.72 : 1) * blinkScale, 1);
      e.pupil.position.x = this.lookX;
      e.pupil.position.y = this.lookY;
      e.pupil.scale.set(expr === 'surprised' ? 0.7 : 1, expr === 'surprised' ? 0.8 : 1.15, 0.55);
      if (expr === 'dizzy') e.dizzy.rotation.z = t * 6;
    }
    this.brows.forEach((b, i) => {
      const side = i === 0 ? -1 : 1;
      let tilt = side * 0.12;
      let y = 0;
      if (expr === 'determined') {
        tilt = -side * 0.35;
        y = -0.012;
      } else if (expr === 'surprised') {
        tilt = side * 0.25;
        y = 0.03;
      } else if (expr === 'happy') {
        y = 0.02;
      }
      b.rotation.z = damp(b.rotation.z, Math.PI / 2 + tilt, 12, dt);
      b.position.y = damp(b.position.y, 1.235 + y, 12, dt);
    });
    this.mouth.visible = !this.style.beard || expr === 'surprised';
    if (this.mouth.visible) {
      const ms = expr === 'surprised' ? 1.25 : expr === 'happy' ? 0.9 : 0.6;
      this.mouth.scale.set(ms, ms * 1.2, 0.4);
    }
  }

  /** Ragdoll mode: caller drives root position/rotation directly. */
  setRagdollPose(center: THREE.Vector3, rot: THREE.Quaternion) {
    this.root.position.copy(center);
    this.root.quaternion.copy(rot);
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);
  }

  /** Leaving ragdoll mode: restore upright hierarchy keeping a tumble angle. */
  endRagdoll(feet: THREE.Vector3, yaw: number) {
    this.root.position.copy(feet);
    this.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.pivot.position.y = PIVOT_Y * 0.6;
    this.divePitch.value = 1.3;
    this.divePitch.velocity = 0;
  }

  dispose() {
    this.clear();
    this.root.removeFromParent();
  }
}

function mergeAll(geos: THREE.BufferGeometry[]) {
  let total = 0;
  let totalIdx = 0;
  for (const g of geos) {
    total += g.attributes.position.count;
    totalIdx += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const idx = new Uint32Array(totalIdx);
  let o = 0;
  let io = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nrm.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    if (g.index) {
      const src = g.index.array;
      for (let i = 0; i < src.length; i++) idx[io++] = src[i] + o;
    } else {
      for (let i = 0; i < n; i++) idx[io++] = i + o;
    }
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const stripeCache = new Map<string, THREE.CanvasTexture>();

/** Two-colour diagonal stripes for striped masks (cached: shared by every robber wearing them). */
function stripeTexture(a: number, b: number) {
  const key = `${a}-${b}`;
  const hit = stripeCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#' + a.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#' + b.toString(16).padStart(6, '0');
  for (let x = -64; x < 128; x += 32) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 16, 0);
    g.lineTo(x + 16 + 64, 64);
    g.lineTo(x + 64, 64);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.repeat.set(10, 1);
  stripeCache.set(key, t);
  return t;
}

function capsuleGeo(r: number, len: number) {
  return new THREE.CapsuleGeometry(r, len, 4, 8);
}
