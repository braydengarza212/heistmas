import * as THREE from 'three';
import { TextureLib } from './textures';

/**
 * Shared physically based materials. Sharing instances lets the static
 * geometry batcher merge everything that uses the same material into a
 * single draw call.
 */

const cache = new Map<string, THREE.Material>();

function get<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    m.name = key;
    cache.set(key, m);
  }
  return m;
}

function repeatTex(t: THREE.Texture, rx: number, ry: number) {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

export const Mats = {
  gold: () =>
    get('gold', () => new THREE.MeshPhysicalMaterial({ color: 0xf5bf45, metalness: 1, roughness: 0.3 })),
  goldSatin: () =>
    get('goldSatin', () => new THREE.MeshPhysicalMaterial({ color: 0xe0a93a, metalness: 1, roughness: 0.38 })),
  goldPresent: () =>
    get(
      'goldPresent',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: 0xffc94a,
          metalness: 0.85,
          roughness: 0.18,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
          iridescence: 0.25,
        }),
    ),
  chrome: () => get('chrome', () => new THREE.MeshPhysicalMaterial({ color: 0xe6edf5, metalness: 1, roughness: 0.12 })),
  steel: () =>
    get(
      'steel',
      () => new THREE.MeshPhysicalMaterial({ color: 0xb4bfcc, metalness: 1, roughness: 0.3, map: TextureLib.metalPanels() }),
    ),
  panel: () =>
    get(
      'panel',
      () =>
        new THREE.MeshPhysicalMaterial({ color: 0x55607a, metalness: 0.55, roughness: 0.42, map: TextureLib.metalPanels(), clearcoat: 0.3 }),
    ),
  steelPlain: () => get('steelPlain', () => new THREE.MeshPhysicalMaterial({ color: 0xaab4c0, metalness: 1, roughness: 0.28 })),
  darkMetal: () => get('darkMetal', () => new THREE.MeshPhysicalMaterial({ color: 0x2b2f38, metalness: 0.85, roughness: 0.35 })),
  gunmetal: () => get('gunmetal', () => new THREE.MeshPhysicalMaterial({ color: 0x4a515e, metalness: 0.9, roughness: 0.42 })),
  rubber: () => get('rubber', () => new THREE.MeshStandardMaterial({ color: 0x1b1c21, roughness: 0.85 })),
  blackGloss: () =>
    get('blackGloss', () => new THREE.MeshPhysicalMaterial({ color: 0x111116, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 })),

  marbleFloor: (rx = 4, ry = 4) =>
    get(
      `marbleFloor${rx}x${ry}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          map: repeatTex(TextureLib.marbleChecker(), rx, ry),
          roughness: 0.16,
          clearcoat: 0.8,
          clearcoatRoughness: 0.06,
        }),
    ),
  marbleCream: (rx = 1, ry = 1) =>
    get(
      `marbleCream${rx}x${ry}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          map: repeatTex(TextureLib.marbleCream(), rx, ry),
          roughness: 0.22,
          clearcoat: 0.5,
          clearcoatRoughness: 0.1,
        }),
    ),
  marbleRed: (rx = 1, ry = 1) =>
    get(
      `marbleRed${rx}x${ry}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          map: repeatTex(TextureLib.marbleRed(), rx, ry),
          roughness: 0.18,
          clearcoat: 0.7,
          clearcoatRoughness: 0.08,
        }),
    ),
  wallpaper: (rx = 1, ry = 1) =>
    get(
      `wallpaper${rx}x${ry}`,
      () => new THREE.MeshStandardMaterial({ map: repeatTex(TextureLib.wallpaper(), rx, ry), roughness: 0.7 }),
    ),
  plaster: () => get('plaster', () => new THREE.MeshStandardMaterial({ color: 0xf3eadb, roughness: 0.85 })),
  plasterGreen: () => get('plasterGreen', () => new THREE.MeshStandardMaterial({ color: 0x0f4d3c, roughness: 0.8 })),
  wood: (rx = 1, ry = 1) =>
    get(
      `wood${rx}x${ry}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          map: repeatTex(TextureLib.wood(), rx, ry),
          roughness: 0.35,
          clearcoat: 0.9,
          clearcoatRoughness: 0.15,
        }),
    ),
  velvet: () =>
    get(
      'velvet',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: 0xa3101c,
          roughness: 0.75,
          sheen: 1,
          sheenColor: new THREE.Color(0xff6a6a),
          sheenRoughness: 0.35,
        }),
    ),
  velvetGreen: () =>
    get(
      'velvetGreen',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: 0x0f5a40,
          roughness: 0.75,
          sheen: 1,
          sheenColor: new THREE.Color(0x6fffc4),
          sheenRoughness: 0.4,
        }),
    ),
  carpet: (rx = 1, ry = 1) =>
    get(
      `carpet${rx}x${ry}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          map: repeatTex(TextureLib.carpet(), rx, ry),
          roughness: 0.92,
          sheen: 0.6,
          sheenColor: new THREE.Color(0xff8080),
        }),
    ),
  stone: (rx = 1, ry = 1) =>
    get(
      `stone${rx}x${ry}`,
      () =>
        new THREE.MeshStandardMaterial({
          map: repeatTex(TextureLib.stoneBlocks(), rx, ry),
          normalMap: repeatTex(TextureLib.stoneNormal(), rx, ry),
          normalScale: new THREE.Vector2(0.8, 0.8),
          roughness: 0.82,
        }),
    ),
  brick: (rx = 1, ry = 1) =>
    get(
      `brick${rx}x${ry}`,
      () =>
        new THREE.MeshStandardMaterial({
          map: repeatTex(TextureLib.bricks(), rx, ry),
          normalMap: repeatTex(TextureLib.brickNormal(), rx * 2, ry * 2),
          roughness: 0.88,
        }),
    ),
  snow: (rx = 1, ry = 1) =>
    get(
      `snow${rx}x${ry}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          map: repeatTex(TextureLib.snow(), rx, ry),
          normalMap: repeatTex(TextureLib.snowNormal(), rx * 2, ry * 2),
          normalScale: new THREE.Vector2(0.6, 0.6),
          roughness: 0.62,
          sheen: 0.4,
          sheenColor: new THREE.Color(0xbfdcff),
        }),
    ),
  snowCap: () =>
    get(
      'snowCap',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: 0xf4f8ff,
          roughness: 0.55,
          sheen: 0.6,
          sheenColor: new THREE.Color(0xcfe6ff),
          clearcoat: 0.2,
        }),
    ),
  cobble: (rx = 1, ry = 1) =>
    get(
      `cobble${rx}x${ry}`,
      () => new THREE.MeshStandardMaterial({ map: repeatTex(TextureLib.cobble(), rx, ry), roughness: 0.6 }),
    ),
  pine: () =>
    get(
      'pine',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: 0x17643a,
          roughness: 0.55,
          clearcoat: 0.35,
          clearcoatRoughness: 0.3,
          sheen: 0.5,
          sheenColor: new THREE.Color(0x6dff9e),
        }),
    ),
  pineDark: () =>
    get('pineDark', () => new THREE.MeshPhysicalMaterial({ color: 0x0f4a2b, roughness: 0.6, clearcoat: 0.3 })),
  bark: () => get('bark', () => new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.9 })),
  candy: (rx = 1, ry = 1) =>
    get(
      `candy${rx}x${ry}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          map: repeatTex(TextureLib.candyStripe(), rx, ry),
          roughness: 0.25,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
        }),
    ),
  plastic: (hex: number) =>
    get(
      `plastic${hex.toString(16)}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          color: hex,
          roughness: 0.32,
          clearcoat: 0.8,
          clearcoatRoughness: 0.12,
        }),
    ),
  matte: (hex: number, roughness = 0.75) =>
    get(`matte${hex.toString(16)}_${roughness}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness })),
  gift: (variant: number) =>
    get(
      `gift${variant}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          map: TextureLib.giftWrap(variant),
          roughness: 0.35,
          clearcoat: 0.6,
          clearcoatRoughness: 0.15,
        }),
    ),
  ribbon: (hex: number) =>
    get(
      `ribbon${hex.toString(16)}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          color: hex,
          roughness: 0.25,
          metalness: 0.15,
          clearcoat: 1,
          sheen: 0.6,
          sheenColor: new THREE.Color(0xffffff),
        }),
    ),
  glass: () =>
    get(
      'glass',
      () =>
        new THREE.MeshPhysicalMaterial({
          color: 0xbfe3ff,
          roughness: 0.04,
          metalness: 0,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
    ),
  windowNight: () =>
    get(
      'windowNight',
      () => new THREE.MeshStandardMaterial({ color: 0x0b1a3a, emissive: 0x2a4b8f, emissiveIntensity: 0.6, roughness: 0.1 }),
    ),
  deposit: (rx = 1, ry = 1) =>
    get(
      `deposit${rx}x${ry}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          map: repeatTex(TextureLib.depositBoxes(), rx, ry),
          normalMap: repeatTex(TextureLib.depositNormal(), rx, ry),
          metalness: 0.85,
          roughness: 0.3,
        }),
    ),
  hazard: (rx = 1, ry = 1) =>
    get(`hazard${rx}x${ry}`, () => new THREE.MeshStandardMaterial({ map: repeatTex(TextureLib.hazard(), rx, ry), roughness: 0.5 })),
  burlap: () =>
    get('burlap', () => new THREE.MeshStandardMaterial({ map: TextureLib.burlap(), roughness: 0.95, color: 0xffffff })),

  // ----------------------------------------------------- emissive (bloom)
  glow: (hex: number, intensity = 5) =>
    get(`glow${hex.toString(16)}_${intensity}`, () => {
      // capped so glowing bits bloom softly instead of flaring across the screen
      const c = new THREE.Color(hex).multiplyScalar(Math.min(intensity, 3.4));
      return new THREE.MeshBasicMaterial({ color: c });
    }),
  bulbInstanced: () =>
    get('bulbInstanced', () => new THREE.MeshBasicMaterial({ color: 0xffffff })),
  screen: (seed: number) =>
    get(`screen${seed}`, () => {
      const m = new THREE.MeshBasicMaterial({ map: TextureLib.securityScreen(seed) });
      m.color.setScalar(1.6);
      return m;
    }),
  signMat: (text: string, sub = '') =>
    get(`sign${text}${sub}`, () => {
      const m = new THREE.MeshStandardMaterial({
        map: TextureLib.sign(text, sub),
        emissiveMap: TextureLib.sign(text, sub),
        emissive: 0xffffff,
        emissiveIntensity: 0.9,
        roughness: 0.4,
      });
      return m;
    }),
};

export function disposeMaterialCache() {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}
