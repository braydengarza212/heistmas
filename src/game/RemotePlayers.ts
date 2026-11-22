import * as THREE from 'three';
import { Bean, PROFILE, type BeanState } from '../characters/Bean';
import { HATS, MASKS, SACKS, SKINS, type Outfit } from '../characters/outfits';
import { ANIMS, FLAG_FROZEN, FLAG_SPRINT, NET_WEAPONS, SNAP_STRIDE } from '../shared/protocol';
import { rbox, smoothLathe } from '../gfx/geom';
import { Mats } from '../gfx/materials';
import { buildWeapon, WEAPONS } from './Arsenal';
import { CHAR_SCALE } from './scale';
import { SPRINT_SPEED } from './Player';

/**
 * Other robbers in your bank. Snapshots arrive ~10 times a second; each
 * robber is drawn 120 ms in the past, interpolated between the two snapshots
 * around that moment. The nearest few get a full animated character with a
 * name tag; the rest are cheap instanced stand-ins (one draw call).
 */

const INTERP_DELAY = 120;
const KEEP_MS = 1500;
const MAX_IMPOSTORS = 220;

interface Snap {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
  spd: number;
  w: number;
  flags: number;
}

interface Remote {
  id: number;
  name: string;
  outfit: Outfit;
  color: THREE.Color;
  maskColor: THREE.Color;
  snaps: Snap[];
  lastSeen: number;
  /** Interpolated now. */
  pos: THREE.Vector3;
  yaw: number;
  anim: number;
  spd: number;
  vy: number;
  w: number;
  flags: number;
  visible: boolean;
  full: FullModel | null;
}

interface FullModel {
  bean: Bean;
  tag: THREE.Sprite;
  ice: THREE.Mesh;
  weapons: Map<number, THREE.Group>;
  owner: Remote | null;
}

export interface RemoteTarget {
  id: number;
  pos: THREE.Vector3;
  frozen: boolean;
}

export function parseLook(look: string): Outfit {
  const [skin, mask, hat, sack] = (look || '').split('|');
  return {
    skin: SKINS[skin] ? skin : 'skin.criminal',
    mask: MASKS[mask] ? mask : 'mask.bandit',
    hat: HATS[hat] ? hat : 'hat.auto',
    sack: SACKS[sack] ? sack : 'sack.burlap',
  };
}

export class RemotePlayers {
  private players = new Map<number, Remote>();
  private pool: FullModel[] = [];
  private impostors: THREE.InstancedMesh;
  private masks: THREE.InstancedMesh;
  private iceMat = Mats.glass();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  /** Robbers in the whole bank (from the server). */
  bankCount = 0;
  /** Server time of the newest snapshot. */
  private latestTs = 0;
  private targetsCache: RemoteTarget[] = [];

  constructor(
    private scene: THREE.Scene,
    private fullCount: number,
  ) {
    // stand-in: the bean silhouette in the robber's suit colour, with its bandit mask band
    const geo = smoothLathe(PROFILE, 40, 20);
    const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    this.impostors = makeInstanced(geo, mat);
    const band = new THREE.TorusGeometry(0.47, 0.09, 6, 24);
    band.rotateX(Math.PI / 2);
    band.scale(1, 1.6, 1);
    band.translate(0, 1.02, 0);
    this.masks = makeInstanced(band, new THREE.MeshStandardMaterial({ roughness: 0.6 }));
    scene.add(this.impostors, this.masks);
  }

  roster(add: [number, string, string][], del: number[]) {
    for (const [id, name, look] of add) {
      const outfit = parseLook(look);
      const existing = this.players.get(id);
      if (existing) {
        existing.name = name;
        continue;
      }
      this.players.set(id, {
        id,
        name,
        outfit,
        color: new THREE.Color(SKINS[outfit.skin].body),
        maskColor: new THREE.Color(MASKS[outfit.mask].color),
        snaps: [],
        lastSeen: 0,
        pos: new THREE.Vector3(),
        yaw: 0,
        anim: 0,
        spd: 0,
        vy: 0,
        w: 0,
        flags: 0,
        visible: false,
        full: null,
      });
    }
    for (const id of del) this.remove(id);
  }

  private remove(id: number) {
    const r = this.players.get(id);
    if (!r) return;
    if (r.full) this.release(r);
    this.players.delete(id);
  }

  /** ts is server time; nowServer converts our clock. */
  snapshot(ts: number, n: number, flat: number[]) {
    this.bankCount = n;
    this.latestTs = Math.max(this.latestTs, ts);
    for (let i = 0; i + SNAP_STRIDE <= flat.length; i += SNAP_STRIDE) {
      const r = this.players.get(flat[i]);
      if (!r) continue;
      const s: Snap = {
        t: ts,
        x: flat[i + 1] / 10,
        y: flat[i + 2] / 10,
        z: flat[i + 3] / 10,
        yaw: flat[i + 4] / 100,
        anim: flat[i + 5],
        spd: flat[i + 6] / 10,
        w: flat[i + 7],
        flags: flat[i + 8],
      };
      const last = r.snaps[r.snaps.length - 1];
      if (last && last.t >= ts) continue;
      // a big jump (respawn) snaps instead of sliding across the map
      if (last && Math.hypot(s.x - last.x, s.z - last.z) > 15) r.snaps.length = 0;
      r.snaps.push(s);
      while (r.snaps.length > 2 && ts - r.snaps[0].t > KEEP_MS) r.snaps.shift();
      r.lastSeen = ts;
    }
  }

  get count() {
    return this.players.size;
  }

  /** Interpolated robbers for snowball hit tests. */
  targets(): RemoteTarget[] {
    return this.targetsCache;
  }

  update(dt: number, serverNow: number, cam: THREE.Vector3) {
    const renderT = serverNow - INTERP_DELAY;
    const visible: Remote[] = [];
    for (const r of this.players.values()) {
      // shown while the server keeps including them (they drop out when they leave your view)
      r.visible = r.snaps.length > 0 && this.latestTs - r.lastSeen < 650;
      if (!r.visible) continue;
      this.sample(r, renderT, dt);
      visible.push(r);
    }
    // nearest get full models
    visible.sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam));
    const want = new Set(visible.slice(0, this.fullCount));
    for (const r of this.players.values()) if (r.full && !want.has(r)) this.release(r);
    for (const r of want) if (!r.full) this.assign(r);

    let n = 0;
    this.targetsCache = [];
    for (const r of visible) {
      this.targetsCache.push({ id: r.id, pos: r.pos.clone().setY(r.pos.y + 0.8 * CHAR_SCALE), frozen: (r.flags & FLAG_FROZEN) !== 0 });
      if (r.full) {
        this.drawFull(r, dt, cam);
      } else if (n < MAX_IMPOSTORS) {
        this.tmpQ.setFromAxisAngle(this.up, r.yaw);
        this.tmpS.setScalar(CHAR_SCALE);
        this.tmpM.compose(r.pos, this.tmpQ, this.tmpS);
        this.impostors.setMatrixAt(n, this.tmpM);
        this.impostors.setColorAt(n, r.flags & FLAG_FROZEN ? ICE_TINT : r.color);
        this.masks.setMatrixAt(n, this.tmpM);
        this.masks.setColorAt(n, r.maskColor);
        n++;
      }
    }
    for (const im of [this.impostors, this.masks]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  private sample(r: Remote, t: number, dt: number) {
    const s = r.snaps;
    let a = s[0];
    let b = s[0];
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i].t <= t && s[i + 1].t >= t) {
        a = s[i];
        b = s[i + 1];
        break;
      }
      if (s[i + 1].t < t) a = b = s[i + 1];
    }
    if (t > s[s.length - 1].t) a = b = s[s.length - 1];
    const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    const py = r.pos.y;
    r.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    r.vy = dt > 0 ? (r.pos.y - py) / dt : 0;
    let dy = b.yaw - a.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    r.yaw = a.yaw + dy * k;
    const nb = k < 0.5 ? a : b;
    r.anim = nb.anim;
    r.spd = a.spd + (b.spd - a.spd) * k;
    r.w = nb.w;
    r.flags = nb.flags;
  }

  private assign(r: Remote) {
    let m = this.pool.find((p) => !p.owner);
    if (!m) {
      const bean = new Bean(r.outfit);
      bean.root.scale.setScalar(CHAR_SCALE);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      tag.renderOrder = 5;
      const ice = new THREE.Mesh(rbox(1.25, 1.75, 1.25, 0.12), this.iceMat);
      ice.position.y = 0.82;
      ice.castShadow = false;
      bean.root.add(ice);
      m = { bean, tag, ice, weapons: new Map(), owner: null };
      this.pool.push(m);
    } else {
      m.bean.setOutfit(r.outfit);
    }
    m.owner = r;
    r.full = m;
    const tex = nameTexture(r.name);
    const mat = m.tag.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.map = tex;
    mat.needsUpdate = true;
    m.tag.scale.set(1.9, 0.48, 1);
    this.scene.add(m.bean.root);
    this.scene.add(m.tag);
  }

  private release(r: Remote) {
    const m = r.full!;
    m.owner = null;
    r.full = null;
    m.bean.root.removeFromParent();
    m.tag.removeFromParent();
  }

  private drawFull(r: Remote, dt: number, cam: THREE.Vector3) {
    const m = r.full!;
    m.bean.root.position.copy(r.pos);
    m.bean.root.rotation.set(0, r.yaw, 0);
    const frozen = (r.flags & FLAG_FROZEN) !== 0;
    m.ice.visible = frozen;
    const state = (frozen ? 'knocked' : (ANIMS[r.anim] ?? 'idle')) as BeanState;
    m.bean.update(dt, {
      state: state === 'idle' && r.spd > 0.4 ? 'run' : state,
      speed: frozen ? 0 : r.spd,
      maxSpeed: SPRINT_SPEED,
      vy: r.vy,
      turnRate: 0,
      sprinting: (r.flags & FLAG_SPRINT) !== 0,
      accel: 0,
    });
    // weapon in hand
    for (const [wi, g] of m.weapons) g.visible = wi === r.w - 1;
    if (r.w > 0 && !m.weapons.has(r.w - 1)) {
      const def = WEAPONS.find((d) => d.id === NET_WEAPONS[r.w - 1]?.id);
      if (def) {
        const g = buildWeapon(def).group;
        g.position.set(0.5, 0.95, 0.25);
        m.bean.root.add(g);
        m.weapons.set(r.w - 1, g);
      }
    }
    // name tag above the head, fading with distance
    m.tag.position.set(r.pos.x, r.pos.y + 1.95 * CHAR_SCALE + 0.35, r.pos.z);
    const d = r.pos.distanceTo(cam);
    // fade out far away, and when the camera is right on top of them
    (m.tag.material as THREE.SpriteMaterial).opacity = d < 2.2 ? 0 : d < 3.2 ? d - 2.2 : d < 30 ? 1 : Math.max(0, 1 - (d - 30) / 15);
  }

  dispose() {
    for (const r of [...this.players.keys()]) this.remove(r);
    for (const m of this.pool) {
      m.bean.dispose();
      (m.tag.material as THREE.SpriteMaterial).map?.dispose();
    }
    this.pool = [];
    for (const im of [this.impostors, this.masks]) {
      im.removeFromParent();
      im.dispose();
    }
  }
}

const ICE_TINT = new THREE.Color(0xbfeaff);

function makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material) {
  const im = new THREE.InstancedMesh(geo, mat, MAX_IMPOSTORS);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.count = 0;
  im.castShadow = true;
  im.frustumCulled = false;
  im.setColorAt(0, new THREE.Color());
  return im;
}

function nameTexture(name: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '700 30px system-ui, sans-serif';
  const w = Math.min(244, g.measureText(name).width + 28);
  g.fillStyle = 'rgba(12, 22, 44, 0.72)';
  const x = (256 - w) / 2;
  g.beginPath();
  g.roundRect(x, 10, w, 44, 22);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 33, 230);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
