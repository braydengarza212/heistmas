import * as THREE from 'three';
import { Physics, G } from './physics';
import { cyl, rbox, sphere, torus, cone, star3D } from '../gfx/geom';
import { Mats } from '../gfx/materials';
import { mulberry32 } from '../core/math';
import type { Guard } from './Guard';
import { NET_WEAPONS } from '../shared/protocol';
import { CHAR_SCALE as K } from './scale';
import type { RemoteTarget } from './RemotePlayers';

/**
 * The festive arsenal: one snowball weapon hidden on every stage of the heist.
 * Every gun carries 5 shots. A snowball knocks a penguin guard back and
 * freezes it for 5 seconds; some guns spray, pierce or burst.
 */

export const FREEZE_SECONDS = 5;
export const WEAPON_AMMO = 5;

export interface WeaponDef {
  id: string;
  name: string;
  /** Type label: ray gun, assault rifle, shotgun… */
  kind: string;
  /** Display stage (1-10) it is hidden on. */
  stage: number;
  /** Where on that stage it can hide ([x, floorY, z]); one is picked per round. */
  spots: [number, number, number][];
  /** Hold to keep firing. */
  auto: boolean;
  cooldown: number;
  /** Snowballs per shot. */
  pellets: number;
  /** Cone spread (radians). */
  spread: number;
  speed: number;
  gravity: number;
  life: number;
  /** Ball radius (visual) and hit reach. */
  size: number;
  reach: number;
  /** Passes through guards. */
  pierce: boolean;
  /** Burst radius on impact (0 = none). */
  splash: number;
  /** Knockback speed. */
  knock: number;
  /** Snowball tint. */
  tint: number;
  /** Trail / muzzle colour. */
  glow: number;
  blurb: string;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'frosty', name: 'FROSTY BLASTER', kind: 'Ray gun', stage: 1,
    spots: [[-14.5, -1.2, 11], [19.5, -1.2, 13.5], [-22.5, -1.2, 34], [15.8, -1.2, 23], [-9.5, -1.2, 16], [21.5, -1.2, 34.5], [-24, -1.2, 15]],
    auto: false, cooldown: 0.4, pellets: 1, spread: 0, speed: 36, gravity: 5, life: 2.4, size: 0.16, reach: 0.85,
    pierce: false, splash: 0, knock: 9, tint: 0xffffff, glow: 0x9fe6ff,
    blurb: 'A candy-striped ray gun that fires snowballs.',
  },
  {
    id: 'carbine', name: 'CANDY CANE CARBINE', kind: 'Assault rifle', stage: 2,
    spots: [[8.8, 0, -30], [4.4, 0, -16.4], [-8.8, 0, -30], [-4.4, 0, -16.4], [0, 0, -21.3], [6.5, 0, -8.3]],
    auto: true, cooldown: 0.11, pellets: 1, spread: 0.018, speed: 48, gravity: 3, life: 1.8, size: 0.12, reach: 0.8,
    pierce: false, splash: 0, knock: 7, tint: 0xffffff, glow: 0xff5a6e,
    blurb: 'Hold fire to empty the whole magazine in a rapid snowball spray.',
  },
  {
    id: 'jingle', name: 'JINGLE BELL SHOTGUN', kind: 'Shotgun', stage: 3,
    spots: [[3.1, 0, -39.6], [-3.1, 0, -39.6], [2.3, 0, -53.5], [-2.3, 0, -48.5], [-3.2, 0, -55.1], [3.2, 0, -46.9]],
    auto: false, cooldown: 0.75, pellets: 7, spread: 0.09, speed: 32, gravity: 6, life: 0.6, size: 0.11, reach: 0.8,
    pierce: false, splash: 0, knock: 13, tint: 0xffffff, glow: 0xffd34a,
    blurb: 'Seven snowballs per blast: devastating up close.',
  },
  {
    id: 'nutcracker', name: 'NUTCRACKER LONG RIFLE', kind: 'Sniper rifle', stage: 4,
    spots: [[-12.5, 0, -61.5], [12.5, 0, -61], [-16, 0, -62.5], [15, 0, -61.5]],
    auto: false, cooldown: 1.0, pellets: 1, spread: 0, speed: 95, gravity: 0, life: 1.4, size: 0.13, reach: 0.95,
    pierce: false, splash: 0, knock: 12, tint: 0xffffff, glow: 0xffd34a,
    blurb: 'A scoped toy-soldier rifle: dead straight and very long range.',
  },
  {
    id: 'globe', name: 'SNOW GLOBE LAUNCHER', kind: 'Grenade launcher', stage: 5,
    spots: [[-7.2, 0, -93.4], [6, 0, -93.1], [-1.8, 0, -93.3], [13.4, 0, -116.6], [13.4, 0, -101.4], [-6.5, 0, -96.3], [13.3, 0, -106.5]],
    auto: false, cooldown: 0.9, pellets: 1, spread: 0, speed: 19, gravity: 12, life: 3, size: 0.3, reach: 1.0,
    pierce: false, splash: 4, knock: 11, tint: 0xdff6ff, glow: 0x6fd8ff,
    blurb: 'Lobs a snow globe that bursts and freezes every penguin nearby.',
  },
  {
    id: 'peppermint', name: 'PEPPERMINT REVOLVER', kind: 'Revolver', stage: 6,
    spots: [[39, 0, -100.3], [16, 0, -100.3], [16, 0, -117.8], [39, 0, -117.8], [16.6, 0, -106.6], [38, 0, -105.4]],
    auto: false, cooldown: 0.3, pellets: 1, spread: 0, speed: 55, gravity: 3, life: 1.8, size: 0.14, reach: 0.85,
    pierce: false, splash: 0, knock: 10, tint: 0xffffff, glow: 0xff5a6e,
    blurb: 'Five quick, accurate shots from a peppermint-swirl six-shooter.',
  },
  {
    id: 'tinsel', name: 'TINSEL TOMMY', kind: 'Submachine gun', stage: 7,
    spots: [[42.4, 0, -96.7], [44.2, 0, -104.8], [72, 0, -96.9]],
    auto: true, cooldown: 0.075, pellets: 1, spread: 0.035, speed: 42, gravity: 4, life: 1.4, size: 0.11, reach: 0.8,
    pierce: false, splash: 0, knock: 6, tint: 0xffffff, glow: 0xc9b6ff,
    blurb: 'Drum-fed and very fast: hold fire for a quick flurry.',
  },
  {
    id: 'aurora', name: 'AURORA RAY', kind: 'Piercing ray gun', stage: 8,
    spots: [[111, 4.2, -116.8], [111, 4.2, -100.5], [76.6, 0, -102.8], [76.6, 0, -117.8], [100.2, 8.6, -94.9], [111, 4.2, -106.3]],
    auto: false, cooldown: 0.5, pellets: 1, spread: 0, speed: 44, gravity: 0, life: 1.6, size: 0.2, reach: 1.0,
    pierce: true, splash: 0, knock: 10, tint: 0xd8fff2, glow: 0x5dffc0,
    blurb: 'Fires glowing snowballs that punch straight through a line of guards.',
  },
  {
    id: 'icicle', name: 'ICICLE RAILGUN', kind: 'Piercing sniper', stage: 9,
    spots: [[166, 15.4, -105.4], [170.1, 15.4, -110.7], [171.4, 15.4, -117.8], [169.2, 15.4, -125.3], [104, 14, -93.4], [162.9, 15.4, -124.3]],
    auto: false, cooldown: 0.9, pellets: 1, spread: 0, speed: 130, gravity: 0, life: 1.0, size: 0.12, reach: 1.0,
    pierce: true, splash: 0, knock: 14, tint: 0xe9fbff, glow: 0x9fe6ff,
    blurb: 'A frozen rail of pure ice: instant, long range, pierces everything.',
  },
  {
    id: 'yule', name: 'YULE LOG BAZOOKA', kind: 'Rocket launcher', stage: 10,
    spots: [[222.5, 0.15, -147.5], [193.8, 0.15, -149], [202.8, 0, -133.3], [209.4, 0, -134.6], [229.2, 0.15, -146.6], [204.2, 0, -139.8]],
    auto: false, cooldown: 1.1, pellets: 1, spread: 0, speed: 30, gravity: 2, life: 2.5, size: 0.34, reach: 1.1,
    pierce: false, splash: 5.5, knock: 14, tint: 0xffffff, glow: 0xff8a3a,
    blurb: 'A giant snowball rocket with a huge freezing blast.',
  },
];

// ------------------------------------------------------------------ models

function m(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
/** A cylinder lying along +Z. */
function tube(r0: number, r1: number, len: number, mat: THREE.Material, p: THREE.Object3D, x: number, y: number, z: number, seg = 18) {
  const c = m(cyl(r0, r1, len, seg), mat, p, x, y, z + len / 2);
  c.rotation.x = Math.PI / 2;
  return c;
}
function ring(r: number, t: number, mat: THREE.Material, p: THREE.Object3D, x: number, y: number, z: number) {
  return m(torus(r, t, 8, 24), mat, p, x, y, z);
}
function holly(p: THREE.Object3D, x: number, y: number, z: number, s = 1) {
  for (const a of [-0.6, 0.6]) {
    const leaf = m(sphere(0.05 * s, 8, 6), Mats.pine(), p, x + a * 0.06 * s, y, z);
    leaf.scale.set(1.8, 0.35, 0.9);
    leaf.rotation.y = a;
  }
  for (const [dx, dz] of [[0, 0.02], [0.025, -0.015], [-0.025, -0.015]]) m(sphere(0.022 * s, 8, 6), Mats.plastic(0xd0102a), p, x + dx * s, y + 0.025 * s, z + dz * s);
}
function bow(p: THREE.Object3D, x: number, y: number, z: number, hex: number, s = 1) {
  const mat = Mats.ribbon(hex);
  for (const sgn of [-1, 1]) {
    const loop = m(torus(0.05 * s, 0.016 * s, 6, 16), mat, p, x + sgn * 0.05 * s, y, z);
    loop.rotation.y = Math.PI / 2;
    loop.scale.set(1, 0.7, 1);
  }
  m(sphere(0.025 * s, 8, 6), mat, p, x, y, z);
}
function grip(p: THREE.Object3D, hex: number, z = -0.12, y = -0.2) {
  const g = m(rbox(0.11, 0.27, 0.13, 0.045), Mats.plastic(hex), p, 0, y, z);
  g.rotation.x = -0.25;
  ring(0.055, 0.011, Mats.gold(), p, 0, -0.1, z + 0.12).rotation.y = Math.PI / 2;
}

/** Builds a weapon model (barrel along +Z, grip down). Returns the group and its muzzle marker. */
export function buildWeapon(def: WeaponDef) {
  const g = new THREE.Group();
  let muzzleZ = 0.68;
  switch (def.id) {
    case 'frosty': {
      m(rbox(0.22, 0.24, 0.5, 0.08), Mats.plastic(0x1d9a55), g, 0, 0, -0.02);
      tube(0.07, 0.085, 0.42, Mats.candy(1, 2), g, 0, 0.02, 0.19);
      for (const z of [0.3, 0.42, 0.54]) ring(0.09, 0.018, Mats.gold(), g, 0, 0.02, z);
      ring(0.1, 0.03, Mats.glow(def.glow, 4), g, 0, 0.02, 0.62);
      m(cyl(0.09, 0.11, 0.06, 20), Mats.gold(), g, 0, 0.15, -0.05);
      const globe = m(sphere(0.13, 20, 16), Mats.glass(), g, 0, 0.27, -0.05);
      globe.castShadow = false;
      m(sphere(0.085, 14, 10), Mats.snowCap(), g, 0, 0.23, -0.05);
      m(cone(0.04, 0.1, 8), Mats.pine(), g, 0, 0.3, -0.05);
      grip(g, 0xc8162a);
      for (const s of [-1, 1]) m(rbox(0.03, 0.14, 0.22, 0.02), Mats.gold(), g, s * 0.13, 0.04, -0.12).rotation.z = s * 0.5;
      break;
    }
    case 'carbine': {
      m(rbox(0.16, 0.2, 0.62, 0.05), Mats.plastic(0xf4efe6), g, 0, 0, 0.0);
      tube(0.045, 0.045, 0.5, Mats.candy(1, 3), g, 0, 0.03, 0.3);
      ring(0.06, 0.016, Mats.glow(def.glow, 3), g, 0, 0.03, 0.8);
      muzzleZ = 0.84;
      // straight magazine, carry handle with a star sight, candy-cane stock
      m(rbox(0.09, 0.26, 0.12, 0.03), Mats.plastic(0xc8162a), g, 0, -0.2, 0.08).rotation.x = 0.15;
      m(rbox(0.05, 0.05, 0.3, 0.02), Mats.gold(), g, 0, 0.15, 0.02);
      m(star3D(0.05, 0.022, 0.02), Mats.glow(0xffd34a, 3), g, 0, 0.2, -0.1);
      const stock = m(torus(0.13, 0.035, 8, 20, Math.PI), Mats.candy(2, 1), g, 0, -0.05, -0.38);
      stock.rotation.y = Math.PI / 2;
      grip(g, 0x1d9a55, -0.18, -0.19);
      holly(g, 0.09, 0.07, 0.15);
      break;
    }
    case 'jingle': {
      m(rbox(0.2, 0.2, 0.42, 0.06), Mats.wood(), g, 0, 0, -0.1);
      for (const s of [-1, 1]) tube(0.055, 0.055, 0.55, Mats.gunmetal(), g, s * 0.058, 0.04, 0.1);
      for (const s of [-1, 1]) ring(0.06, 0.012, Mats.gold(), g, s * 0.058, 0.04, 0.62);
      muzzleZ = 0.68;
      // pump wrapped in ribbon, jingle bells hanging under the barrel
      m(rbox(0.17, 0.09, 0.2, 0.04), Mats.plastic(0xc8162a), g, 0, -0.06, 0.32);
      for (const z of [0.18, 0.46]) {
        m(sphere(0.045, 12, 10), Mats.gold(), g, 0, -0.14, z);
        m(cyl(0.012, 0.012, 0.05, 6), Mats.gold(), g, 0, -0.1, z);
      }
      bow(g, 0, 0.13, 0.32, 0x1d9a55);
      const stock = m(rbox(0.13, 0.17, 0.34, 0.05), Mats.wood(), g, 0, -0.06, -0.42);
      stock.rotation.x = 0.2;
      grip(g, 0x5b3a22, -0.18, -0.17);
      break;
    }
    case 'nutcracker': {
      m(rbox(0.15, 0.18, 0.7, 0.05), Mats.plastic(0xc8162a), g, 0, 0, -0.05);
      tube(0.035, 0.04, 0.75, Mats.blackGloss(), g, 0, 0.03, 0.28);
      for (const z of [0.45, 0.7, 0.95]) ring(0.045, 0.012, Mats.gold(), g, 0, 0.03, z);
      muzzleZ = 1.06;
      // brass scope with glowing lenses, toy-soldier plume on the stock
      tube(0.05, 0.05, 0.36, Mats.gold(), g, 0, 0.16, -0.12);
      for (const z of [-0.12, 0.24]) {
        const lens = m(cyl(0.045, 0.045, 0.01, 16), Mats.glow(def.glow, 2), g, 0, 0.16, z);
        lens.rotation.x = Math.PI / 2;
      }
      const stock = m(rbox(0.13, 0.2, 0.36, 0.05), Mats.plastic(0x1b2c6e), g, 0, -0.05, -0.55);
      stock.rotation.x = 0.12;
      m(cone(0.05, 0.16, 10), Mats.plastic(0xf4efe6), g, 0, 0.1, -0.6);
      for (const z of [-0.3, -0.05, 0.2]) m(sphere(0.022, 8, 6), Mats.gold(), g, 0.08, 0, z);
      grip(g, 0x1b2c6e, -0.2, -0.18);
      break;
    }
    case 'globe': {
      tube(0.12, 0.12, 0.7, Mats.plastic(0x1d9a55), g, 0, 0.02, -0.25);
      ring(0.13, 0.025, Mats.gold(), g, 0, 0.02, 0.43);
      ring(0.13, 0.025, Mats.gold(), g, 0, 0.02, -0.25);
      // the snow globe "round" sits in a cradle on top
      const globe = m(sphere(0.15, 20, 16), Mats.glass(), g, 0, 0.27, 0.0);
      globe.castShadow = false;
      m(sphere(0.1, 14, 10), Mats.snowCap(), g, 0, 0.22, 0.0);
      m(cone(0.045, 0.11, 8), Mats.pine(), g, 0, 0.29, 0.0);
      m(cyl(0.11, 0.13, 0.07, 20), Mats.gold(), g, 0, 0.12, 0.0);
      ring(0.11, 0.025, Mats.glow(def.glow, 3), g, 0, 0.02, 0.46);
      muzzleZ = 0.5;
      bow(g, 0, 0.02, -0.3, 0xc8162a, 1.3);
      grip(g, 0xc8162a, -0.02, -0.21);
      m(rbox(0.09, 0.2, 0.1, 0.04), Mats.plastic(0xc8162a), g, 0, -0.17, 0.22);
      break;
    }
    case 'peppermint': {
      m(rbox(0.12, 0.17, 0.3, 0.05), Mats.chrome(), g, 0, 0.02, 0.02);
      tube(0.04, 0.045, 0.34, Mats.chrome(), g, 0, 0.05, 0.12);
      muzzleZ = 0.5;
      // the cylinder is a peppermint swirl
      const drum = m(cyl(0.085, 0.085, 0.13, 20), Mats.candy(3, 1), g, 0, 0.0, 0.02);
      drum.rotation.x = Math.PI / 2;
      m(sphere(0.02, 8, 6), Mats.plastic(0xc8162a), g, 0, 0.11, 0.42);
      const gr = m(rbox(0.1, 0.26, 0.13, 0.05), Mats.plastic(0xf4efe6), g, 0, -0.18, -0.14);
      gr.rotation.x = -0.45;
      ring(0.055, 0.011, Mats.gold(), g, 0, -0.08, -0.02).rotation.y = Math.PI / 2;
      holly(g, 0, -0.16, -0.21, 0.9);
      break;
    }
    case 'tinsel': {
      m(rbox(0.15, 0.17, 0.5, 0.05), Mats.plastic(0x5b2a86), g, 0, 0, 0.0);
      tube(0.04, 0.04, 0.3, Mats.gunmetal(), g, 0, 0.02, 0.25);
      for (let i = 0; i < 6; i++) ring(0.055, 0.008, Mats.gold(), g, 0, 0.02, 0.27 + i * 0.045);
      muzzleZ = 0.6;
      // drum magazine = big ornament bauble
      const drum = m(sphere(0.13, 20, 16), Mats.plastic(0xc8162a), g, 0, -0.17, 0.08);
      drum.scale.set(0.75, 1, 1);
      m(cyl(0.035, 0.035, 0.05, 10), Mats.gold(), g, 0, -0.03, 0.08);
      m(torus(0.13, 0.012, 6, 28), Mats.gold(), g, 0, -0.17, 0.08).rotation.y = Math.PI / 2;
      grip(g, 0x2b2f38, -0.18, -0.18);
      m(rbox(0.05, 0.12, 0.08, 0.02), Mats.plastic(0x2b2f38), g, 0, -0.1, 0.3);
      const stock = m(torus(0.1, 0.025, 6, 18, Math.PI), Mats.gold(), g, 0, -0.03, -0.3);
      stock.rotation.y = Math.PI / 2;
      break;
    }
    case 'aurora': {
      m(rbox(0.2, 0.22, 0.46, 0.09), Mats.plastic(0x0e3a4a), g, 0, 0, -0.02);
      // stacked aurora rings around a clear barrel
      tube(0.05, 0.06, 0.45, Mats.glass(), g, 0, 0.02, 0.15);
      tube(0.02, 0.02, 0.45, Mats.glow(def.glow, 4), g, 0, 0.02, 0.15, 8);
      const cols = [0x5dffc0, 0x6fd8ff, 0xc9b6ff];
      for (let i = 0; i < 3; i++) ring(0.1 - i * 0.012, 0.018, Mats.glow(cols[i], 3), g, 0, 0.02, 0.32 + i * 0.1);
      muzzleZ = 0.64;
      m(star3D(0.09, 0.04, 0.03), Mats.gold(), g, 0, 0.19, -0.05);
      for (const s of [-1, 1]) m(rbox(0.03, 0.16, 0.24, 0.02), Mats.chrome(), g, s * 0.12, 0.05, -0.12).rotation.z = s * 0.55;
      grip(g, 0x0e3a4a);
      break;
    }
    case 'icicle': {
      m(rbox(0.14, 0.16, 0.6, 0.05), Mats.plastic(0xeaf6ff), g, 0, 0, -0.1);
      // twin ice rails with a glowing core between them
      for (const s of [-1, 1]) {
        const rail = m(rbox(0.035, 0.05, 0.9, 0.015), Mats.glass(), g, s * 0.05, 0.03, 0.42);
        rail.castShadow = false;
      }
      tube(0.015, 0.015, 0.85, Mats.glow(def.glow, 5), g, 0, 0.03, 0.0, 8);
      const tip = m(cone(0.04, 0.18, 10), Mats.glass(), g, 0, 0.03, 0.95);
      tip.rotation.x = Math.PI / 2;
      muzzleZ = 1.02;
      tube(0.045, 0.045, 0.3, Mats.chrome(), g, 0, 0.15, -0.2);
      const stock = m(rbox(0.12, 0.18, 0.3, 0.05), Mats.plastic(0x9fb8c8), g, 0, -0.04, -0.52);
      stock.rotation.x = 0.12;
      for (const z of [-0.35, 0.05]) m(cone(0.02, 0.08, 6), Mats.glass(), g, 0, -0.12, z).rotation.x = Math.PI;
      grip(g, 0x9fb8c8, -0.22, -0.17);
      break;
    }
    case 'yule': {
      // the launcher tube is a yule log, bark and all
      tube(0.13, 0.13, 0.95, Mats.bark(), g, 0, 0.05, -0.45);
      const end = m(cyl(0.125, 0.125, 0.01, 20), Mats.wood(), g, 0, 0.05, 0.505);
      end.rotation.x = Math.PI / 2;
      ring(0.135, 0.02, Mats.glow(def.glow, 2.5), g, 0, 0.05, 0.5);
      muzzleZ = 0.55;
      // bark rings and a holly sprig instead of a snow pile
      for (const z of [-0.3, 0.1]) ring(0.14, 0.018, Mats.wood(), g, 0, 0.05, z);
      holly(g, 0.02, 0.19, 0.15, 1.4);
      bow(g, 0, 0.05, -0.5, 0xc8162a, 1.5);
      tube(0.04, 0.04, 0.22, Mats.gold(), g, 0.15, 0.13, -0.1);
      grip(g, 0x1d9a55, -0.02, -0.22);
      m(rbox(0.09, 0.2, 0.1, 0.04), Mats.plastic(0x1d9a55), g, 0, -0.18, 0.2);
      break;
    }
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, def.id === 'yule' ? 0.05 : 0.02, muzzleZ);
  g.add(muzzle);
  return { group: g, muzzle };
}

// ------------------------------------------------------------------ runtime

interface Ball {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  def: WeaponDef;
  /** Guards / robber ids this shot has already frozen (shotgun pellets, piercing rounds). */
  hit: Set<Guard | number>;
  /** Another robber's shot: only for show, it can't freeze anything here. */
  visual: boolean;
}

/** Network index of a weapon (NET_WEAPONS order). */
export function netIndex(def: WeaponDef) {
  return NET_WEAPONS.findIndex((w) => w.id === def.id);
}

export interface Pickup {
  def: WeaponDef;
  ammo: number;
  spot: THREE.Vector3;
  root: THREE.Group;
  glow: THREE.Mesh;
  taken: boolean;
}

export interface ArsenalHooks {
  hitGuard: (g: Guard, dir: THREE.Vector3, at: THREE.Vector3, def: WeaponDef) => void;
  hitWorld: (at: THREE.Vector3, def: WeaponDef) => void;
  burst: (at: THREE.Vector3, def: WeaponDef) => void;
  /** A snowball reached another robber (shared world). */
  hitPlayer?: (id: number, dir: THREE.Vector3, at: THREE.Vector3, def: WeaponDef) => void;
}

export class Arsenal {
  readonly pickups: Pickup[] = [];
  /** Weapon in hand (null = unarmed). */
  held: WeaponDef | null = null;
  ammo = 0;
  private heldModels = new Map<string, { group: THREE.Group; muzzle: THREE.Object3D }>();
  private cool = 0;
  private t = 0;
  private balls: Ball[] = [];
  private ballGeo = sphere(1, 12, 10);
  private ballMats = new Map<number, THREE.Material>();
  private tmp = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  /** debug: what the last snowball struck */
  lastHit = '';

  constructor(
    private physics: Physics,
    private scene: THREE.Scene,
    seed: number,
    private hand: THREE.Object3D,
  ) {
    const rnd = mulberry32(Math.floor(seed) || 1);
    for (const def of WEAPONS) {
      const s = def.spots[Math.floor(rnd() * def.spots.length) % def.spots.length];
      this.pickups.push(this.makePickup(def, WEAPON_AMMO, new THREE.Vector3(...s)));
    }
  }

  private makePickup(def: WeaponDef, ammo: number, spot: THREE.Vector3): Pickup {
    const root = new THREE.Group();
    const a = buildWeapon(def);
    a.group.scale.setScalar(1.5 * K);
    root.add(a.group);
    root.position.copy(spot).add(new THREE.Vector3(0, 0.85, 0));
    this.scene.add(root);
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.9, 32), Mats.glow(def.glow, 1.6));
    glow.rotation.x = -Math.PI / 2;
    glow.position.copy(spot).add(new THREE.Vector3(0, 0.04, 0));
    glow.userData.noAO = true;
    this.scene.add(glow);
    return { def, ammo, spot, root, glow, taken: false };
  }

  /** The pickup on the given display stage (1-10), if it is still lying there. */
  pickupForStage(stage: number) {
    return this.pickups.find((p) => !p.taken && p.def.stage === stage) ?? null;
  }

  /** Closest untaken pickup within reach of the robber's feet. */
  nearby(feet: THREE.Vector3) {
    let best: Pickup | null = null;
    let bd = 1.5;
    for (const p of this.pickups) {
      if (p.taken || Math.abs(feet.y - p.spot.y) > 2) continue;
      const d = Math.hypot(feet.x - p.spot.x, feet.z - p.spot.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Should walking onto it take it straight away (empty-handed or out of ammo)? */
  get wantsAny() {
    return !this.held || this.ammo <= 0;
  }

  /** Take a pickup; a loaded weapon in hand is dropped in its place. */
  take(p: Pickup) {
    p.taken = true;
    p.root.visible = false;
    p.glow.visible = false;
    if (this.held && this.ammo > 0) this.pickups.push(this.makePickup(this.held, this.ammo, p.spot.clone()));
    this.held = p.def;
    this.ammo = p.ammo;
    this.cool = 0.25;
    for (const [id, mdl] of this.heldModels) mdl.group.visible = id === p.def.id;
    let mdl = this.heldModels.get(p.def.id);
    if (!mdl) {
      mdl = buildWeapon(p.def);
      mdl.group.position.set(0.5, 0.95, 0.25);
      this.hand.add(mdl.group);
      this.heldModels.set(p.def.id, mdl);
    }
    mdl.group.visible = true;
  }

  get armed() {
    return !!this.held && this.ammo > 0;
  }

  get canFire() {
    return this.armed && this.cool <= 0;
  }

  get auto() {
    return !!this.held?.auto;
  }

  private ballMat(hex: number) {
    let mt = this.ballMats.get(hex);
    if (!mt) {
      mt = hex === 0xffffff ? Mats.snowCap() : new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.35, roughness: 0.6 });
      this.ballMats.set(hex, mt);
    }
    return mt;
  }

  /** Fire towards a world-space aim point. Returns the muzzle position. */
  fire(aim: THREE.Vector3) {
    const def = this.held!;
    this.cool = def.cooldown;
    this.ammo--;
    const mdl = this.heldModels.get(def.id)!;
    const from = mdl.muzzle.getWorldPosition(new THREE.Vector3());
    const base = new THREE.Vector3().copy(aim).sub(from);
    if (base.lengthSq() < 0.01) base.set(0, 0, 1);
    base.normalize();
    this.lastDir.copy(base);
    this.spawnBalls(def, from, base, false);
    if (this.ammo <= 0) {
      // the empty gun is tossed aside
      mdl.group.visible = false;
    }
    return from;
  }

  /** Direction of the last shot (for the network). */
  readonly lastDir = new THREE.Vector3();

  /** Shows another robber's shot. */
  fireVisual(w: number, from: THREE.Vector3, dir: THREE.Vector3) {
    const def = WEAPONS.find((d) => d.id === NET_WEAPONS[w]?.id);
    if (!def) return null;
    this.spawnBalls(def, from, dir.clone().normalize(), true);
    return def;
  }

  private spawnBalls(def: WeaponDef, from: THREE.Vector3, base: THREE.Vector3, visual: boolean) {
    const side = new THREE.Vector3(0, 1, 0).cross(base).normalize();
    const up = base.clone().cross(side).normalize();
    const hit = new Set<Guard | number>();
    for (let i = 0; i < def.pellets; i++) {
      const dir = base.clone();
      if (def.spread > 0) {
        const a = Math.random() * Math.PI * 2;
        const r = def.spread * (def.pellets > 1 ? Math.sqrt((i + Math.random()) / def.pellets) : Math.random());
        dir.addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      }
      const mesh = new THREE.Mesh(this.ballGeo, this.ballMat(def.tint));
      mesh.scale.setScalar(def.size);
      mesh.castShadow = true;
      mesh.position.copy(from);
      this.scene.add(mesh);
      this.balls.push({ mesh, pos: from.clone(), vel: dir.multiplyScalar(def.speed), life: def.life, def, hit, visual });
    }
  }

  update(dt: number, guards: Guard[], player: THREE.Vector3, hooks: ArsenalHooks, robbers: RemoteTarget[] = []) {
    this.t += dt;
    this.cool -= dt;
    for (const p of this.pickups) {
      if (p.taken) continue;
      const near = Math.abs(p.spot.x - player.x) + Math.abs(p.spot.z - player.z) < 60;
      p.root.visible = near;
      p.glow.visible = near;
      if (!near) continue;
      p.root.rotation.y += dt * 1.6;
      p.root.position.y = p.spot.y + 0.85 + Math.sin(this.t * 2.4 + p.spot.x) * 0.15;
      p.glow.scale.setScalar(1 + Math.sin(this.t * 3 + p.spot.z) * 0.12);
    }
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.life -= dt;
      b.vel.y -= b.def.gravity * dt;
      const step = b.vel.clone().multiplyScalar(dt);
      const len = step.length();
      let done = b.life <= 0;
      let impact: THREE.Vector3 | null = done ? b.pos.clone() : null;
      if (!done && !b.visual && hooks.hitPlayer) {
        for (const r of robbers) {
          if (r.frozen || b.hit.has(r.id)) continue;
          const t = Math.max(0, Math.min(1, this.tmp.copy(r.pos).sub(b.pos).dot(step) / Math.max(1e-6, len * len)));
          const closest = b.pos.clone().addScaledVector(step, t);
          if (closest.distanceTo(r.pos) < b.def.reach * 0.85) {
            this.lastHit = 'robber';
            b.hit.add(r.id);
            hooks.hitPlayer(r.id, b.vel.clone().setY(0).normalize(), closest, b.def);
            if (!b.def.pierce) {
              done = true;
              impact = closest;
              break;
            }
          }
        }
      }
      if (!done && !b.visual) {
        for (const g of guards) {
          if (b.hit.has(g)) continue;
          const c = this.tmpC.set(g.pos.x, g.pos.y + 0.8 * K, g.pos.z);
          const t = Math.max(0, Math.min(1, this.tmp.copy(c).sub(b.pos).dot(step) / Math.max(1e-6, len * len)));
          const closest = b.pos.clone().addScaledVector(step, t);
          if (closest.distanceTo(c) < b.def.reach) {
            this.lastHit = 'guard';
            b.hit.add(g);
            hooks.hitGuard(g, b.vel.clone().setY(0).normalize(), closest, b.def);
            if (!b.def.pierce) {
              done = true;
              impact = closest;
              break;
            }
          }
        }
      }
      if (!done) {
        const toi = this.physics.rayWorld(b.pos, step.clone().normalize(), len, G.WORLD);
        if (toi !== null) {
          impact = b.pos.clone().addScaledVector(step.clone().normalize(), toi);
          this.lastHit = 'world@' + impact.toArray().map((v) => v.toFixed(1)).join(',');
          if (!b.visual || b.def.splash <= 0) hooks.hitWorld(impact, b.def);
          done = true;
        }
      }
      if (done) {
        if (b.def.splash > 0 && impact) {
          hooks.burst(impact, b.def);
          if (b.visual) {
            b.mesh.removeFromParent();
            this.balls.splice(i, 1);
            continue;
          }
          if (hooks.hitPlayer) {
            for (const r of robbers) {
              if (r.frozen || b.hit.has(r.id)) continue;
              if (Math.hypot(r.pos.x - impact.x, r.pos.z - impact.z) < b.def.splash && Math.abs(r.pos.y - impact.y) < 3) {
                b.hit.add(r.id);
                hooks.hitPlayer(r.id, new THREE.Vector3(r.pos.x - impact.x, 0, r.pos.z - impact.z).normalize(), r.pos.clone(), b.def);
              }
            }
          }
          for (const g of guards) {
            if (b.hit.has(g)) continue;
            const d = Math.hypot(g.pos.x - impact.x, g.pos.z - impact.z);
            if (d < b.def.splash && Math.abs(g.pos.y - impact.y) < 3) {
              b.hit.add(g);
              const away = new THREE.Vector3(g.pos.x - impact.x, 0, g.pos.z - impact.z);
              if (away.lengthSq() < 1e-4) away.copy(b.vel).setY(0);
              hooks.hitGuard(g, away.normalize(), g.pos.clone().setY(g.pos.y + 0.8), b.def);
            }
          }
        }
        b.mesh.removeFromParent();
        this.balls.splice(i, 1);
        continue;
      }
      b.pos.add(step);
      b.mesh.position.copy(b.pos);
    }
  }

  dispose() {
    for (const b of this.balls) b.mesh.removeFromParent();
    this.balls = [];
    for (const p of this.pickups) {
      p.root.removeFromParent();
      p.glow.removeFromParent();
    }
    for (const mdl of this.heldModels.values()) mdl.group.removeFromParent();
  }
}
