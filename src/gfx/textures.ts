import * as THREE from 'three';
import { mulberry32 } from '../core/math';

/**
 * Procedural canvas textures. Everything visible in the game is generated at
 * runtime — no image downloads, no licensing questions.
 */

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;

function canvas(w: number, h: number, draw: Draw, seed = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h, mulberry32(seed));
  return c;
}

/** Cheap fBm: random pixel grids upscaled with smoothing and stacked. */
function fbm(ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, octaves = 5, alpha = 0.5, base = 4) {
  for (let o = 0; o < octaves; o++) {
    const s = base << o;
    const small = document.createElement('canvas');
    small.width = s;
    small.height = s;
    const sc = small.getContext('2d')!;
    const img = sc.createImageData(s, s);
    for (let i = 0; i < s * s; i++) {
      const v = Math.floor(rnd() * 255);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    sc.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalAlpha = alpha / (o + 1);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Tile 3x3 so the noise wraps seamlessly.
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) ctx.drawImage(small, x * w, y * h, w, h);
    ctx.restore();
  }
}

/** Builds a tangent-space normal map from a grayscale height canvas. */
function normalFromHeight(src: HTMLCanvasElement, strength = 2) {
  const w = src.width;
  const h = src.height;
  const sctx = src.getContext('2d')!;
  const data = sctx.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  const H = (x: number, y: number) => data[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = TextureLib.anisotropy;
  t.needsUpdate = true;
  return t;
}

function marbleVeins(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rnd: () => number, color: string, count = 7) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let px = x + rnd() * w;
    let py = y + rnd() * h;
    let ang = rnd() * Math.PI * 2;
    ctx.lineWidth = 0.6 + rnd() * 2.2;
    ctx.globalAlpha = 0.18 + rnd() * 0.35;
    ctx.beginPath();
    ctx.moveTo(px, py);
    const steps = 30 + Math.floor(rnd() * 30);
    for (let s = 0; s < steps; s++) {
      ang += (rnd() - 0.5) * 0.7;
      px += Math.cos(ang) * 6;
      py += Math.sin(ang) * 6;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export class TextureLib {
  static anisotropy = 8;
  private static cache = new Map<string, THREE.Texture>();

  static get(key: string, make: () => THREE.Texture) {
    let t = this.cache.get(key);
    if (!t) {
      t = make();
      this.cache.set(key, t);
    }
    return t;
  }

  /** Emerald + cream checker marble with gold inlay lines. */
  static marbleChecker() {
    return this.get('marbleChecker', () =>
      tex(
        canvas(1024, 1024, (ctx, w, h, rnd) => {
          const n = 4;
          const s = w / n;
          for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) {
              const dark = (i + j) % 2 === 0;
              ctx.fillStyle = dark ? '#0f5a45' : '#f4ead8';
              ctx.fillRect(i * s, j * s, s, s);
              ctx.save();
              ctx.globalAlpha = 0.35;
              const g = ctx.createRadialGradient(i * s + s * rnd(), j * s + s * rnd(), 10, i * s + s / 2, j * s + s / 2, s);
              g.addColorStop(0, dark ? '#1d7a5f' : '#ffffff');
              g.addColorStop(1, dark ? '#0a3f31' : '#e3d4bb');
              ctx.fillStyle = g;
              ctx.fillRect(i * s, j * s, s, s);
              ctx.restore();
              marbleVeins(ctx, i * s, j * s, s, s, rnd, dark ? '#9fe0c6' : '#b9a27c', 6);
            }
          ctx.strokeStyle = '#d6a740';
          ctx.lineWidth = 5;
          for (let i = 0; i <= n; i++) {
            ctx.beginPath();
            ctx.moveTo(i * s, 0);
            ctx.lineTo(i * s, h);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i * s);
            ctx.lineTo(w, i * s);
            ctx.stroke();
          }
          // small diamond inlays at grid crossings
          ctx.fillStyle = '#e8bd52';
          for (let i = 0; i <= n; i++)
            for (let j = 0; j <= n; j++) {
              ctx.save();
              ctx.translate(i * s, j * s);
              ctx.rotate(Math.PI / 4);
              ctx.fillRect(-11, -11, 22, 22);
              ctx.restore();
            }
        }, 11),
      ),
    );
  }

  static marbleCream() {
    return this.get('marbleCream', () =>
      tex(
        canvas(512, 512, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#f3ead9';
          ctx.fillRect(0, 0, w, h);
          fbm(ctx, w, h, rnd, 4, 0.12);
          ctx.fillStyle = 'rgba(243,234,217,0.6)';
          ctx.fillRect(0, 0, w, h);
          marbleVeins(ctx, 0, 0, w, h, rnd, '#b39d78', 10);
        }, 5),
      ),
    );
  }

  static marbleRed() {
    return this.get('marbleRed', () =>
      tex(
        canvas(512, 512, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#8e1620';
          ctx.fillRect(0, 0, w, h);
          fbm(ctx, w, h, rnd, 4, 0.1);
          ctx.fillStyle = 'rgba(142,22,32,0.55)';
          ctx.fillRect(0, 0, w, h);
          marbleVeins(ctx, 0, 0, w, h, rnd, '#f0b3a0', 9);
        }, 9),
      ),
    );
  }

  static carpet() {
    return this.get('carpet', () =>
      tex(
        canvas(512, 512, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#a3121c';
          ctx.fillRect(0, 0, w, h);
          fbm(ctx, w, h, rnd, 3, 0.08, 32);
          ctx.fillStyle = 'rgba(163,18,28,0.75)';
          ctx.fillRect(0, 0, w, h);
          // gold borders along the long edges (u)
          ctx.fillStyle = '#e1b04a';
          ctx.fillRect(0, 0, 26, h);
          ctx.fillRect(w - 26, 0, 26, h);
          ctx.fillStyle = '#7a0c14';
          ctx.fillRect(30, 0, 8, h);
          ctx.fillRect(w - 38, 0, 8, h);
          // diamond motif
          ctx.fillStyle = 'rgba(233,182,74,0.55)';
          for (let y = 32; y < h; y += 128)
            for (let x = 128; x < w - 64; x += 128) {
              ctx.save();
              ctx.translate(x, y + ((x / 128) % 2) * 64);
              ctx.rotate(Math.PI / 4);
              ctx.fillRect(-14, -14, 28, 28);
              ctx.restore();
            }
        }, 3),
      ),
    );
  }

  static wallpaper() {
    return this.get('wallpaper', () =>
      tex(
        canvas(512, 512, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#0d4a3a';
          ctx.fillRect(0, 0, w, h);
          for (let x = 0; x < w; x += 64) {
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(x, 0, 32, h);
            ctx.fillStyle = 'rgba(226,178,80,0.55)';
            ctx.fillRect(x + 31, 0, 2, h);
          }
          ctx.fillStyle = 'rgba(226,178,80,0.5)';
          for (let y = 32; y < h; y += 64)
            for (let x = 0; x < w; x += 64) {
              const ox = x + 16 + ((y / 64) % 2) * 32;
              ctx.save();
              ctx.translate(ox, y);
              ctx.beginPath();
              ctx.moveTo(0, -9);
              ctx.quadraticCurveTo(5, 0, 0, 9);
              ctx.quadraticCurveTo(-5, 0, 0, -9);
              ctx.fill();
              ctx.restore();
            }
          fbm(ctx, w, h, rnd, 3, 0.05, 16);
        }, 4),
      ),
    );
  }

  static wood() {
    return this.get('wood', () =>
      tex(
        canvas(512, 512, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#5a2414';
          ctx.fillRect(0, 0, w, h);
          for (let i = 0; i < 90; i++) {
            const y = rnd() * h;
            ctx.strokeStyle = rnd() > 0.5 ? 'rgba(30,8,4,0.35)' : 'rgba(140,70,40,0.25)';
            ctx.lineWidth = 1 + rnd() * 3;
            ctx.beginPath();
            ctx.moveTo(0, y);
            for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 4 * rnd());
            ctx.stroke();
          }
        }, 8),
      ),
    );
  }

  static stoneBlocks() {
    return this.get('stoneBlocks', () => {
      const c = canvas(512, 512, (ctx, w, h, rnd) => {
        ctx.fillStyle = '#e9dcc4';
        ctx.fillRect(0, 0, w, h);
        fbm(ctx, w, h, rnd, 4, 0.18);
        ctx.fillStyle = 'rgba(233,220,196,0.55)';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#a8977a';
        ctx.lineWidth = 4;
        const rows = 4;
        for (let r = 0; r < rows; r++) {
          const y = (r * h) / rows;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          const off = r % 2 ? w / 4 : 0;
          for (let x = off; x < w + 1; x += w / 2) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + h / rows);
            ctx.stroke();
          }
        }
      }, 21);
      return tex(c);
    });
  }

  static stoneNormal() {
    return this.get('stoneNormal', () => {
      const c = canvas(512, 512, (ctx, w, h, rnd) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        fbm(ctx, w, h, rnd, 4, 0.25);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 7;
        const rows = 4;
        for (let r = 0; r < rows; r++) {
          const y = (r * h) / rows;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
          const off = r % 2 ? w / 4 : 0;
          for (let x = off; x < w + 1; x += w / 2) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + h / rows);
            ctx.stroke();
          }
        }
      }, 21);
      return tex(normalFromHeight(c, 3), false);
    });
  }

  static bricks() {
    return this.get('bricks', () =>
      tex(
        canvas(512, 512, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#5b5552';
          ctx.fillRect(0, 0, w, h);
          const rows = 12;
          const bh = h / rows;
          for (let r = 0; r < rows; r++) {
            const off = r % 2 ? 32 : 0;
            for (let x = -64 + off; x < w; x += 64) {
              const v = 0.75 + rnd() * 0.35;
              ctx.fillStyle = `rgb(${Math.floor(150 * v)},${Math.floor(62 * v)},${Math.floor(48 * v)})`;
              ctx.fillRect(x + 3, r * bh + 3, 58, bh - 6);
            }
          }
          fbm(ctx, w, h, rnd, 3, 0.12, 16);
        }, 33),
      ),
    );
  }

  static brickNormal() {
    return this.get('brickNormal', () => {
      const c = canvas(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        const rows = 12;
        const bh = h / rows;
        ctx.fillStyle = '#fff';
        for (let r = 0; r < rows; r++) {
          const off = r % 2 ? 16 : 0;
          for (let x = -32 + off; x < w; x += 32) ctx.fillRect(x + 2, r * bh + 2, 28, bh - 4);
        }
      });
      return tex(normalFromHeight(c, 1.5), false);
    });
  }

  static snow() {
    return this.get('snow', () =>
      tex(
        canvas(512, 512, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#eef4ff';
          ctx.fillRect(0, 0, w, h);
          fbm(ctx, w, h, rnd, 5, 0.18);
          ctx.fillStyle = 'rgba(238,244,255,0.72)';
          ctx.fillRect(0, 0, w, h);
          for (let i = 0; i < 400; i++) {
            ctx.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.5})`;
            ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
          }
        }, 41),
      ),
    );
  }

  static snowNormal() {
    return this.get('snowNormal', () => {
      const c = canvas(256, 256, (ctx, w, h, rnd) => {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, w, h);
        fbm(ctx, w, h, rnd, 5, 0.6);
      }, 42);
      return tex(normalFromHeight(c, 1.2), false);
    });
  }

  static cobble() {
    return this.get('cobble', () =>
      tex(
        canvas(512, 512, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#3c3a40';
          ctx.fillRect(0, 0, w, h);
          const n = 8;
          const s = w / n;
          for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) {
              const v = 0.7 + rnd() * 0.4;
              ctx.fillStyle = `rgb(${Math.floor(118 * v)},${Math.floor(112 * v)},${Math.floor(120 * v)})`;
              ctx.beginPath();
              ctx.roundRect(i * s + 4 + (j % 2) * (s / 2), j * s + 4, s - 8, s - 8, 12);
              ctx.fill();
              // snow dusting
              ctx.fillStyle = `rgba(240,245,255,${rnd() * 0.5})`;
              ctx.beginPath();
              ctx.roundRect(i * s + 8 + (j % 2) * (s / 2), j * s + 8, (s - 16) * rnd(), (s - 16) * 0.5, 8);
              ctx.fill();
            }
        }, 13),
      ),
    );
  }

  static burlap() {
    return this.get('burlap', () =>
      tex(
        canvas(256, 256, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#9a6b3c';
          ctx.fillRect(0, 0, w, h);
          for (let y = 0; y < h; y += 4) {
            ctx.fillStyle = `rgba(60,35,15,${0.15 + rnd() * 0.2})`;
            ctx.fillRect(0, y, w, 1.5);
          }
          for (let x = 0; x < w; x += 4) {
            ctx.fillStyle = `rgba(200,150,90,${0.12 + rnd() * 0.15})`;
            ctx.fillRect(x, 0, 1.5, h);
          }
          fbm(ctx, w, h, rnd, 3, 0.15, 8);
        }, 17),
      ),
    );
  }

  static candyStripe() {
    return this.get('candy', () =>
      tex(
        canvas(256, 256, (ctx, w, h) => {
          ctx.fillStyle = '#fbf6ef';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#d7192a';
          for (let i = -4; i < 8; i++) {
            ctx.beginPath();
            ctx.moveTo(i * 64, 0);
            ctx.lineTo(i * 64 + 32, 0);
            ctx.lineTo(i * 64 + 32 + w, h);
            ctx.lineTo(i * 64 + w, h);
            ctx.closePath();
            ctx.fill();
          }
        }),
      ),
    );
  }

  static metalPanels() {
    return this.get('metal', () =>
      tex(
        canvas(512, 512, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#8d96a3';
          ctx.fillRect(0, 0, w, h);
          for (let y = 0; y < h; y++) {
            ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.06})`;
            ctx.fillRect(0, y, w, 1);
          }
          ctx.strokeStyle = 'rgba(40,45,55,0.8)';
          ctx.lineWidth = 3;
          ctx.strokeRect(2, 2, w / 2 - 4, h - 4);
          ctx.strokeRect(w / 2 + 2, 2, w / 2 - 4, h - 4);
          ctx.fillStyle = '#5d6570';
          for (const x of [14, w / 2 - 14, w / 2 + 14, w - 14])
            for (let y = 14; y < h; y += 80) {
              ctx.beginPath();
              ctx.arc(x, y, 4, 0, Math.PI * 2);
              ctx.fill();
            }
        }, 23),
      ),
    );
  }

  static belt() {
    return this.get('belt', () =>
      tex(
        canvas(256, 256, (ctx, w, h) => {
          ctx.fillStyle = '#26282d';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#ffc531';
          for (let y = 0; y < h; y += 64) {
            ctx.beginPath();
            ctx.moveTo(w * 0.2, y + 44);
            ctx.lineTo(w * 0.5, y + 14);
            ctx.lineTo(w * 0.8, y + 44);
            ctx.lineTo(w * 0.8, y + 58);
            ctx.lineTo(w * 0.5, y + 28);
            ctx.lineTo(w * 0.2, y + 58);
            ctx.closePath();
            ctx.fill();
          }
          ctx.fillStyle = '#3a3d44';
          for (let y = 0; y < h; y += 16) ctx.fillRect(0, y, w, 3);
        }),
      ),
    );
  }

  static hazard() {
    return this.get('hazard', () =>
      tex(
        canvas(128, 128, (ctx, w, h) => {
          ctx.fillStyle = '#1b1b1f';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#ffc226';
          for (let i = -2; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(i * 64, 0);
            ctx.lineTo(i * 64 + 32, 0);
            ctx.lineTo(i * 64 + 32 + w, h);
            ctx.lineTo(i * 64 + w, h);
            ctx.fill();
          }
        }),
      ),
    );
  }

  static laserGrid() {
    return this.get('laserGrid', () =>
      tex(
        canvas(256, 256, (ctx, w, h) => {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#ff2a3d';
          ctx.lineWidth = 4;
          ctx.strokeRect(0, 0, w, h);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(w / 2, 0);
          ctx.lineTo(w / 2, h);
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();
        }),
      ),
    );
  }

  static depositBoxes() {
    return this.get('deposit', () =>
      tex(
        canvas(512, 512, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#7c5a1c';
          ctx.fillRect(0, 0, w, h);
          const cols = 4;
          const rows = 6;
          const cw = w / cols;
          const rh = h / rows;
          for (let i = 0; i < cols; i++)
            for (let j = 0; j < rows; j++) {
              const g = ctx.createLinearGradient(i * cw, j * rh, i * cw + cw, j * rh + rh);
              g.addColorStop(0, '#f6d57a');
              g.addColorStop(0.5, '#d9a93c');
              g.addColorStop(1, '#a8781f');
              ctx.fillStyle = g;
              ctx.fillRect(i * cw + 5, j * rh + 5, cw - 10, rh - 10);
              ctx.fillStyle = '#5a3e10';
              ctx.beginPath();
              ctx.arc(i * cw + cw * 0.78, j * rh + rh / 2, 7, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = 'rgba(80,50,10,0.8)';
              ctx.fillRect(i * cw + 18, j * rh + rh / 2 - 7, 46, 14);
              ctx.fillStyle = '#f9e5a8';
              ctx.font = 'bold 12px sans-serif';
              ctx.fillText(String(100 + Math.floor(rnd() * 899)), i * cw + 22, j * rh + rh / 2 + 5);
            }
        }, 29),
      ),
    );
  }

  static depositNormal() {
    return this.get('depositNormal', () => {
      const c = canvas(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        const cols = 4;
        const rows = 6;
        const cw = w / cols;
        const rh = h / rows;
        ctx.fillStyle = '#fff';
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) ctx.fillRect(i * cw + 3, j * rh + 3, cw - 6, rh - 6);
      });
      return tex(normalFromHeight(c, 2), false);
    });
  }

  static giftWrap(variant: number) {
    return this.get('gift' + variant, () =>
      tex(
        canvas(256, 256, (ctx, w, h, rnd) => {
          const palettes = [
            ['#d81f2c', '#ffffff'],
            ['#118a5c', '#f4d35e'],
            ['#2a5bd7', '#ffffff'],
            ['#f2c14e', '#d81f2c'],
            ['#7b2cbf', '#ffd6ff'],
            ['#ff7aa2', '#ffffff'],
            ['#0f6e70', '#ffcf5c'],
          ];
          const [bg, fg] = palettes[variant % palettes.length];
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = fg;
          const kind = variant % 3;
          if (kind === 0) {
            for (let y = 16; y < h; y += 42)
              for (let x = 16 + (y % 84 ? 21 : 0); x < w; x += 42) {
                ctx.beginPath();
                ctx.arc(x, y, 7, 0, Math.PI * 2);
                ctx.fill();
              }
          } else if (kind === 1) {
            ctx.globalAlpha = 0.85;
            for (let x = 0; x < w; x += 48) ctx.fillRect(x, 0, 14, h);
          } else {
            for (let i = 0; i < 18; i++) {
              const x = rnd() * w;
              const y = rnd() * h;
              ctx.save();
              ctx.translate(x, y);
              ctx.rotate(rnd());
              ctx.beginPath();
              for (let k = 0; k < 10; k++) {
                const r = k % 2 ? 5 : 12;
                const a = (k / 10) * Math.PI * 2;
                ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
              }
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
          }
        }, 100 + variant),
      ),
    );
  }

  static securityScreen(seed: number) {
    return this.get('screen' + seed, () =>
      tex(
        canvas(256, 160, (ctx, w, h, rnd) => {
          ctx.fillStyle = '#05261d';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#3cffb1';
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 2;
          // fake camera feed: vanishing-point hallway
          ctx.beginPath();
          ctx.moveTo(0, h);
          ctx.lineTo(w * 0.4, h * 0.45);
          ctx.lineTo(w * 0.6, h * 0.45);
          ctx.lineTo(w, h);
          ctx.moveTo(w * 0.4, h * 0.45);
          ctx.lineTo(w * 0.4, 0);
          ctx.moveTo(w * 0.6, h * 0.45);
          ctx.lineTo(w * 0.6, 0);
          ctx.stroke();
          ctx.fillStyle = '#3cffb1';
          ctx.font = 'bold 14px monospace';
          ctx.fillText(`CAM ${String(seed + 1).padStart(2, '0')}`, 10, 20);
          ctx.fillStyle = '#ff4d5e';
          ctx.beginPath();
          ctx.arc(w - 16, 14, 5, 0, Math.PI * 2);
          ctx.fill();
          for (let y = 0; y < h; y += 3) {
            ctx.fillStyle = `rgba(0,0,0,${0.15 + rnd() * 0.1})`;
            ctx.fillRect(0, y, w, 1);
          }
        }, seed),
        true,
        false,
      ),
    );
  }

  static sign(text: string, sub = '') {
    return this.get('sign:' + text + sub, () =>
      tex(
        canvas(1024, 256, (ctx, w, h) => {
          const g = ctx.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, '#0f4c3a');
          g.addColorStop(1, '#072a20');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#e9b949';
          ctx.lineWidth = 10;
          ctx.strokeRect(12, 12, w - 24, h - 24);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${sub ? 92 : 110}px "Titan One", "Arial Black", sans-serif`;
          const tg = ctx.createLinearGradient(0, 40, 0, 190);
          tg.addColorStop(0, '#fff3c4');
          tg.addColorStop(0.5, '#f2c14e');
          tg.addColorStop(1, '#c8871e');
          ctx.fillStyle = tg;
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 8;
          ctx.fillText(text, w / 2, sub ? h * 0.42 : h / 2);
          if (sub) {
            ctx.font = 'bold 38px "Fredoka", sans-serif';
            ctx.fillStyle = '#f7e7b7';
            ctx.fillText(sub, w / 2, h * 0.78);
          }
        }),
        true,
        false,
      ),
    );
  }

  /** Burlap patch with a gold "$" for the loot sack. */
  static sackPatch() {
    return this.get('sackPatch', () =>
      tex(
        canvas(256, 256, (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#e7b740';
          ctx.font = 'bold 190px "Titan One", "Arial Black", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 14;
          ctx.strokeStyle = '#5a3a14';
          ctx.strokeText('$', w / 2, h / 2 + 10);
          ctx.fillText('$', w / 2, h / 2 + 10);
        }),
        true,
        false,
      ),
    );
  }

  static vaultDial() {
    return this.get('vaultDial', () =>
      tex(
        canvas(512, 512, (ctx, w, h) => {
          const cx = w / 2;
          const cy = h / 2;
          const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, w / 2);
          g.addColorStop(0, '#fbe9a8');
          g.addColorStop(1, '#c08a26');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#3d2a0a';
          ctx.fillStyle = '#3d2a0a';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = 'bold 30px sans-serif';
          for (let i = 0; i < 100; i += 2) {
            const a = (i / 100) * Math.PI * 2 - Math.PI / 2;
            const r1 = w * 0.47;
            const r2 = i % 10 === 0 ? w * 0.38 : w * 0.42;
            ctx.lineWidth = i % 10 === 0 ? 6 : 3;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
            ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
            ctx.stroke();
            if (i % 10 === 0) ctx.fillText(String(i), cx + Math.cos(a) * w * 0.31, cy + Math.sin(a) * w * 0.31);
          }
        }),
        true,
        false,
      ),
    );
  }

  static clockFace() {
    return this.get('clock', () =>
      tex(
        canvas(256, 256, (ctx, w, h) => {
          ctx.fillStyle = '#fbf3df';
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#2b1b0b';
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            ctx.save();
            ctx.translate(w / 2 + Math.cos(a) * w * 0.4, h / 2 + Math.sin(a) * h * 0.4);
            ctx.rotate(a);
            ctx.fillRect(-10, -3, 20, 6);
            ctx.restore();
          }
        }),
        true,
        false,
      ),
    );
  }

  /** Soft radial gradient used for glows, light pools and blob shadows. */
  static radial(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
    return this.get('radial' + inner + outer, () =>
      tex(
        canvas(128, 128, (ctx, w, h) => {
          const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
          g.addColorStop(0, inner);
          g.addColorStop(1, outer);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }),
        true,
        false,
      ),
    );
  }

  static extractionRing() {
    return this.get('extraction', () =>
      tex(
        canvas(512, 512, (ctx, w, h) => {
          const cx = w / 2;
          const cy = h / 2;
          ctx.clearRect(0, 0, w, h);
          ctx.strokeStyle = '#7dffb0';
          ctx.lineWidth = 22;
          ctx.beginPath();
          ctx.arc(cx, cy, w * 0.44, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 8;
          ctx.setLineDash([30, 22]);
          ctx.beginPath();
          ctx.arc(cx, cy, w * 0.35, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(125,255,176,0.18)';
          ctx.beginPath();
          ctx.arc(cx, cy, w * 0.44, 0, Math.PI * 2);
          ctx.fill();
        }),
        true,
        false,
      ),
    );
  }
}
