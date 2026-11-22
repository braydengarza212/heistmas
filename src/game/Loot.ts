import * as THREE from 'three';
import { RAPIER, Physics, G, groups } from './physics';
import { cashStack, gem, goldBar, moneyBag, present } from '../gfx/props';
import { coinGeo, cyl, sphere } from '../gfx/geom';
import { Mats } from '../gfx/materials';
import type { FX } from '../gfx/Particles';
import { clamp } from '../core/math';

export type LootKind = 'coin' | 'cash' | 'present' | 'moneyBag' | 'goldBar' | 'goldPresent' | 'diamond' | 'starDiamond' | 'cocoa';

export const LOOT: Record<LootKind, { value: number; label: string; big: boolean; color: number }> = {
  coin: { value: 100, label: 'Gold Coin', big: false, color: 0xffd75a },
  cash: { value: 250, label: 'Cash Stack', big: false, color: 0x7dff9a },
  present: { value: 500, label: 'Present', big: false, color: 0xff6b7a },
  moneyBag: { value: 1000, label: 'Money Bag', big: false, color: 0xffd75a },
  goldBar: { value: 1500, label: 'Gold Bar', big: true, color: 0xffcf40 },
  goldPresent: { value: 2500, label: 'Golden Present', big: true, color: 0xffd75a },
  diamond: { value: 5000, label: 'Diamond', big: true, color: 0x8fe9ff },
  starDiamond: { value: 10000, label: 'The Star of the North', big: true, color: 0xff8fe0 },
  cocoa: { value: 0, label: 'Hot Cocoa', big: false, color: 0xffb36b },
};

const LOOT_GROUPS = groups(G.LOOT, G.WORLD | G.PROPS | G.HAZARD);

let presentVariant = 0;

function makeVisual(kind: LootKind): THREE.Object3D {
  switch (kind) {
    case 'coin': {
      const m = new THREE.Mesh(coinGeo(), Mats.gold());
      m.scale.setScalar(1.6);
      m.castShadow = true;
      const g = new THREE.Group();
      m.rotation.x = Math.PI / 2;
      g.add(m);
      return g;
    }
    case 'cash':
      return cashStack();
    case 'present': {
      const v = presentVariant++ % 7;
      const s = 0.42 + (v % 3) * 0.06;
      return present(s, s * 0.85, s, v, [0xf2c14e, 0xffffff, 0xd31f2b][v % 3]);
    }
    case 'goldPresent':
      return present(0.62, 0.55, 0.62, 0, 0xd31f2b, true);
    case 'moneyBag':
      return moneyBag(0.75);
    case 'goldBar':
      return goldBar();
    case 'diamond': {
      const g = new THREE.Group();
      const d = gem(0x8fe9ff, 0.3);
      d.position.y = 0.35;
      g.add(d);
      return g;
    }
    case 'starDiamond': {
      const g = new THREE.Group();
      const d = gem(0xff7ad9, 0.55);
      d.position.y = 0.6;
      g.add(d);
      return g;
    }
    case 'cocoa': {
      const g = new THREE.Group();
      const mug = new THREE.Mesh(cyl(0.16, 0.14, 0.3, 20), Mats.plastic(0xd31f2b));
      mug.position.y = 0.15;
      mug.castShadow = true;
      g.add(mug);
      const cocoa = new THREE.Mesh(cyl(0.14, 0.14, 0.02, 20), Mats.matte(0x6b3a1e, 0.4));
      cocoa.position.y = 0.29;
      g.add(cocoa);
      for (let i = 0; i < 3; i++) {
        const mm = new THREE.Mesh(sphere(0.045, 10, 8), Mats.matte(0xfffaf2, 0.6));
        mm.position.set(Math.cos(i * 2.1) * 0.06, 0.31, Math.sin(i * 2.1) * 0.06);
        g.add(mm);
      }
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 8, 16), Mats.plastic(0xd31f2b));
      handle.position.set(0.17, 0.15, 0);
      g.add(handle);
      return g;
    }
  }
}

export class LootItem {
  collected = false;
  collecting = 0;
  readonly visual: THREE.Object3D;
  body: RAPIER.RigidBody | null = null;
  private spin = Math.random() * 6;
  private bob = Math.random() * 6;
  private glintTimer = Math.random();
  readonly base = new THREE.Vector3();
  magnet = 0;
  /** Seconds before a spilled item can be picked up again. */
  cooldown = 0;
  /** Floating loot spins on a pedestal; physical loot tumbles. */
  constructor(
    readonly kind: LootKind,
    readonly floating: boolean,
  ) {
    this.visual = makeVisual(kind);
  }
  get value() {
    return LOOT[this.kind].value;
  }

  updateFloating(dt: number) {
    this.spin += dt * (this.kind === 'starDiamond' ? 0.8 : 1.6);
    this.bob += dt * 2.2;
    this.visual.position.copy(this.base);
    this.visual.position.y += 0.15 + Math.sin(this.bob) * 0.08;
    this.visual.rotation.y = this.spin;
  }

  glint(dt: number, fx: FX) {
    this.glintTimer -= dt;
    if (this.glintTimer <= 0) {
      this.glintTimer = 0.5 + Math.random() * 1.2;
      const p = this.visual.position.clone();
      p.y += LOOT[this.kind].big ? 0.6 : 0.35;
      p.x += (Math.random() - 0.5) * 0.4;
      p.z += (Math.random() - 0.5) * 0.4;
      fx.glints.emit(p, { count: 1, color: LOOT[this.kind].color, speed: 0.2, size: LOOT[this.kind].big ? 0.6 : 0.4, life: 0.6, gravity: 0 });
    }
  }
}

export interface PickupEvent {
  item: LootItem;
  value: number;
  position: THREE.Vector3;
}

export class LootManager {
  readonly items: LootItem[] = [];
  readonly group = new THREE.Group();
  onPickup: ((e: PickupEvent) => void) | null = null;

  constructor(
    private physics: Physics,
    private fx: FX,
    parent: THREE.Object3D,
  ) {
    parent.add(this.group);
  }

  /** Floating pick-up (on counters, pedestals, ledges). */
  place(kind: LootKind, pos: THREE.Vector3, rotY = 0) {
    const it = new LootItem(kind, true);
    it.base.copy(pos);
    it.visual.position.copy(pos);
    it.visual.rotation.y = rotY;
    this.group.add(it.visual);
    this.items.push(it);
    return it;
  }

  /** Physics-driven loot that bounces and tumbles. */
  spawn(kind: LootKind, pos: THREE.Vector3, vel?: THREE.Vector3, cooldown = 0) {
    const it = new LootItem(kind, false);
    let desc: RAPIER.ColliderDesc;
    switch (kind) {
      case 'coin':
        desc = RAPIER.ColliderDesc.cylinder(0.04, 0.26);
        break;
      case 'goldBar':
        desc = RAPIER.ColliderDesc.cuboid(0.3, 0.1, 0.15);
        break;
      case 'cash':
        desc = RAPIER.ColliderDesc.cuboid(0.21, 0.07, 0.11);
        break;
      default:
        desc = RAPIER.ColliderDesc.ball(0.25);
    }
    desc.setCollisionGroups(LOOT_GROUPS).setRestitution(0.35).setFriction(0.8).setDensity(kind === 'coin' ? 2 : 1);
    const { body } = this.physics.dynamic(desc, pos.x, pos.y, pos.z, { linDamp: 0.1, angDamp: 0.4 });
    if (vel) body.setLinvel(vel, true);
    body.setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 10 }, true);
    it.body = body;
    it.cooldown = cooldown;
    it.visual.position.copy(pos);
    this.group.add(it.visual);
    this.items.push(it);
    return it;
  }

  /** Bursts value out as coins/cash (when a pile is hit or the player drops loot). */
  burst(pos: THREE.Vector3, value: number, cooldown = 0, maxPieces = 14) {
    let remaining = value;
    let n = 0;
    while (remaining >= 100 && n < maxPieces) {
      const kind: LootKind = remaining >= 1500 && Math.random() < 0.3 ? 'goldBar' : remaining >= 250 && Math.random() < 0.4 ? 'cash' : 'coin';
      remaining -= LOOT[kind].value;
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 3.5;
      this.spawn(kind, pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.2, 0.4 + Math.random() * 0.4, Math.sin(a) * 0.2)), new THREE.Vector3(Math.cos(a) * sp, 5 + Math.random() * 4, Math.sin(a) * sp), cooldown);
      n++;
    }
    return value - remaining;
  }

  update(dt: number, playerChest: THREE.Vector3, canCollect: boolean, magnetRadius: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.collected) {
        // fly into the sack and shrink
        it.collecting += dt * 4.5;
        const k = clamp(it.collecting, 0, 1);
        it.visual.position.lerp(playerChest, k * 0.5);
        it.visual.scale.setScalar(Math.max(0.01, 1 - k));
        if (k >= 1) {
          this.group.remove(it.visual);
          this.items.splice(i, 1);
        }
        continue;
      }
      if (it.body) {
        const t = it.body.translation();
        const r = it.body.rotation();
        it.visual.position.set(t.x, t.y - (it.kind === 'coin' ? 0 : 0.1), t.z);
        it.visual.quaternion.set(r.x, r.y, r.z, r.w);
        if (t.y < -40) {
          this.remove(it, i);
          continue;
        }
      } else {
        it.updateFloating(dt);
      }
      it.cooldown = Math.max(0, it.cooldown - dt);
      if (LOOT[it.kind].big || it.floating) it.glint(dt, this.fx);

      if (!canCollect || it.cooldown > 0) continue;
      const p = it.visual.position;
      const dx = playerChest.x - p.x;
      const dy = playerChest.y - 0.4 - p.y;
      const dz = playerChest.z - p.z;
      const d = Math.hypot(dx, dy * 0.6, dz);
      const pickR = it.kind === 'starDiamond' ? 1.6 : 1.15;
      if (d < magnetRadius && it.kind !== 'cocoa') {
        // magnet: drift toward the player
        const pull = (1 - d / magnetRadius) * 9 * dt;
        if (it.body) {
          it.body.setLinvel({ x: dx * 3, y: Math.max(it.body.linvel().y, dy * 3), z: dz * 3 }, true);
        } else {
          it.base.x += dx * pull;
          it.base.z += dz * pull;
        }
      }
      if (d < pickR) {
        it.collected = true;
        if (it.body) {
          this.physics.removeBody(it.body);
          it.body = null;
        }
        this.fx.pickup(p.clone().add(new THREE.Vector3(0, 0.3, 0)), LOOT[it.kind].color, LOOT[it.kind].big);
        this.onPickup?.({ item: it, value: it.value, position: p.clone() });
      }
    }
  }

  private remove(it: LootItem, index: number) {
    if (it.body) this.physics.removeBody(it.body);
    this.group.remove(it.visual);
    this.items.splice(index, 1);
  }

  /** Pushes physical loot lying on a conveyor along its belt. */
  applyConveyor(box: THREE.Box3, vel: THREE.Vector3) {
    for (const it of this.items) {
      if (!it.body || it.collected) continue;
      const t = it.body.translation();
      if (t.x > box.min.x && t.x < box.max.x && t.z > box.min.z && t.z < box.max.z && t.y > box.min.y && t.y < box.max.y) {
        const v = it.body.linvel();
        it.body.setLinvel({ x: v.x + (vel.x - v.x) * 0.2, y: v.y, z: v.z + (vel.z - v.z) * 0.2 }, true);
      }
    }
  }

  get remainingValue() {
    return this.items.reduce((s, it) => s + (it.collected ? 0 : it.value), 0);
  }
}
