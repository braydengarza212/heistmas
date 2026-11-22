import * as THREE from 'three';
import { rbox, cyl, sphere, cone, torus, star3D, fluffySphere } from '../../gfx/geom';
import { Mats } from '../../gfx/materials';
import { BulbField, christmasTree, coinPile, lampPost, lightString, present, wreath, candyCane } from '../../gfx/props';
import { SnowVolume } from '../../gfx/Snow';
import { ParticleSystem } from '../../gfx/Particles';
import { buildSedan } from '../../gfx/vehicles';
import { MovingPlatform, Shutter } from '../objects';
import { SecurityCamera } from '../heistObjects';
import { BouncePad, CoinPress, CrossingTruck, DrawerPiston, Searchlight, SteamVent, Zipline, moltenGoldMaterial, type WallDir } from '../escapeObjects';
import { GetawayVan, PoliceUnit, TireTracks } from '../getaway';
import { BANK } from '../../shared/bankLayout';
import { mulberry32, easeInOutCubic } from '../../core/math';
import { Kit, box3, v3, type DecorFn } from './kit';
import type { LevelData } from './ChristmasBank';
import type { LootManager } from '../Loot';

/**
 * The second half of the heist, after the counting room:
 *   7  Deposit Vaults — a maze of safe-deposit cabinets with punching drawers
 *   8  The Mint       — coin presses over molten gold, then a climb to the roof
 *   9  Rooftops       — gaps, ice, a window-cleaner's gondola, a searchlight helicopter
 *   10 Getaway Street — spike strip, police roadblock, plow traffic, the van
 */

export interface EscapeCtx {
  bulbs: BulbField;
  warm: BulbField;
  decor: DecorFn;
  loot: LootManager;
  q: { snow: number };
}

// =====================================================================
// City textures (procedural, cached)
// =====================================================================

const texCache = new Map<string, THREE.Texture>();
function canvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void, seed = 1, srgb = true) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h, mulberry32(seed));
  t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}
const matCache = new Map<string, THREE.Material>();
function cachedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

const FACADES = [
  { base: [122, 52, 40], mortar: '#4a2a24', trim: '#eadcc2', brick: true },
  { base: [176, 152, 118], mortar: '#7c6a54', trim: '#f4ead8', brick: false },
  { base: [38, 74, 62], mortar: '#1a352c', trim: '#dccc9f', brick: false },
  { base: [88, 94, 116], mortar: '#3c4050', trim: '#e8e8f0', brick: true },
];

/** Facade with 4 floors × 4 windows per 12 m tile; returns colour + emissive (lit windows). */
function facadeMat(v: number) {
  return cachedMat(`facade${v}`, () => {
    const f = FACADES[v % FACADES.length];
    const lit: boolean[] = [];
    const rr = mulberry32(100 + v);
    for (let i = 0; i < 16; i++) lit.push(rr() < 0.5);
    const S = 1024;
    const cell = S / 4;
    const win = (ctx: CanvasRenderingContext2D, emissive: boolean) => {
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++) {
          const x = c * cell + cell * 0.25;
          const y = r * cell + cell * 0.2;
          const w = cell * 0.5;
          const h = cell * 0.62;
          const on = lit[r * 4 + c];
          if (emissive) {
            if (!on) continue;
            const g = ctx.createLinearGradient(x, y, x, y + h);
            g.addColorStop(0, '#ffd890');
            g.addColorStop(1, '#f08a32');
            ctx.fillStyle = g;
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = 'rgba(60,20,10,0.55)';
            ctx.fillRect(x, y, w * 0.18, h);
            ctx.fillRect(x + w * 0.82, y, w * 0.18, h);
            continue;
          }
          ctx.fillStyle = f.trim;
          ctx.fillRect(x - 10, y - 10, w + 20, h + 20);
          ctx.fillStyle = on ? '#f7b257' : '#162036';
          ctx.fillRect(x, y, w, h);
          if (!on) {
            ctx.fillStyle = 'rgba(120,150,210,0.18)';
            ctx.beginPath();
            ctx.moveTo(x, y + h * 0.7);
            ctx.lineTo(x + w * 0.6, y);
            ctx.lineTo(x + w, y);
            ctx.lineTo(x, y + h);
            ctx.fill();
          }
          ctx.fillStyle = f.trim;
          ctx.fillRect(x + w / 2 - 4, y, 8, h);
          ctx.fillRect(x, y + h * 0.45, w, 8);
          ctx.fillRect(x - 16, y + h + 8, w + 32, 14); // sill
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect(x - 16, y + h + 2, w + 32, 7); // snow on the sill
          if ((r + c + v) % 5 === 0) {
            ctx.strokeStyle = '#1f6b3a';
            ctx.lineWidth = 9;
            ctx.beginPath();
            ctx.arc(x + w / 2, y + h * 0.3, 18, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#d31f2b';
            ctx.fillRect(x + w / 2 - 6, y + h * 0.3 + 14, 12, 10);
          }
        }
    };
    const map = canvasTex(`facadeC${v}`, S, S, (ctx, w, h, rnd) => {
      const [r, g, b] = f.base;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, w, h);
      if (f.brick) {
        const rows = 64;
        const bh = h / rows;
        for (let i = 0; i < rows; i++) {
          const off = i % 2 ? 24 : 0;
          for (let x = -48 + off; x < w; x += 48) {
            const k = 0.78 + rnd() * 0.32;
            ctx.fillStyle = `rgb(${Math.floor(r * k)},${Math.floor(g * k)},${Math.floor(b * k)})`;
            ctx.fillRect(x + 2, i * bh + 2, 44, bh - 3);
          }
        }
      } else {
        for (let i = 0; i < 2000; i++) {
          const k = 0.85 + rnd() * 0.25;
          ctx.fillStyle = `rgba(${Math.floor(r * k)},${Math.floor(g * k)},${Math.floor(b * k)},0.5)`;
          ctx.fillRect(rnd() * w, rnd() * h, 6 + rnd() * 20, 2 + rnd() * 6);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        for (let y = 0; y < h; y += cell) ctx.fillRect(0, y + cell - 6, w, 6);
      }
      win(ctx, false);
    }, 200 + v);
    const em = canvasTex(`facadeE${v}`, S, S, (ctx, w, h) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      win(ctx, true);
    }, 300 + v);
    return new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 1.25, roughness: 0.88 });
  });
}

/** Four-lane snowy road; one tile = 14.8 m square, lanes along U. */
function roadMat() {
  return cachedMat('road', () => {
    const map = canvasTex('road', 1024, 1024, (ctx, w, h, rnd) => {
      ctx.fillStyle = '#2b2d32';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const k = rnd();
        ctx.fillStyle = k < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
        ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
      }
      const band = (v: number, thick: number, color: string) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, (1 - v) * h - (thick * h) / 2, w, thick * h);
      };
      // slush between the wheel paths, dark wet tracks
      for (const lane of [0.125, 0.375, 0.625, 0.875]) {
        band(lane, 0.07, 'rgba(160,168,180,0.35)');
        band(lane - 0.058, 0.032, 'rgba(18,19,22,0.65)');
        band(lane + 0.058, 0.032, 'rgba(18,19,22,0.65)');
      }
      // snow piled at the curbs
      const g0 = ctx.createLinearGradient(0, 0, 0, h * 0.09);
      g0.addColorStop(0, 'rgba(236,242,252,0.95)');
      g0.addColorStop(1, 'rgba(236,242,252,0)');
      ctx.fillStyle = g0;
      ctx.fillRect(0, 0, w, h * 0.09);
      const g1 = ctx.createLinearGradient(0, h, 0, h * 0.91);
      g1.addColorStop(0, 'rgba(236,242,252,0.95)');
      g1.addColorStop(1, 'rgba(236,242,252,0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, h * 0.91, w, h * 0.09);
      // markings
      band(0.488, 0.009, '#d6a52a');
      band(0.512, 0.009, '#d6a52a');
      band(0.075, 0.008, 'rgba(235,235,235,0.8)');
      band(0.925, 0.008, 'rgba(235,235,235,0.8)');
      ctx.fillStyle = 'rgba(235,235,235,0.75)';
      for (const v of [0.25, 0.75]) for (let x = 0; x < w; x += 512) ctx.fillRect(x + 40, (1 - v) * h - 4, 210, 8);
      // drifting snow over everything
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(240,245,255,${0.08 + rnd() * 0.16})`;
        ctx.beginPath();
        ctx.ellipse(rnd() * w, rnd() * h, 30 + rnd() * 90, 8 + rnd() * 20, rnd() * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 71);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0.05 });
  });
}

function sidewalkMat() {
  return cachedMat('sidewalk', () => {
    const map = canvasTex('sidewalk', 512, 512, (ctx, w, h, rnd) => {
      ctx.fillStyle = '#9da2aa';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const k = 0.92 + rnd() * 0.1;
          ctx.fillStyle = `rgb(${Math.floor(160 * k)},${Math.floor(165 * k)},${Math.floor(174 * k)})`;
          ctx.fillRect(i * 256 + 4, j * 256 + 4, 248, 248);
        }
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(245,248,255,${0.4 + rnd() * 0.5})`;
        ctx.beginPath();
        ctx.ellipse(rnd() * w, rnd() * h, 20 + rnd() * 60, 10 + rnd() * 30, rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 72);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
  });
}

function shopMat(seed: number) {
  return cachedMat(`shop${seed}`, () => {
    const map = canvasTex(`shop${seed}`, 512, 256, (ctx, w, h, rnd) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ffe2a8');
      g.addColorStop(1, '#e8892f');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // shelves of goods
      const cols = ['#d31f2b', '#1d9a55', '#f2c14e', '#2a6bd7', '#ffffff', '#b04ad8'];
      for (const y of [80, 150, 215]) {
        ctx.fillStyle = 'rgba(90,45,20,0.75)';
        ctx.fillRect(10, y, w - 20, 8);
        for (let x = 20; x < w - 30; x += 18 + rnd() * 16) {
          ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
          const bw = 10 + rnd() * 16;
          const bh = 12 + rnd() * 26;
          ctx.fillRect(x, y - bh, bw, bh);
        }
      }
      // a little tree in the window
      ctx.fillStyle = '#1d6b3a';
      ctx.beginPath();
      ctx.moveTo(w * 0.82, 30);
      ctx.lineTo(w * 0.9, 210);
      ctx.lineTo(w * 0.74, 210);
      ctx.fill();
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = cols[i % cols.length];
        ctx.beginPath();
        ctx.arc(w * 0.76 + rnd() * w * 0.12, 60 + rnd() * 140, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // frost in the corners + mullions
      const fr = ctx.createRadialGradient(0, h, 10, 0, h, 140);
      fr.addColorStop(0, 'rgba(255,255,255,0.75)');
      fr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fr;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(40,24,16,0.9)';
      ctx.fillRect(w / 2 - 4, 0, 8, h);
      ctx.fillStyle = '#ff3d4d';
      ctx.font = 'bold 34px "Titan One", Arial, sans-serif';
      ctx.fillText('OPEN', 24, 44);
    }, 500 + seed);
    const m = new THREE.MeshBasicMaterial({ map });
    m.color.setScalar(1.35);
    return m;
  });
}

function billboardMat() {
  return cachedMat('billboard', () => {
    const map = canvasTex('billboard', 1024, 384, (ctx, w, h) => {
      ctx.fillStyle = '#0d1430';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#f2c14e';
      ctx.lineWidth = 10;
      ctx.strokeRect(14, 14, w - 28, h - 28);
      for (let x = 30; x < w - 20; x += 34)
        for (const y of [14, h - 14]) {
          ctx.fillStyle = (x / 34) % 2 < 1 ? '#ff5a6a' : '#7dffb0';
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.fill();
        }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#ff2a6a';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#ffd6e4';
      ctx.font = 'bold 128px "Titan One", "Arial Black", sans-serif';
      ctx.fillText('HAPPY HEISTMAS', w / 2, h * 0.45);
      ctx.shadowColor = '#2affb0';
      ctx.fillStyle = '#d4fff0';
      ctx.font = 'bold 44px "Titan One", Arial, sans-serif';
      ctx.fillText("★  SEASON'S STEALINGS  ★", w / 2, h * 0.78);
    }, 9);
    const m = new THREE.MeshBasicMaterial({ map });
    m.color.setScalar(1.8);
    return m;
  });
}

function iceMat() {
  return cachedMat('ice', () => new THREE.MeshPhysicalMaterial({ color: 0xcfe9ff, roughness: 0.05, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 }));
}

// =====================================================================
// Shared helpers
// =====================================================================

/** Low wall along a roof edge, with an invisible fence above it. */
function parapet(k: Kit, x0: number, z0: number, x1: number, z1: number, top: number) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = Math.max(0.4, Math.abs(x1 - x0));
  const d = Math.max(0.4, Math.abs(z1 - z0));
  k.block(cx, top + 0.4, cz, w, 0.8, d, Mats.stone(1, 1), { tile: 2 });
  k.rblock(cx, top + 0.84, cz, w + 0.08, 0.1, d + 0.08, Mats.snowCap(), 0.04, { cast: false });
  k.barrier(cx, top + 2.6, cz, w, 3.6, d);
}

/** Roof edge you can step over (gaps you are meant to jump). */
function lip(k: Kit, x: number, z0: number, z1: number, top: number) {
  k.rblock(x, top + 0.12, (z0 + z1) / 2, 0.3, 0.24, Math.abs(z1 - z0), Mats.stone(1, 1), 0.04, { col: true });
  k.rblock(x, top + 0.26, (z0 + z1) / 2, 0.34, 0.06, Math.abs(z1 - z0), Mats.snowCap(), 0.03, { cast: false });
}

/** City block: facade box, cornice and a snowy roof. */
function building(k: Kit, x0: number, x1: number, z0: number, z1: number, h: number, v: number, base = -0.1) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const w = Math.abs(x1 - x0);
  const d = Math.abs(z1 - z0);
  k.block(cx, (h + base) / 2, cz, w, h - base, d, facadeMat(v), { tile: 12 });
  k.rblock(cx, h - 0.18, cz, w + 0.34, 0.36, d + 0.34, Mats.stone(1, 1), 0.06);
  k.block(cx, h + 0.02, cz, w, 0.04, d, Mats.snow(1, 1), { col: false, cast: false, tile: 6 });
}

const SHOPS = ['TOY WORKSHOP', 'GINGERBREAD BAKERY', 'CANDY CANE CO.', 'COCOA CAFE', 'ORNAMENT EMPORIUM', 'MITTENS & MORE', 'SLEIGH REPAIR', 'FROSTY FLOWERS', 'NUTCRACKER TAILOR', 'SNOW GLOBES', 'PINE & CO.', 'JINGLE BELL MUSIC', 'POLAR PHARMACY', 'NORTH POLE TIMES'];

/** Lit shop window with frame, striped awning and sign, on a facade facing ±z. */
function shop(k: Kit, x: number, zFace: number, facing: 1 | -1, w: number, idx: number) {
  const rot = facing > 0 ? 0 : Math.PI;
  const win = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.1), shopMat(idx % 6));
  win.position.set(x, 1.4, zFace + facing * 0.03);
  win.rotation.y = rot;
  k.prop(win, x, 1.4, zFace + facing * 0.03, rot);
  k.rblock(x, 1.4, zFace + facing * 0.05, w + 0.3, 2.42, 0.1, Mats.wood(), 0.03);
  k.rblock(x, 0.3, zFace + facing * 0.12, w + 0.36, 0.3, 0.24, Mats.stone(1, 1), 0.03);
  const aw = new THREE.Mesh(rbox(w + 0.5, 0.1, 1.5, 0.04), Mats.candy(w / 1.2, 1));
  aw.castShadow = true;
  aw.rotation.x = facing * 0.32;
  k.prop(aw, x, 3.05, zFace + facing * 0.72, 0);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w * 0.85, 5.5), 0.62), Mats.signMat(SHOPS[idx % SHOPS.length]));
  k.prop(sign, x, 3.75, zFace + facing * 0.04, rot);
}

/** Simple railing (posts + top rail) with a collider. */
function railing(k: Kit, x0: number, z0: number, x1: number, z1: number, y: number, h = 1.0) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  k.rblock(cx, y + h, cz, alongX ? len : 0.07, 0.07, alongX ? 0.07 : len, Mats.hazard(len / 0.6, 1), 0.03);
  k.rblock(cx, y + h * 0.5, cz, alongX ? len : 0.04, 0.04, alongX ? 0.04 : len, Mats.darkMetal(), 0.02);
  const n = Math.max(1, Math.round(len / 1.6));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    k.rblock(x0 + (x1 - x0) * t, y + h / 2, z0 + (z1 - z0) * t, 0.06, h, 0.06, Mats.darkMetal(), 0.02);
  }
  k.collider(cx, y + h / 2, cz, alongX ? len : 0.12, h, alongX ? 0.12 : len);
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// =====================================================================
// Entry point
// =====================================================================

export function buildEscapeStages(k: Kit, d: LevelData, c: EscapeCtx) {
  buildDeposit(k, d, c);
  buildMint(k, d, c);
  buildRooftops(k, d, c);
  buildStreet(k, d, c);
}

// =====================================================================
// STAGE 7 — DEPOSIT VAULTS
// =====================================================================
function buildDeposit(k: Kit, d: LevelData, c: EscapeCtx) {
  const dep = Mats.deposit(1, 1);
  const { loot, decor } = c;
  // ---- shell (x 41.2 … 73.2, z −96 … −122)
  k.block(57.2, -0.4, -109, 32.2, 0.8, 26.2, Mats.marbleFloor(1, 1), { tile: 4 });
  k.block(57.8, 7.3, -109, 33.4, 0.6, 27.4, Mats.plaster(), { cast: false });
  k.block(57.8, 3.5, -95.4, 33.4, 7, 1.2, dep, { tile: 2.4 });
  k.block(57.8, 3.5, -122.6, 33.4, 7, 1.2, dep, { tile: 2.4 });
  // the counting room's wall is brick on this side: face it with deposit boxes
  k.block(41.27, 3.5, -116.5, 0.12, 7, 11, dep, { tile: 2.4, col: false });
  k.block(41.27, 3.5, -101.5, 0.12, 7, 11, dep, { tile: 2.4, col: false });
  k.block(41.27, 5.6, -109, 0.12, 2.8, 4, dep, { tile: 2.4, col: false });
  // east wall with the door to the mint
  k.block(73.8, 3.5, -116.5, 1.2, 7, 11, dep, { tile: 2.4 });
  k.block(73.8, 3.5, -101.5, 1.2, 7, 11, dep, { tile: 2.4 });
  k.block(73.8, 5.6, -109, 1.2, 2.8, 4, dep, { tile: 2.4 });
  for (const z of [-111.15, -106.85]) k.rblock(73.1, 2.15, z, 0.3, 4.3, 0.3, Mats.gold(), 0.06);
  k.rblock(73.1, 4.35, -109, 0.3, 0.3, 4.6, Mats.gold(), 0.06);
  d.shutters.push(new Shutter(k.physics, k.root, v3(73.8, 0, -109), 4, 4, Math.PI / 2, 1.1));
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), Mats.signMat('TO THE MINT'));
  exitSign.position.set(73.12, 5.0, -109);
  exitSign.rotation.y = -Math.PI / 2;
  k.live(exitSign);

  // ---- cabinet maze (2.8 m tall deposit-box walls)
  const cab = (x: number, z: number, w: number, dd: number, h = 2.8) => {
    k.block(x, h / 2, z, w, h, dd, dep, { tile: 2.4 });
    k.rblock(x, h + 0.06, z, w + 0.08, 0.12, dd + 0.08, Mats.gold(), 0.04);
    k.rblock(x, 0.06, z, w + 0.06, 0.12, dd + 0.06, Mats.darkMetal(), 0.03, { cast: false });
  };
  cab(46.4, -109, 0.8, 17.2); // V1 — splits the route north / south
  cab(49.2, -101.2, 4.8, 0.8); // HN (doorway at x 51.6 … 54.4)
  cab(60.2, -101.2, 11.6, 0.8);
  cab(52.7, -116.8, 11.8, 0.8); // HS (doorway at x 58.6 … 61.4)
  cab(63.7, -116.8, 4.6, 0.8);
  cab(66.4, -109, 0.8, 16.4); // V2
  cab(53.0, -107.5, 3.2, 2.0); // islands in the box room
  cab(59.6, -110.8, 3.2, 2.0);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.0), Mats.signMat('SAFE DEPOSIT VAULTS', 'BOXES 1 – 4000 · KEYHOLDERS ONLY'));
  sign.position.set(45.95, 2.0, -109);
  sign.rotation.y = -Math.PI / 2;
  k.live(sign);
  for (const z of [-104.5, -113.5]) k.prop(wreath(0.5), 45.96, 2.1, z, -Math.PI / 2);

  // ---- punching drawers
  const drawer = (x: number, y: number, z: number, dir: WallDir, w: number, h: number, reach: number, period: number, offset: number) => {
    const dp = new DrawerPiston(k.physics, k.root, v3(x, y, z), dir, { width: w, height: h, reach, period, offset });
    d.movers.push(dp);
  };
  // north corridor: the drawer gauntlet (fast route)
  drawer(49.0, 0, -96.0, 'z-', 1.6, 1.9, 3.3, 3.4, 0.0);
  drawer(56.5, 1.05, -100.8, 'z+', 1.8, 0.9, 4.75, 3.0, 0.7); // high — slide under
  drawer(60.2, 0, -96.0, 'z-', 1.6, 0.85, 4.75, 2.8, 1.6); // low — jump over
  drawer(63.8, 0, -100.8, 'z+', 1.6, 1.9, 3.3, 3.2, 2.2);
  // south corridor (guarded route)
  drawer(51.0, 0, -122.0, 'z+', 1.6, 0.85, 4.75, 3.6, 0.3);
  drawer(62.5, 0, -117.2, 'z-', 1.6, 1.9, 3.2, 3.6, 2.0);
  // exit chamber: weave between them
  drawer(66.8, 0, -103.4, 'x+', 1.6, 1.9, 4.0, 3.0, 0.4);
  drawer(73.2, 0, -105.6, 'x-', 1.4, 1.9, 4.0, 3.0, 1.9);
  drawer(66.8, 0, -114.6, 'x+', 1.6, 1.9, 4.0, 3.0, 1.2);
  drawer(73.2, 0, -112.4, 'x-', 1.4, 1.9, 4.0, 3.0, 2.6);

  // ---- guards + cameras
  d.guards.push({ name: 'deposit-south', route: [v3(48.4, 0, -119.6), v3(65.2, 0, -119.6)], zone: box3(46.9, -1, -121.9, 66.7, 4, -117.4), wait: 1.4 });
  d.guards.push({
    name: 'deposit-boxroom',
    route: [v3(48.6, 0, -103.6), v3(64.6, 0, -103.6), v3(64.6, 0, -114.4), v3(48.6, 0, -114.4)],
    zone: box3(46.9, -1, -116.3, 65.9, 4, -101.7),
    wait: 0.8,
  });
  d.cameras.push(new SecurityCamera(k.root, v3(44.0, 4.4, -96.7), v3(44, 0, -103.5), v3(44, 0, -115), 4.6, 2.0));
  d.cameras.push(new SecurityCamera(k.root, v3(56.0, 3.8, -121.6), v3(49, 0, -119.6), v3(64, 0, -119.6), 5.2, 2.0));

  // ---- loot: the risky gauntlet hides a diamond, the box room is full of goodies
  loot.place('cash', v3(42.6, 0.95, -99.6));
  loot.place('cash', v3(43.4, 0.95, -99.6));
  k.rblock(43.0, 0.45, -99.6, 1.6, 0.9, 1.0, Mats.gunmetal(), 0.05, { col: true });
  loot.place('diamond', v3(65.3, 0, -98.4));
  loot.place('moneyBag', v3(55.8, 0, -120.6));
  loot.place('moneyBag', v3(48.0, 0, -121.0));
  // display table with gold
  k.rblock(62.9, 0.5, -106.0, 2.2, 1.0, 1.2, Mats.velvetGreen(), 0.06, { col: true });
  loot.place('goldBar', v3(62.4, 1.0, -106.0), 0.2);
  loot.place('goldBar', v3(63.4, 1.0, -106.0), -0.2);
  loot.place('diamond', v3(53.0, 2.86, -107.5));
  loot.place('present', v3(49.6, 0, -112.0));
  loot.place('cash', v3(57.0, 0, -104.6));
  loot.place('cash', v3(57.0, 0, -113.8));
  loot.place('cocoa', v3(70.4, 0, -97.8));
  decor('giftTower', 47.6, 0, -115.2);
  decor('goldPile', 64.6, 0, -115.2);
  // open boxes spilling cash (decor)
  for (const [x, z, s] of [
    [55.2, -102.25, 1],
    [61.0, -116.05, -1],
    [47.2, -112.0, 1],
  ] as const) {
    k.rblock(x, 1.6, z + s * 0.25, 0.5, 0.36, 0.5, Mats.steelPlain(), 0.03);
    k.rblock(x, 1.82, z + s * 0.25, 0.42, 0.08, 0.42, Mats.matte(0x3f8f4f, 0.6), 0.02);
  }
  // ceiling light strips
  const strip = Mats.glow(0xdfe7ff, 1.35);
  for (const z of [-98.4, -119.6]) k.rblock(56.8, 6.96, z, 18, 0.06, 0.16, strip, 0.02, { cast: false });
  for (const x of [50, 56.5, 63]) k.rblock(x, 6.96, -109, 0.16, 0.06, 10, strip, 0.02, { cast: false });
  k.rblock(70, 6.96, -109, 0.16, 0.06, 22, strip, 0.02, { cast: false });
  const tree = christmasTree(2.4, { bulbs: c.bulbs, seed: 23, star: true, at: v3(43.2, 0, -120.2) });
  k.prop(tree, 43.2, 0, -120.2);
  k.physics.cylinder(43.2, 1, -120.2, 0.7, 2);
}

// =====================================================================
// STAGE 8 — THE MINT
// =====================================================================
function buildMint(k: Kit, d: LevelData, c: EscapeCtx) {
  const brick = Mats.brick(1, 1);
  const steel = Mats.steel();
  const { loot, decor } = c;
  // ---- walls (from the pit floor up to the roof)
  k.block(93.4, 5.4, -91.4, 40.2, 16, 1.2, brick, { tile: 3 });
  k.block(93.4, 5.4, -126.6, 40.2, 16, 1.2, brick, { tile: 3 });
  k.block(113.0, 5.4, -109, 1.2, 16, 36.4, brick, { tile: 3 });
  k.block(73.8, 10.15, -109, 1.2, 6.5, 36.4, brick, { tile: 3 });
  k.block(73.8, 2.25, -124.1, 1.2, 9.7, 4.2, brick, { tile: 3 });
  k.block(73.8, 2.25, -93.9, 1.2, 9.7, 4.2, brick, { tile: 3 });
  k.block(73.8, -1.7, -109, 1.2, 3.4, 34.4, brick, { tile: 3 }); // threshold under the doorway
  for (const [z, len] of [
    [-116.5, 11],
    [-101.5, 11],
  ] as const)
    k.block(74.36, 3.5, z, 0.12, 7, len, brick, { tile: 3, col: false });
  k.block(74.36, 5.6, -109, 0.12, 2.8, 4, brick, { tile: 3, col: false });
  // ---- roof slab with a hatch over the last bounce pad (x 95.8 … 99.4, z −97.3 … −93.7)
  const roofPiece = (x0: number, x1: number, z0: number, z1: number) => {
    const w = x1 - x0;
    const dd = Math.abs(z1 - z0);
    k.block((x0 + x1) / 2, 13.7, (z0 + z1) / 2, w, 0.6, dd, Mats.darkMetal(), {});
    k.block((x0 + x1) / 2, 14.02, (z0 + z1) / 2, w, 0.04, dd, Mats.snow(1, 1), { tile: 6, col: false, cast: false });
  };
  roofPiece(73.2, 95.8, -127.2, -90.8);
  roofPiece(99.4, 113.6, -127.2, -90.8);
  roofPiece(95.8, 99.4, -127.2, -97.3);
  roofPiece(95.8, 99.4, -93.7, -90.8);
  // ---- floors: entry dock, climb landing, the pit
  k.block(76.4, -1.3, -109, 4.0, 2.6, 34, steel, { tile: 3 });
  k.block(108.4, -1.3, -109, 8.0, 2.6, 34, steel, { tile: 3 });
  k.block(91.4, -2.8, -109, 26, 0.8, 34, Mats.darkMetal(), { cast: false });
  railing(k, 78.3, -92.2, 78.3, -107.2, 0);
  railing(k, 78.3, -110.8, 78.3, -125.8, 0);
  railing(k, 104.5, -92.2, 104.5, -105.8, 0);
  railing(k, 104.5, -112.2, 104.5, -125.8, 0);
  for (const z of [-100, -118]) {
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.6), Mats.signMat('DANGER', 'MOLTEN GOLD'));
    warn.position.set(78.42, 1.35, z);
    warn.rotation.y = Math.PI / 2;
    k.live(warn);
  }
  // ---- molten gold
  const goldMat = moltenGoldMaterial();
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(26, 34, 40, 52), goldMat);
  lava.rotation.x = -Math.PI / 2;
  lava.position.set(91.4, -1.15, -109);
  lava.userData.noAO = true;
  k.live(lava);
  d.animated.push((t) => (goldMat.uniforms.uTime.value = t));
  d.fallZones.push({ box: box3(78.4, -8, -126, 104.4, -0.55, -92), title: 'MELTED!', label: 'Into the molten gold' });
  // crucible pouring a stream of gold into the pit
  const cru = new THREE.Group();
  mesh(cyl(1.4, 1.0, 1.8, 24, true), Mats.darkMetal(), cru, 0, 0, 0);
  mesh(cyl(1.25, 1.25, 0.1, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.75, 0.15) }), cru, 0, 0.75, 0, false);
  cru.position.set(96.5, 10.2, -93.2);
  cru.rotation.z = -0.5;
  k.live(cru);
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 11.0, 12, 8, true), goldMat);
  stream.position.set(97.2, 4.55, -93.6);
  stream.userData.noAO = true;
  k.live(stream);
  for (const s of [-1, 1]) k.rblock(96.5 + s * 1.7, 11.7, -92.6, 0.3, 3.4, 0.3, Mats.hazard(1, 4), 0.04);
  k.rblock(96.5, 13.0, -92.6, 3.8, 0.3, 0.4, Mats.darkMetal(), 0.05);
  d.fxHooks.push((t, _dt, fx) => {
    if (Math.random() < 0.35) fx.glints.emit(v3(97.2, -1.0, -93.6), { count: 2, color: [0xffc84a, 0xff7a1a], speed: 3, up: 3, size: 0.25, life: 0.6, gravity: 9 });
    if (Math.random() < 0.08) fx.glints.emit(v3(80 + Math.random() * 24, -1.0, -94 - Math.random() * 30), { count: 3, color: [0xffd27a, 0xff8a2a], speed: 1.5, up: 2.5, size: 0.2, life: 1.2, gravity: -0.5 });
    void t;
  });

  // ---- press line: a bridge under three coin presses
  k.block(84.7, -0.3, -109, 12.6, 0.6, 3.0, steel, { tile: 2 });
  for (const z of [-107.55, -110.45]) k.rblock(84.7, 0.012, z, 12.6, 0.02, 0.12, Mats.hazard(12, 1), 0.005, { cast: false });
  for (const x of [80.0, 83.4, 87.0, 90.4]) k.cylinder(x, -1.5, -109, 0.28, 2.4, Mats.darkMetal());
  [81.6, 85.2, 88.8].forEach((x, i) => {
    const p = new CoinPress(k.physics, k.root, v3(x, 0, -109), { radius: 1.25, rise: 3.0, period: 2.6, offset: i * 0.85, span: 2.7 });
    d.movers.push(p);
    d.rideables.push(p);
  });
  // ---- foundry: a gold pillar, then a gold-bar raft gliding to the landing
  k.cylinder(94.2, -1.4, -109, 1.5, 2.8, Mats.gold(), { col: true });
  const rim = new THREE.Mesh(torus(1.5, 0.06, 8, 48), Mats.goldSatin());
  rim.rotation.x = Math.PI / 2;
  k.prop(rim, 94.2, -0.04, -109);
  loot.place('goldBar', v3(94.2, 0, -108.5), 0.4);
  loot.place('goldBar', v3(94.2, 0, -109.6), -0.3);
  const raft = new THREE.Group();
  mesh(rbox(3.0, 0.5, 2.6, 0.12), Mats.gold(), raft, 0, 0, 0);
  const stamp = mesh(star3D(0.6, 0.26, 0.04), Mats.goldSatin(), raft, 0, 0.26, 0);
  stamp.rotation.x = -Math.PI / 2;
  d.platforms.push(new MovingPlatform(k.physics, k.live(raft), v3(1.5, 0.25, 1.3), (t, out) => out.set(99.5 + Math.sin(t * 1.25) * 2.1, -0.25, -109)));

  // ---- climb: bounce pad → catwalk with steam → hoist → upper catwalk → pad through the hatch
  d.pads.push(new BouncePad(k.physics, k.root, v3(107.6, 0, -109), 17.5));
  k.block(111.0, 4.075, -109.5, 2.8, 0.25, 25, Mats.panel(), { tile: 2 }); // C1 (z −97 … −122)
  railing(k, 109.65, -97.2, 109.65, -105.6, 4.2);
  railing(k, 109.65, -112.6, 109.65, -121.8, 4.2);
  for (const z of [-99, -110, -121]) k.cylinder(111.0, 2.0, z, 0.16, 4.0, Mats.darkMetal(), { col: true });
  for (const [z, off] of [
    [-103.0, 0.0],
    [-99.8, 1.5],
  ] as const) {
    const sv = new SteamVent(k.root, v3(111.0, 4.2, z), { radius: 0.75, height: 3.6, period: 3.0, offset: off, burst: 1.1 });
    d.movers.push(sv);
  }
  // freight hoist between the catwalks
  const hoist = new THREE.Group();
  mesh(rbox(2.6, 0.2, 2.6, 0.05), Mats.panel(), hoist, 0, 0, 0);
  for (const [x, z] of [
    [-1.25, -1.25],
    [1.25, -1.25],
    [1.25, 1.25],
    [-1.25, 1.25],
  ])
    mesh(rbox(0.08, 2.3, 0.08, 0.02), Mats.darkMetal(), hoist, x, 1.2, z);
  mesh(rbox(2.6, 0.1, 2.6, 0.03), Mats.darkMetal(), hoist, 0, 2.35, 0);
  const hoistPath = (t: number, out: THREE.Vector3) => {
    const T = 6.0;
    const ph = ((t % T) + T) % T;
    const kk = ph < 1.3 ? 0 : ph < 3.0 ? easeInOutCubic((ph - 1.3) / 1.7) : ph < 4.3 ? 1 : 1 - easeInOutCubic((ph - 4.3) / 1.7);
    out.set(111.0, 4.1 + kk * 4.4, -95.5);
  };
  const hoistPlat = new MovingPlatform(k.physics, k.live(hoist), v3(1.3, 0.1, 1.3), hoistPath);
  hoistPlat.addSolid(-1.25, 1.2, -1.25, 0.1, 2.3, 0.1);
  hoistPlat.addSolid(-1.25, 1.2, 1.25, 0.1, 2.3, 0.1);
  d.platforms.push(hoistPlat);
  const cable = new THREE.Mesh(cyl(0.03, 0.03, 1, 6), Mats.darkMetal());
  k.live(cable);
  d.animated.push(() => {
    const y = hoist.position.y + 2.4;
    cable.position.set(111.0, (y + 13.4) / 2, -95.5);
    cable.scale.y = Math.max(0.1, 13.4 - y);
  });
  k.block(102.8, 8.475, -95.5, 13.6, 0.25, 2.6, Mats.panel(), { tile: 2 }); // C2 (x 96 … 109.6)
  railing(k, 96.1, -94.15, 109.6, -94.15, 8.6);
  railing(k, 96.1, -96.85, 109.6, -96.85, 8.6);
  for (const x of [97, 101.5, 106]) k.rblock(x, 11.0, -95.5, 0.05, 4.8, 0.05, Mats.darkMetal(), 0.01);
  d.pads.push(new BouncePad(k.physics, k.root, v3(97.6, 8.6, -95.5), 20.5, 1.0, true));
  const hatch = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.55), Mats.signMat('ROOF HATCH ↑'));
  hatch.position.set(97.6, 12.4, -92.05);
  k.live(hatch);
  // ---- guards + camera
  d.guards.push({ name: 'mint-floor', route: [v3(105.4, 0, -100), v3(105.4, 0, -120)], zone: box3(104.7, -1, -125.6, 112.2, 3.5, -92.4), wait: 1.0 });
  d.guards.push({ name: 'catwalk', route: [v3(99.6, 8.6, -95.5), v3(108.8, 8.6, -95.5)], zone: box3(96.3, 7.6, -96.6, 109.5, 12.5, -94.4), elite: true, wait: 1.1 });
  d.cameras.push(new SecurityCamera(k.root, v3(105.0, 6.4, -125.4), v3(108, 0, -104), v3(108, 0, -114), 5, 2.0));
  // ---- loot + decor
  loot.place('moneyBag', v3(76.0, 0, -95.5));
  loot.place('moneyBag', v3(76.0, 0, -122.5));
  loot.place('present', v3(110.5, 0, -124.5));
  loot.place('diamond', v3(111.0, 4.2, -107.0));
  loot.place('goldPresent', v3(103.0, 8.6, -95.5));
  loot.place('cocoa', v3(111.4, 0, -93.6));
  decor('goldPile', 110.4, 0, -100.5);
  decor('goldPile', 106.2, 0, -124.2);
  const pile = coinPile(1.6, 1.2, 140, 11);
  pile.position.set(76.4, 0, -100);
  k.live(pile);
  k.physics.cylinder(76.4, 0.6, -100, 1.3, 1.2);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 1.4), Mats.signMat('NORTH POLE MINT', 'EST. 1823 · COINS FOR GOOD CHILDREN'));
  sign.position.set(74.45, 6.0, -109);
  sign.rotation.y = Math.PI / 2;
  k.live(sign);
  // giant gear on the north wall
  const gear = new THREE.Group();
  mesh(torus(2.2, 0.3, 12, 40), Mats.gunmetal(), gear, 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const sp = mesh(rbox(4.2, 0.3, 0.2, 0.05), Mats.gunmetal(), gear, 0, 0, 0);
    sp.rotation.z = (i / 6) * Math.PI;
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    mesh(rbox(0.5, 0.5, 0.36, 0.05), Mats.gunmetal(), gear, Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0).rotation.z = a;
  }
  gear.position.set(86, 7.5, -92.25);
  k.live(gear);
  d.animated.push((_t, dt) => (gear.rotation.z += dt * 0.4));
  // pipes along the walls + hanging lamps over the pit
  for (const y of [9.5, 10.3]) {
    const pipe = new THREE.Mesh(cyl(0.18, 0.18, 30, 14), Mats.steelPlain());
    pipe.rotation.x = Math.PI / 2;
    k.prop(pipe, 112.1, y, -109);
  }
  for (const x of [82, 90, 98])
    for (const z of [-101, -117]) {
      const lamp = new THREE.Group();
      mesh(cone(0.7, 0.5, 20), Mats.plastic(0x1d9a55), lamp, 0, 0, 0);
      mesh(sphere(0.22, 12, 10), Mats.glow(0xfff0d0, 5), lamp, 0, -0.24, 0, false);
      mesh(cyl(0.02, 0.02, 3.4, 6), Mats.darkMetal(), lamp, 0, 1.9, 0);
      k.prop(lamp, x, 9.8, z);
    }
}

// =====================================================================
// STAGE 9 — ROOFTOPS
// =====================================================================
function buildRooftops(k: Kit, d: LevelData, c: EscapeCtx) {
  const { loot } = c;
  // ---- R0: the mint roof (top 14.0)
  parapet(k, 73.2, -91.0, 113.6, -91.0, 14);
  parapet(k, 73.2, -127.0, 113.6, -127.0, 14);
  parapet(k, 73.4, -127.2, 73.4, -90.8, 14);
  lip(k, 113.45, -126.8, -91.2, 14);
  // hatch curb + broken skylight frame around the opening
  for (const [x, z, w, dd] of [
    [97.6, -93.55, 3.9, 0.3],
    [97.6, -97.45, 3.9, 0.3],
    [95.65, -95.5, 0.3, 3.6],
    [99.55, -95.5, 0.3, 3.6],
  ] as const)
    k.rblock(x, 14.15, z, w, 0.3, dd, Mats.darkMetal(), 0.05, { col: true });
  const pane = new THREE.Mesh(rbox(1.7, 0.05, 3.4, 0.02), Mats.glass());
  pane.rotation.z = 1.1;
  k.solidProp(pane, 95.1, 14.85, -95.5);
  // glowing skylights over the pit, water tower, air-con units
  for (const z of [-101, -117]) k.rblock(86, 14.06, z, 7, 0.1, 3.6, Mats.glow(0xff9a3a, 1.6), 0.03, { cast: false });
  const tower = new THREE.Group();
  for (const [x, z] of [
    [-1.4, -1.4],
    [1.4, -1.4],
    [1.4, 1.4],
    [-1.4, 1.4],
  ])
    mesh(cyl(0.12, 0.14, 3.2, 8), Mats.darkMetal(), tower, x, 1.6, z);
  mesh(cyl(2.1, 2.1, 3.0, 24), Mats.wood(), tower, 0, 4.7, 0);
  mesh(cone(2.3, 1.2, 24), Mats.darkMetal(), tower, 0, 6.8, 0);
  const tsnow = mesh(fluffySphere(1.8, 0.05, 2), Mats.snowCap(), tower, 0, 6.9, 0);
  tsnow.scale.set(1, 0.35, 1);
  k.prop(tower, 80.5, 14, -120);
  k.physics.cylinder(80.5, 18.7, -120, 2.1, 3);
  for (const [x, z] of [
    [-1.4, -1.4],
    [1.4, -1.4],
    [1.4, 1.4],
    [-1.4, 1.4],
  ])
    k.physics.cylinder(80.5 + x, 15.6, -120 + z, 0.14, 3.2);
  const acUnit = (x: number, y: number, z: number, rot = 0) => {
    k.rblock(x, y + 0.65, z, 2.0, 1.3, 1.4, Mats.steelPlain(), 0.06, { col: true, rotY: rot });
    const fan = new THREE.Mesh(cyl(0.5, 0.5, 0.06, 20), Mats.darkMetal());
    k.prop(fan, x, y + 1.33, z, rot);
    k.rblock(x, y + 1.36, z, 2.04, 0.08, 1.44, Mats.snowCap(), 0.03, { rotY: rot });
  };
  acUnit(88, 14, -108);
  acUnit(108, 14, -125.4);
  acUnit(124.5, 12.8, -97.5);
  acUnit(146, 15.4, -125.8, 0.0);
  // R0 guard (elite: lockdown on the roof)
  d.guards.push({
    name: 'roof0',
    route: [v3(104.5, 14, -106), v3(111.6, 14, -106), v3(111.6, 14, -123), v3(104.5, 14, -123)],
    zone: box3(103, 13, -126.6, 113.2, 17.5, -97.6),
    elite: true,
    wait: 1.0,
  });
  loot.place('moneyBag', v3(90, 14, -96));

  // ---- gap 1 (alley) + R1 (top 12.8) with an icy patch
  d.fallZones.push({ box: box3(113.6, -3, -132, 117.0, 10.6, -86), title: 'WHOOPS!', label: 'Fell off the roof' });
  k.block(115.3, -0.05, -109, 3.4, 0.1, 40, Mats.snow(1, 1), { tile: 6 });
  building(k, 117, 131, -94, -127.2, 12.8, 0);
  parapet(k, 117, -94.2, 131, -94.2, 12.8);
  parapet(k, 117, -127.0, 131, -127.0, 12.8);
  lip(k, 117.15, -126.8, -94.4, 12.8);
  lip(k, 130.85, -126.8, -94.4, 12.8);
  const ice = k.block(124, 12.81, -110.5, 9.0, 0.06, 14, iceMat(), { tile: 4 });
  if (ice) k.physics.tag(ice, { kind: 'ice' });
  const iceSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), Mats.signMat('ICY!'));
  iceSign.position.set(119.0, 13.6, -102.6);
  iceSign.rotation.y = Math.PI / 2;
  k.live(iceSign);
  k.rblock(119.0, 13.2, -102.6, 0.08, 0.8, 0.08, Mats.darkMetal(), 0.02);
  for (const [x, z] of [
    [121, -99.5],
    [128, -121.5],
  ]) {
    k.block(x, 13.9, z, 1.2, 2.2, 1.2, Mats.brick(1, 1), { tile: 1.5 });
    k.rblock(x, 15.05, z, 1.4, 0.12, 1.4, Mats.snowCap(), 0.04);
    d.fxHooks.push((_t, _dt, fx) => {
      if (Math.random() < 0.08) fx.soft.emit(v3(x, 15.2, z), { count: 1, color: 0x8a8f99, kind: 'puff', speed: 0.6, up: 1.2, size: 1.6, life: 2.2, gravity: -0.4, drag: 0.6 });
    });
  }
  d.guards.push({
    name: 'roof1',
    route: [v3(119, 12.8, -98.6), v3(129.4, 12.8, -98.6), v3(129.4, 12.8, -123), v3(119, 12.8, -123)],
    zone: box3(117.4, 11.5, -126.6, 130.6, 16, -94.6),
    wait: 1.0,
  });
  loot.place('present', v3(128.6, 12.8, -111));

  // ---- gap 2: window-cleaner's gondola up to R2 (top 15.4)
  d.fallZones.push({ box: box3(131, -3, -132, 136.4, 11.4, -86), title: 'WHOOPS!', label: 'Fell off the roof' });
  k.block(133.7, -0.05, -109, 5.4, 0.1, 40, Mats.snow(1, 1), { tile: 6 });
  const gondola = new THREE.Group();
  mesh(rbox(2.4, 0.22, 3.2, 0.05), Mats.panel(), gondola, 0, 0, 0);
  for (const s of [-1, 1]) {
    mesh(rbox(2.4, 0.07, 0.07, 0.02), Mats.hazard(4, 1), gondola, 0, 1.05, s * 1.56);
    mesh(rbox(2.4, 0.05, 0.05, 0.02), Mats.darkMetal(), gondola, 0, 0.55, s * 1.56);
    for (const x of [-1.15, 0, 1.15]) mesh(rbox(0.06, 1.05, 0.06, 0.02), Mats.darkMetal(), gondola, x, 0.55, s * 1.56);
  }
  mesh(rbox(0.5, 0.6, 0.4, 0.05), Mats.plastic(0x1d6b46), gondola, 0, 0.42, 1.25);
  const gp = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.35), Mats.signMat('SPARKLE WINDOW CO.'));
  gp.position.set(0, 0.6, 1.62);
  gondola.add(gp);
  const gondolaPath = (t: number, out: THREE.Vector3) => {
    const T = 5.6;
    const ph = ((t % T) + T) % T;
    const kk = ph < 1.2 ? 0 : ph < 2.8 ? easeInOutCubic((ph - 1.2) / 1.6) : ph < 4.0 ? 1 : 1 - easeInOutCubic((ph - 4.0) / 1.6);
    out.set(133.7, 12.8 - 0.11 + kk * 2.6, -111);
  };
  const gondolaPlat = new MovingPlatform(k.physics, k.live(gondola), v3(1.2, 0.11, 1.6), gondolaPath);
  for (const s of [-1, 1]) gondolaPlat.addSolid(0, 0.6, s * 1.56, 2.4, 1.0, 0.1);
  d.platforms.push(gondolaPlat);
  const davit = new THREE.Group();
  mesh(rbox(0.25, 4.0, 0.25, 0.04), Mats.darkMetal(), davit, 0, 2.0, 0);
  mesh(rbox(3.2, 0.22, 0.22, 0.04), Mats.darkMetal(), davit, -1.5, 3.9, 0);
  k.prop(davit, 136.9, 15.4, -111);
  k.physics.box(136.9, 17.4, -111, 0.3, 4, 0.3);
  const ropes: THREE.Mesh[] = [];
  for (const z of [-112.4, -109.6]) {
    const r = new THREE.Mesh(cyl(0.02, 0.02, 1, 5), Mats.darkMetal());
    k.live(r);
    ropes.push(r);
    d.animated.push(() => {
      const y0 = gondola.position.y + 1.05;
      const y1 = 19.3;
      r.position.set(133.7, (y0 + y1) / 2, z);
      r.scale.y = Math.max(0.1, y1 - y0);
    });
  }

  // ---- R2: billboard roof (checkpoint, two guards, camera)
  building(k, 136.4, 152, -97, -127.2, 15.4, 1);
  parapet(k, 136.4, -97.2, 152, -97.2, 15.4);
  parapet(k, 136.4, -127.0, 152, -127.0, 15.4);
  lip(k, 151.85, -126.8, -97.4, 15.4);
  for (const x of [138.6, 149.4]) {
    k.block(x, 18.6, -98.6, 0.3, 6.4, 0.3, Mats.darkMetal(), {});
  }
  k.rblock(144, 21.9, -98.6, 11.6, 0.25, 0.4, Mats.darkMetal(), 0.04);
  const bb = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.1), billboardMat());
  bb.position.set(144, 19.7, -98.38);
  bb.rotation.y = Math.PI;
  k.live(bb);
  const bbBack = new THREE.Mesh(rbox(11.2, 4.3, 0.12, 0.03), Mats.darkMetal());
  k.prop(bbBack, 144, 19.7, -98.6);
  const roofTree = christmasTree(3.6, { bulbs: c.bulbs, seed: 41, star: true, snow: true, at: v3(139.2, 15.4, -124.4) });
  k.prop(roofTree, 139.2, 15.4, -124.4);
  k.physics.cylinder(139.2, 16.4, -124.4, 0.9, 2);
  d.guards.push({ name: 'roof2', route: [v3(139.6, 15.4, -101.6), v3(150.4, 15.4, -101.6)], zone: box3(136.8, 14.4, -126.8, 151.6, 19, -97.6), wait: 1.2 });
  d.guards.push({
    name: 'roof2-elite',
    route: [v3(146.4, 15.4, -124.4), v3(150.6, 15.4, -116), v3(146.4, 15.4, -107.5)],
    zone: box3(142.2, 14.4, -126.8, 151.6, 19, -97.6),
    elite: true,
    wait: 0.9,
  });
  d.cameras.push(new SecurityCamera(k.root, v3(149.3, 18.4, -99.0), v3(145.5, 15.4, -108), v3(145.5, 15.4, -121), 5.4, 2.2));
  loot.place('goldBar', v3(150.6, 15.4, -125.6));
  loot.place('cocoa', v3(137.4, 15.4, -99.2));

  // ---- gap 3: chimney hop (a lower building between R2 and R3)
  d.fallZones.push({ box: box3(152, -3, -132, 160.8, 13.4, -86), title: 'WHOOPS!', label: 'Fell off the roof' });
  building(k, 152, 160.8, -98, -127.2, 9.0, 2);
  for (const [x, z, steam] of [
    [154.6, -110.6, false],
    [157.9, -112.3, true],
  ] as const) {
    k.block(x, 12.2, z, 1.4, 6.4, 1.4, Mats.brick(1, 1), { tile: 1.5 });
    k.rblock(x, 15.45, z, 1.6, 0.1, 1.6, Mats.stone(1, 1), 0.03, { col: true });
    if (steam) d.movers.push(new SteamVent(k.root, v3(x, 15.5, z), { radius: 0.55, height: 3.0, period: 3.4, offset: 0.4, burst: 1.0 }));
  }

  // ---- R3: the zipline platform
  building(k, 160.8, 172, -104, -127.2, 15.4, 3);
  parapet(k, 160.8, -104.2, 172, -104.2, 15.4);
  parapet(k, 160.8, -127.0, 170.2, -127.0, 15.4);
  lip(k, 160.95, -126.8, -104.4, 15.4);
  d.fallZones.push({ box: box3(158, -3, -138, 178, 9.5, -127.2), title: 'WHOOPS!', label: 'Fell off the roof' });
  const zs = v3(172.5, 15.4 + 2.05, -127.9);
  const ze = v3(191.5, 0.25 + 2.05, -140.5);
  const grabAt = v3(171.0, 15.4, -126.2);
  d.zips.push(new Zipline(k.root, zs, ze, 2.05, grabAt));
  const frame = new THREE.Group();
  for (const s of [-1, 1]) {
    const leg = mesh(rbox(0.16, 3.1, 0.16, 0.03), Mats.hazard(1, 5), frame, s * 0.7, 1.5, 0);
    leg.rotation.z = -s * 0.2;
  }
  mesh(rbox(1.8, 0.2, 0.25, 0.04), Mats.darkMetal(), frame, 0, 2.95, 0);
  k.prop(frame, 171.6, 15.4, -126.9, -0.6);
  for (const s of [-1, 1]) k.physics.box(171.6 + Math.cos(-0.6) * s * 0.7, 16.9, -126.9 - Math.sin(-0.6) * s * 0.7, 0.2, 3, 0.2);
  const zsign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), Mats.signMat('ZIPLINE → GETAWAY'));
  zsign.position.set(170.6, 17.0, -125.4);
  zsign.rotation.y = -Math.PI / 2 + 0.3;
  k.live(zsign);
  const ring = new THREE.Mesh(torus(1.2, 0.06, 8, 40), Mats.glow(0x6dffa8, 3));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(grabAt.x, 15.45, grabAt.z);
  k.live(ring);
  d.animated.push((t) => ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08));
  const endPole = new THREE.Group();
  mesh(cyl(0.12, 0.16, 3.0, 12), Mats.darkMetal(), endPole, 0, 1.5, 0);
  mesh(rbox(0.5, 0.3, 0.3, 0.05), Mats.plastic(0xd31f2b), endPole, 0, 2.95, 0);
  k.prop(endPole, 192.6, 0, -141.3);
  k.physics.cylinder(192.6, 1.5, -141.3, 0.16, 3);
  d.guards.push({ name: 'roof3', route: [v3(162.5, 15.4, -107), v3(169.5, 15.4, -107), v3(169.5, 15.4, -118), v3(162.5, 15.4, -118)], zone: box3(161.2, 14.4, -124, 171.6, 19, -104.6), wait: 0.8 });

  // ---- helicopter searchlight sweeping the roofs
  const heli = new Searchlight(k.root, { center: v3(138, 0, -111), rx: 26, rz: 13, height: 33, area: box3(96, 0, -126, 171, 30, -96) });
  d.searchlights.push(heli);
  const s = new SnowVolume(v3(72, 10, -132), v3(176, 36, -86), 2600 * c.q.snow);
  k.live(s.points);
  d.snow.push(s);
}

// =====================================================================
// STAGE 10 — GETAWAY STREET
// =====================================================================
function buildStreet(k: Kit, d: LevelData, c: EscapeCtx) {
  const { loot } = c;
  // ---- road + sidewalks (main street runs along x at z −139)
  k.block(200, -0.25, -139, 280, 0.5, 14.8, roadMat(), { tile: 14.8 });
  const walk = (x0: number, x1: number, z: number) => {
    k.block((x0 + x1) / 2, -0.175, z, x1 - x0, 0.65, 4.4, sidewalkMat(), { tile: 3 });
    const cz = z > -139 ? z - 2.15 : z + 2.15;
    k.block((x0 + x1) / 2, -0.02, cz, x1 - x0, 0.36, 0.22, Mats.stone(1, 1), { tile: 2, col: false });
  };
  walk(60, 212, -129.4);
  walk(222, 340, -129.4);
  walk(60, 212, -148.6);
  walk(222, 300, -148.6);
  walk(312, 340, -148.6);
  // side streets
  k.block(217, -0.25, -93.6, 67.2, 0.5, 10, roadMat(), { tile: 10, rotY: Math.PI / 2 });
  k.block(217, -0.25, -185.4, 69.2, 0.5, 10, roadMat(), { tile: 10, rotY: Math.PI / 2 });
  k.block(306, -0.25, -195.4, 89.2, 0.5, 12, roadMat(), { tile: 12, rotY: Math.PI / 2 });
  // crosswalks
  for (const x of [210.6, 223.4])
    for (let z = -132.4; z > -146; z -= 1.1) k.rblock(x, 0.008, z, 2.2, 0.012, 0.55, Mats.matte(0xe8ecf2, 0.6), 0.004, { cast: false });

  // ---- buildings lining the street
  const north: [number, number, number, number][] = [
    [172, 190, 18.2, 0],
    [190, 212, 14.0, 1],
    [222, 242, 20.0, 2],
    [242, 262, 15.5, 3],
    [262, 282, 22.0, 0],
    [282, 300, 16.0, 1],
    [300, 340, 19.0, 2],
  ];
  for (const [x0, x1, h, v] of north) building(k, x0, x1, -100, -127.2, h, v);
  const south: [number, number, number, number][] = [
    [60, 85, 16, 2],
    [85, 110, 21, 3],
    [110, 130, 14, 0],
    [130, 150, 18, 1],
    [150, 172, 24, 2],
    [172, 195, 15, 3],
    [195, 212, 19, 0],
    [222, 245, 17, 1],
    [245, 270, 23, 2],
    [270, 300, 15, 3],
    [312, 340, 18, 0],
  ];
  for (const [x0, x1, h, v] of south) building(k, x0, x1, -150.8, -174, h, v);
  // the van's escape route: buildings along the far side street
  building(k, 300, 312, -240, -260, 20, 1);
  building(k, 290, 300, -174, -240, 14, 2);
  building(k, 312, 330, -174, -240, 17, 3);
  // shop fronts
  let shopIdx = 0;
  const shopsOn = (x0: number, x1: number, zFace: number, facing: 1 | -1) => {
    const n = Math.max(1, Math.floor((x1 - x0) / 7.5));
    const span = (x1 - x0) / n;
    for (let i = 0; i < n; i++) shop(k, x0 + span * (i + 0.5), zFace, facing, Math.min(5, span - 1.6), shopIdx++);
  };
  for (const [x0, x1] of [
    [117, 131],
    [136.4, 152],
    [152, 160.8],
    [160.8, 172],
  ] as const)
    shopsOn(x0, x1, -127.2, -1);
  for (const [x0, x1] of north) shopsOn(x0, x1, -127.2, -1);
  for (const [x0, x1] of south) shopsOn(x0, x1, -150.8, 1);
  const mintSign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.8), Mats.signMat('NORTH POLE MINT', 'VISITORS WELCOME · 9 TO 5'));
  mintSign.position.set(93, 5.5, -127.25);
  mintSign.rotation.y = Math.PI;
  k.live(mintSign);

  // ---- street furniture
  for (let x = 178; x < 336; x += 16) {
    for (const z of [-131.0, -147.0]) {
      if (x > 209 && x < 225) continue;
      if (z < -140 && x > 296 && x < 316) continue;
      const g = new THREE.Group();
      lampPost(g, x, 0.15, z, 4.8);
      k.prop(g, 0, 0, 0);
      k.physics.cylinder(x, 2.4, z, 0.14, 4.8);
    }
  }
  for (let x = 176; x < 300; x += 12) lightString(v3(x, 7.6, -127.5), v3(x + 6, 7.6, -150.5), 1.4, k.root, c.bulbs, 0.5);
  // snowbanks along the curbs
  const rnd = mulberry32(77);
  for (let x = 62; x < 338; x += 3.2 + rnd() * 3) {
    if (x > 209 && x < 225) continue;
    for (const z of [-131.2, -146.8]) {
      if (z < -140 && x > 296 && x < 316) continue;
      if (rnd() < 0.45) continue;
      const bank = new THREE.Mesh(fluffySphere(1, 0.08, Math.floor(rnd() * 50)), Mats.snowCap());
      bank.scale.set(1.2 + rnd(), 0.35 + rnd() * 0.25, 0.55);
      bank.receiveShadow = true;
      k.solidProp(bank, x, 0.12, z, 0, 1, 0.7);
    }
  }
  // parked cars (static), well clear of the play area and the escape route
  const carCols = [0x7a1a24, 0x1f3b6b, 0xd9d5c9, 0x2c5e3f, 0x51545c, 0xb87a1c];
  let ci = 0;
  for (const [x, z, rot] of [
    [140, -133.0, 0],
    [154, -145.2, Math.PI],
    [166, -133.0, 0],
    [244, -133.0, 0],
    [258, -133.0, 0],
    [252, -145.2, Math.PI],
    [272, -145.2, Math.PI],
    [284, -133.0, 0],
    [326, -133.0, 0],
  ] as const) {
    const car = buildSedan(carCols[ci % carCols.length], ci + 3);
    ci++;
    k.prop(car, x, 0, z, rot);
    k.physics.box(x, 0.65, z, 4.9, 1.3, 1.9, rot);
  }
  // hydrants, mailbox, bus shelter, traffic lights
  for (const [x, z] of [
    [186, -130.6],
    [229, -147.6],
    [262, -130.6],
  ]) {
    k.cylinder(x, 0.5, z, 0.16, 0.7, Mats.plastic(0xc8162a), { col: true });
    k.cylinder(x, 0.9, z, 0.12, 0.12, Mats.plastic(0xc8162a));
  }
  k.rblock(201, 0.75, -129.0, 0.6, 1.2, 0.5, Mats.plastic(0x1f4fa8), 0.12, { col: true });
  const shelter = new THREE.Group();
  mesh(rbox(4.0, 0.12, 1.6, 0.04), Mats.darkMetal(), shelter, 0, 2.6, 0);
  mesh(rbox(4.0, 2.4, 0.06, 0.02), Mats.glass(), shelter, 0, 1.35, -0.7);
  for (const x of [-1.9, 1.9]) mesh(rbox(0.1, 2.6, 0.1, 0.02), Mats.darkMetal(), shelter, x, 1.3, -0.7);
  mesh(rbox(4.1, 0.14, 1.7, 0.05), Mats.snowCap(), shelter, 0, 2.72, 0);
  k.prop(shelter, 186, 0.15, -149.0, Math.PI);
  k.physics.box(186, 1.4, -149.7, 4, 2.6, 0.2);
  for (const [x, z, rot] of [
    [211.4, -131.3, 0],
    [222.6, -146.7, Math.PI],
  ] as const) {
    const tl = new THREE.Group();
    mesh(cyl(0.1, 0.12, 5.2, 10), Mats.darkMetal(), tl, 0, 2.6, 0);
    mesh(rbox(0.38, 1.1, 0.36, 0.05), Mats.darkMetal(), tl, 0, 4.6, 0);
    mesh(sphere(0.12, 12, 10), Mats.glow(0xff2a2a, 6), tl, 0, 4.95, -0.18, false);
    mesh(sphere(0.12, 12, 10), Mats.glow(0x3a3010, 1), tl, 0, 4.62, -0.18, false);
    mesh(sphere(0.12, 12, 10), Mats.glow(0x0f3018, 1), tl, 0, 4.29, -0.18, false);
    k.prop(tl, x, 0.15, z, rot);
    k.physics.cylinder(x, 2.6, z, 0.12, 5.2);
  }
  // a big tree on the corner past the van
  const cornerTree = christmasTree(6.5, { bulbs: c.bulbs, seed: 57, star: true, snow: true, at: v3(240, 0.15, -129.6) });
  k.prop(cornerTree, 240, 0.15, -129.6);
  k.physics.cylinder(240, 2, -129.6, 1.2, 4);
  for (const [x, z] of [
    [238, -128.2],
    [241.8, -128.4],
  ]) k.solidProp(present(0.7, 0.6, 0.7, Math.floor(x) % 6), x, 0.15, z);
  k.solidProp(candyCane(1.4), 236.5, 0.15, -128.4);

  // ---- gameplay: spike strip, roadblock, plow traffic, the van
  const sx = 196.6;
  k.rblock(sx, 0.04, -139, 0.5, 0.08, 14.6, Mats.darkMetal(), 0.02, { cast: false });
  for (let z = -131.9; z > -146.3; z -= 0.36)
    for (const o of [-0.12, 0.12]) {
      const spike = new THREE.Mesh(cone(0.05, 0.18, 6), Mats.chrome());
      k.prop(spike, sx + o, 0.17, z);
    }
  d.hazards.push({ id: 2001, box: box3(sx - 0.5, -0.2, -146.4, sx + 0.5, 0.32, -131.6), knock: () => v3(-5.5, 6.5, 0), damage: 1, dropLoot: true, label: 'Spike strip' });
  const barricade = (x: number, z: number, len: number) => {
    k.rblock(x, 0.85, z, 0.12, 0.32, len, Mats.hazard(len / 0.5, 1), 0.03);
    k.rblock(x, 0.4, z, 0.08, 0.8, 0.08, Mats.darkMetal(), 0.02);
    for (const s of [-1, 1]) {
      k.rblock(x, 0.45, z + s * (len / 2 - 0.2), 0.5, 0.9, 0.08, Mats.matte(0xe8ecf2, 0.6), 0.02);
      k.rblock(x, 1.08, z + s * (len / 2 - 0.2), 0.12, 0.14, 0.14, Mats.glow(0xff9a1a, 4), 0.03, { cast: false });
    }
    k.collider(x, 0.55, z, 0.4, 1.1, len);
  };
  barricade(sx, -129.4, 4.3);
  barricade(sx, -148.6, 4.3);
  // roadblock: two cruisers angled across the road, a narrow gap between them
  d.parkedPolice.push(new PoliceUnit(k.root, v3(205.6, 0, -135.8), 0.55, 3));
  d.parkedPolice.push(new PoliceUnit(k.root, v3(206.6, 0, -142.4), -0.5, 4));
  for (const p of d.parkedPolice) {
    const r = p.rig.root;
    const yaw = r.rotation.y;
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    k.physics.box(r.position.x, 0.5, r.position.z, 4.9, 1.0, 1.9, yaw);
    k.physics.box(r.position.x - fx * 0.3, 1.25, r.position.z - fz * 0.3, 2.4, 0.5, 1.7, yaw);
  }
  barricade(206.2, -129.6, 4.6);
  barricade(206.2, -132.2, 1.4);
  barricade(206.2, -145.5, 2.0);
  barricade(206.2, -148.6, 4.3);
  d.guards.push({ name: 'roadblock', route: [v3(203.4, 0, -139.2), v3(209.4, 0, -139.2)], zone: box3(199, -1, -150.6, 211.5, 4, -127.4), elite: true, wait: 0.5 });
  // traffic through the intersection: a plow heading south, a salt truck heading north
  d.trucks.push(new CrossingTruck(k.physics, k.root, { x: 214.6, z0: -104, z1: -182, speed: 10, wait: 1.4, offset: 0, hide: -196 }));
  d.trucks.push(new CrossingTruck(k.physics, k.root, { x: 219.4, z0: -182, z1: -104, speed: 9, wait: 2.2, offset: 3.4, color: 0x2a64c8, hide: -52 }));
  for (const t of d.trucks) d.movers.push(t);
  // invisible bounds of the playable street
  k.barrier(180, 3, -139, 0.4, 8, 24);
  k.barrier(236.6, 3, -139, 0.4, 8, 24);
  k.barrier(217, 3, -126.6, 10, 8, 0.4);
  k.barrier(217, 3, -151.4, 10, 8, 0.4);
  // the getaway van, engine running, rear doors open
  d.getaway = new GetawayVan(k.physics, k.root, v3(...BANK.getaway), 0);
  d.guards.push({ name: 'van', route: [v3(225.6, 0, -133.4), v3(233.4, 0, -133.4)], zone: box3(222.6, -1, -150.6, 236.2, 4, -127.4), wait: 1.2 });
  // the chase (hidden until the getaway)
  d.chasePolice.push(new PoliceUnit(k.root, v3(217.5, 0, -95), -Math.PI / 2, 7));
  d.chasePolice.push(new PoliceUnit(k.root, v3(216.5, 0, -83), -Math.PI / 2, 9));
  for (const p of d.chasePolice) p.rig.root.visible = false;
  // snowbank the second cruiser ends up in
  const crashBank = new THREE.Mesh(fluffySphere(1, 0.1, 31), Mats.snowCap());
  crashBank.scale.set(3.4, 0.9, 1.6);
  k.solidProp(crashBank, 230.5, 0.15, -150.2, 0, 1, 0.7);
  d.tracks = new TireTracks(k.root);
  d.smoke = new ParticleSystem(1400, false);
  k.root.add(d.smoke.points);
  loot.place('cash', v3(190.0, 0, -144.5));
  loot.place('cash', v3(201.5, 0.15, -147.9));
  loot.place('moneyBag', v3(228.0, 0.15, -148.6));
  const s = new SnowVolume(v3(174, 0, -153), v3(262, 24, -125), 2400 * c.q.snow);
  k.live(s.points);
  d.snow.push(s);
}
