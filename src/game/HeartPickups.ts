import * as THREE from 'three';
import { Mats } from '../gfx/materials';
import { mulberry32 } from '../core/math';
import { WEAPONS } from './Arsenal';
import { CHAR_SCALE as K } from './scale';

/**
 * Hidden extra lives: one heart tucked away on every other stage (2, 4, 6,
 * 8, 10). Picking it up gives the robber one more heart (a new heart slot,
 * filled). Hearts hide in the same kind of nooks as the weapons, but never in
 * the spot that stage's weapon picked.
 */

export const HEART_STAGES = [2, 4, 6, 8, 10];
export const MAX_HEARTS = 10;

export interface HeartPickup {
  stage: number;
  spot: THREE.Vector3;
  root: THREE.Group;
  glow: THREE.Mesh;
  taken: boolean;
}

function heartShape() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(-0.18, -0.32, -0.62, -0.08, -0.56, 0.22);
  s.bezierCurveTo(-0.5, 0.52, -0.12, 0.6, 0, 0.32);
  s.bezierCurveTo(0.12, 0.6, 0.5, 0.52, 0.56, 0.22);
  s.bezierCurveTo(0.62, -0.08, 0.18, -0.32, 0, -0.5);
  return s;
}

let heartGeo: THREE.ExtrudeGeometry | null = null;
function geometry() {
  if (!heartGeo) {
    heartGeo = new THREE.ExtrudeGeometry(heartShape(), { depth: 0.16, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 5, curveSegments: 24 });
    heartGeo.center();
  }
  return heartGeo;
}

export function buildHeart() {
  const g = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xe0142e,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    sheen: 0.6,
    sheenColor: new THREE.Color(0xff8aa0),
    // a gentle inner glow so it reads in dark corners, kept below the bloom threshold
    emissive: new THREE.Color(0xff2040),
    emissiveIntensity: 0.35,
  });
  const heart = new THREE.Mesh(geometry(), mat);
  heart.castShadow = true;
  g.add(heart);
  // a little gold bow on top: it's a present, after all
  const bow = Mats.gold();
  for (const s of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 8, 16), bow);
    loop.position.set(s * 0.1, 0.36, 0);
    loop.rotation.y = Math.PI / 2;
    loop.scale.set(1, 0.7, 1);
    g.add(loop);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), bow);
  knot.position.set(0, 0.36, 0);
  g.add(knot);
  return g;
}

export class HeartPickups {
  readonly hearts: HeartPickup[] = [];
  private t = 0;

  constructor(
    private scene: THREE.Scene,
    seed: number,
    /** Where each stage's weapon hides (so the heart picks another nook). */
    weaponSpots: Map<number, THREE.Vector3>,
  ) {
    const rnd = mulberry32((Math.floor(seed) ^ 0x5bd1e995) >>> 0 || 7);
    for (const stage of HEART_STAGES) {
      const def = WEAPONS.find((w) => w.stage === stage);
      if (!def) continue;
      const taken = weaponSpots.get(stage);
      const options = def.spots.filter((s) => !taken || Math.hypot(s[0] - taken.x, s[2] - taken.z) > 3);
      const pool = options.length ? options : def.spots;
      const s = pool[Math.floor(rnd() * pool.length) % pool.length];
      // tuck it a little to the side of the nook so it never overlaps a weapon on the same spot
      const spot = new THREE.Vector3(s[0], s[1], s[2]);
      if (!options.length && taken) spot.x += 1.6;
      this.hearts.push(this.make(stage, spot));
    }
  }

  private make(stage: number, spot: THREE.Vector3): HeartPickup {
    const root = buildHeart();
    root.scale.setScalar(1.1 * K + 0.15);
    root.position.copy(spot).add(new THREE.Vector3(0, 0.8, 0));
    this.scene.add(root);
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.72, 32), Mats.glow(0xff4d6d, 1.3));
    glow.rotation.x = -Math.PI / 2;
    glow.position.copy(spot).add(new THREE.Vector3(0, 0.04, 0));
    glow.userData.noAO = true;
    this.scene.add(glow);
    return { stage, spot, root, glow, taken: false };
  }

  /** The heart on a display stage, if it's still there. */
  forStage(stage: number) {
    return this.hearts.find((h) => !h.taken && h.stage === stage) ?? null;
  }

  /** Returns the heart the robber just walked into, if any (and marks it taken). */
  tryPickup(feet: THREE.Vector3) {
    for (const h of this.hearts) {
      if (h.taken || Math.abs(feet.y - h.spot.y) > 2) continue;
      if (Math.hypot(feet.x - h.spot.x, feet.z - h.spot.z) < 1.35) {
        h.taken = true;
        h.root.visible = false;
        h.glow.visible = false;
        return h;
      }
    }
    return null;
  }

  update(dt: number, player: THREE.Vector3) {
    this.t += dt;
    for (const h of this.hearts) {
      if (h.taken) continue;
      const near = Math.abs(h.spot.x - player.x) + Math.abs(h.spot.z - player.z) < 60;
      h.root.visible = near;
      h.glow.visible = near;
      if (!near) continue;
      // a heartbeat: spin, bob and a double "lub-dub" pulse
      h.root.rotation.y += dt * 1.4;
      h.root.position.y = h.spot.y + 0.8 + Math.sin(this.t * 2.2 + h.spot.x) * 0.12;
      const beat = (this.t * 1.2) % 1;
      const pulse = 1 + 0.12 * Math.exp(-((beat - 0.08) ** 2) / 0.002) + 0.08 * Math.exp(-((beat - 0.28) ** 2) / 0.002);
      h.root.scale.setScalar((1.1 * K + 0.15) * pulse);
      h.glow.scale.setScalar(1 + Math.sin(this.t * 3 + h.spot.z) * 0.1);
    }
  }

  dispose() {
    for (const h of this.hearts) {
      h.root.removeFromParent();
      h.glow.removeFromParent();
    }
  }
}
