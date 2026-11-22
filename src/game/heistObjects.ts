import * as THREE from 'three';
import { RAPIER, Physics, G, groups } from './physics';
import { cone, cyl, rbox, sphere, star3D, torus, fluffySphere, capsule, mergeAllMeshes } from '../gfx/geom';
import { Mats } from '../gfx/materials';
import { TextureLib } from '../gfx/textures';
import { present, candyCane, securityCam } from '../gfx/props';
import type { Interactable } from './objects';

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const DEBRIS_GROUPS = groups(G.DEBRIS, G.WORLD | G.DEBRIS | G.PROPS);

// =====================================================================
// Debris (shards from destructibles, popped vent grates)
// =====================================================================

export class DebrisManager {
  private pieces: { obj: THREE.Object3D; body: RAPIER.RigidBody; life: number }[] = [];
  constructor(
    private physics: Physics,
    private parent: THREE.Object3D,
  ) {}

  add(obj: THREE.Object3D, shape: RAPIER.ColliderDesc, vel: THREE.Vector3, life = 5) {
    const p = obj.getWorldPosition(new THREE.Vector3());
    const q = obj.getWorldQuaternion(new THREE.Quaternion());
    obj.removeFromParent();
    this.parent.add(obj);
    obj.position.copy(p);
    obj.quaternion.copy(q);
    shape.setCollisionGroups(DEBRIS_GROUPS).setRestitution(0.3).setFriction(0.7);
    const { body } = this.physics.dynamic(shape, p.x, p.y, p.z, { linDamp: 0.2, angDamp: 0.5 });
    body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    body.setLinvel(vel, true);
    body.setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12, z: (Math.random() - 0.5) * 12 }, true);
    this.pieces.push({ obj, body, life });
  }

  update(dt: number) {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.life -= dt;
      const t = p.body.translation();
      const r = p.body.rotation();
      p.obj.position.set(t.x, t.y, t.z);
      p.obj.quaternion.set(r.x, r.y, r.z, r.w);
      if (p.life < 0.6) p.obj.scale.setScalar(Math.max(0.01, p.life / 0.6));
      if (p.life <= 0 || t.y < -40) {
        this.physics.removeBody(p.body);
        p.obj.removeFromParent();
        this.pieces.splice(i, 1);
      }
    }
  }
}

// =====================================================================
// Destructible Christmas decorations
// =====================================================================

export type DecorKind = 'snowman' | 'ornaments' | 'giftTower' | 'candyCanes' | 'goldPile' | 'nutTree';

export class Destructible {
  readonly group = new THREE.Group();
  broken = false;
  readonly collider: RAPIER.Collider;
  readonly radius: number;
  /** extra loot value dropped as coins */
  readonly coinValue: number;
  readonly colors: number[];
  readonly presents: number;

  constructor(
    private physics: Physics,
    parent: THREE.Object3D,
    readonly pos: THREE.Vector3,
    readonly kind: DecorKind,
    rotY = 0,
  ) {
    this.group.position.copy(pos);
    this.group.rotation.y = rotY;
    parent.add(this.group);
    const g = this.group;
    let r = 0.8;
    let h = 1.6;
    let coins = 300;
    let colors = [0xffffff];
    let presents = 0;
    switch (kind) {
      case 'snowman': {
        mesh(fluffySphere(0.62, 0.02, 2), Mats.snowCap(), g, 0, 0.55, 0);
        mesh(fluffySphere(0.45, 0.02, 3), Mats.snowCap(), g, 0, 1.38, 0);
        mesh(fluffySphere(0.33, 0.015, 4), Mats.snowCap(), g, 0, 2.0, 0);
        const nose = mesh(cone(0.06, 0.32, 12), Mats.plastic(0xff7b1c), g, 0, 2.0, 0.42);
        nose.rotation.x = Math.PI / 2;
        for (const s of [-1, 1]) mesh(sphere(0.045, 8, 6), Mats.blackGloss(), g, s * 0.12, 2.1, 0.29);
        for (const y of [1.25, 1.45, 1.65]) mesh(sphere(0.05, 8, 6), Mats.blackGloss(), g, 0, y, 0.44);
        mesh(cyl(0.22, 0.22, 0.36, 20), Mats.blackGloss(), g, 0, 2.42, 0);
        mesh(cyl(0.36, 0.36, 0.04, 24), Mats.blackGloss(), g, 0, 2.26, 0);
        const scarf = mesh(torus(0.34, 0.07, 8, 24), Mats.plastic(0xd31f2b), g, 0, 1.72, 0);
        scarf.rotation.x = Math.PI / 2;
        for (const s of [-1, 1]) {
          const arm = mesh(capsule(0.03, 0.6, 4, 6), Mats.bark(), g, s * 0.6, 1.5, 0);
          arm.rotation.z = s * 1.0;
        }
        r = 0.7;
        h = 2.6;
        coins = 400;
        colors = [0xffffff, 0xeef4ff, 0xd31f2b];
        break;
      }
      case 'ornaments': {
        const cols = [0xd31f2b, 0xf2c14e, 0x2a6bd7, 0x1d9a55, 0xe8e8f0];
        let k = 0;
        for (let layer = 0; layer < 3; layer++) {
          const n = 3 - layer;
          for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) {
              const x = (i - (n - 1) / 2) * 0.5;
              const z = (j - (n - 1) / 2) * 0.5;
              const b = mesh(sphere(0.25, 18, 14), Mats.plastic(cols[k++ % cols.length]), g, x, 0.25 + layer * 0.42, z);
              b.userData.shard = true;
            }
        }
        mesh(cyl(0.6, 0.7, 0.08, 24), Mats.gold(), g, 0, 0.04, 0);
        r = 0.75;
        h = 1.3;
        coins = 300;
        colors = cols;
        break;
      }
      case 'giftTower': {
        const sizes = [1.0, 0.8, 0.6];
        let y = 0;
        sizes.forEach((s, i) => {
          const p = present(s, s * 0.8, s, i + 2, [0xf2c14e, 0xffffff, 0xd31f2b][i]);
          p.position.y = y;
          p.rotation.y = i * 0.4;
          g.add(p);
          y += s * 0.8;
        });
        r = 0.6;
        h = y;
        coins = 0;
        presents = 3;
        colors = [0xd31f2b, 0x1d9a55, 0xf2c14e];
        break;
      }
      case 'candyCanes': {
        for (let i = 0; i < 5; i++) {
          const c = candyCane(1.6 + (i % 2) * 0.3);
          c.position.set(Math.cos(i * 1.26) * 0.25, 0, Math.sin(i * 1.26) * 0.25);
          c.rotation.y = i * 1.26;
          g.add(c);
        }
        const tie = mesh(torus(0.36, 0.06, 8, 20), Mats.ribbon(0x1d9a55), g, 0, 0.8, 0);
        tie.rotation.x = Math.PI / 2;
        mesh(cyl(0.5, 0.55, 0.3, 20), Mats.plastic(0x1d9a55), g, 0, 0.15, 0);
        r = 0.55;
        h = 2;
        coins = 200;
        colors = [0xd31f2b, 0xffffff];
        break;
      }
      case 'goldPile': {
        const mound = mesh(new THREE.SphereGeometry(1.0, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), Mats.goldSatin(), g);
        mound.scale.set(1, 0.7, 1);
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2;
          const rr = Math.random() * 0.9;
          const c = mesh(cyl(0.16, 0.16, 0.04, 16), Mats.gold(), g, Math.cos(a) * rr, Math.sqrt(Math.max(0, 1 - rr * rr)) * 0.7 + 0.02, Math.sin(a) * rr);
          c.rotation.set(Math.random(), Math.random() * 3, Math.random());
          c.castShadow = false;
        }
        r = 1.0;
        h = 0.8;
        coins = 1200;
        colors = [0xffd75a, 0xffffff];
        break;
      }
      case 'nutTree': {
        mesh(cyl(0.38, 0.3, 0.55, 16), Mats.plastic(0xd31f2b), g, 0, 0.27, 0);
        mesh(torus(0.38, 0.04, 6, 20), Mats.gold(), g, 0, 0.53, 0).rotation.x = Math.PI / 2;
        mesh(cone(0.7, 1.0, 12), Mats.pine(), g, 0, 1.2, 0);
        mesh(cone(0.55, 0.8, 12), Mats.pine(), g, 0, 1.65, 0);
        mesh(cone(0.38, 0.6, 12), Mats.pine(), g, 0, 2.05, 0);
        mesh(star3D(0.13, 0.06, 0.05), Mats.glow(0xffc84a, 3), g, 0, 2.45, 0, false);
        r = 0.55;
        h = 2.4;
        coins = 200;
        colors = [0x1d9a55, 0xd31f2b, 0xf2c14e];
        break;
      }
    }
    this.radius = r;
    this.coinValue = coins;
    this.colors = colors;
    this.presents = presents;
    this.collider = physics.cylinder(pos.x, pos.y + h / 2, pos.z, r, h, groups(G.WORLD, 0xffff));
    // Render a merged copy (few draw calls); keep the real pieces hidden for the shatter.
    this.pieces = new THREE.Group();
    for (const c of [...g.children]) this.pieces.add(c);
    this.pieces.visible = false;
    g.add(this.pieces);
    const display = new THREE.Group();
    for (const c of this.pieces.children) display.add(c.clone(true));
    mergeAllMeshes(display);
    this.display = display;
    g.add(display);
  }

  private pieces: THREE.Group;
  private display: THREE.Group;

  /** Shatters into physics debris. Returns world positions of gift boxes (gift towers turn into loot). */
  break(debris: DebrisManager, dir: THREE.Vector3): THREE.Vector3[] {
    if (this.broken) return [];
    this.broken = true;
    this.physics.removeCollider(this.collider);
    this.display.removeFromParent();
    this.pieces.visible = true;
    const kids = [...this.pieces.children];
    this.group.updateMatrixWorld(true);
    if (this.kind === 'giftTower') {
      const out = kids.map((k) => k.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0)));
      this.group.removeFromParent();
      return out;
    }
    for (const k of kids) {
      const sp = 3 + Math.random() * 4;
      const v = new THREE.Vector3((Math.random() - 0.5) * 2 + dir.x * 0.8, 0.8 + Math.random(), (Math.random() - 0.5) * 2 + dir.z * 0.8).normalize().multiplyScalar(sp);
      v.y += 3;
      const bb = new THREE.Box3().setFromObject(k);
      const size = bb.getSize(new THREE.Vector3());
      const shape = RAPIER.ColliderDesc.cuboid(Math.max(0.05, size.x * 0.4), Math.max(0.05, size.y * 0.4), Math.max(0.05, size.z * 0.4));
      debris.add(k, shape, v, 4 + Math.random() * 2);
    }
    this.group.removeFromParent();
    return [];
  }
}

// =====================================================================
// Security terminal (hack = lasers & cameras off, wanted level down)
// =====================================================================

function screenTexture(state: 'ready' | 'locked' | 'granted') {
  return TextureLib.get('term-' + state, () => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const ctx = c.getContext('2d')!;
    const bg = state === 'granted' ? '#05301a' : state === 'locked' ? '#3a0710' : '#04203a';
    const fg = state === 'granted' ? '#5dff9e' : state === 'locked' ? '#ff5d6e' : '#5dd6ff';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 160);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, 240, 144);
    ctx.fillStyle = fg;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SECURITY OS', 128, 46);
    ctx.font = 'bold 26px monospace';
    ctx.fillText(state === 'granted' ? 'ACCESS OK' : state === 'locked' ? 'LOCKED' : 'READY', 128, 92);
    ctx.font = '16px monospace';
    ctx.fillText(state === 'granted' ? 'LASERS: OFFLINE' : 'LASERS: ONLINE', 128, 126);
    for (let y = 0; y < 160; y += 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, y, 256, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export class Terminal implements Interactable {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  radius = 2.2;
  prompt = 'Hack Security Terminal';
  used = false;
  private screen: THREE.Mesh;
  private light: THREE.Mesh;
  onUse: (() => void) | null = null;

  constructor(parent: THREE.Object3D, pos: THREE.Vector3, rotY: number) {
    this.pos = pos.clone();
    this.group.position.copy(pos);
    this.group.rotation.y = rotY;
    parent.add(this.group);
    const g = this.group;
    mesh(rbox(1.3, 1.0, 0.8, 0.12), Mats.gunmetal(), g, 0, 0.5, 0);
    mesh(rbox(1.4, 0.08, 0.9, 0.04), Mats.chrome(), g, 0, 1.02, 0.05);
    const kb = mesh(rbox(1.0, 0.06, 0.35, 0.02), Mats.blackGloss(), g, 0, 1.08, 0.2);
    kb.rotation.x = -0.12;
    const head = new THREE.Group();
    head.position.set(0, 1.55, -0.15);
    head.rotation.x = -0.25;
    g.add(head);
    mesh(rbox(1.25, 0.85, 0.12, 0.06), Mats.gunmetal(), head);
    const mat = new THREE.MeshBasicMaterial({ map: screenTexture('ready') });
    mat.color.setScalar(1.8);
    this.screen = mesh(new THREE.PlaneGeometry(1.1, 0.7), mat, head, 0, 0, 0.065, false);
    mesh(cyl(0.02, 0.02, 0.6, 6), Mats.chrome(), g, 0.5, 2.1, -0.2);
    this.light = mesh(sphere(0.06, 10, 8), Mats.glow(0x5dd6ff, 6), g, 0.5, 2.42, -0.2, false);
  }

  enabled = () => !this.used;
  interact = () => this.onUse?.();

  setState(s: 'ready' | 'locked' | 'granted') {
    (this.screen.material as THREE.MeshBasicMaterial).map = screenTexture(s);
    (this.screen.material as THREE.MeshBasicMaterial).needsUpdate = true;
    this.light.material = Mats.glow(s === 'granted' ? 0x5dff9e : s === 'locked' ? 0xff5d6e : 0x5dd6ff, 6);
  }

  update(t: number) {
    this.light.visible = Math.floor(t * 2) % 2 === 0 || this.used;
  }
}

// =====================================================================
// Ventilation grate (hidden shortcut)
// =====================================================================

export class Vent implements Interactable {
  readonly grate = new THREE.Group();
  readonly pos: THREE.Vector3;
  radius = 2.0;
  prompt = 'Pry Open Vent';
  opened = false;
  private collider: RAPIER.Collider;
  onOpen: (() => void) | null = null;

  constructor(
    private physics: Physics,
    parent: THREE.Object3D,
    center: THREE.Vector3,
    readonly width: number,
    readonly height: number,
    readonly rotY: number,
  ) {
    this.pos = center.clone();
    this.grate.position.copy(center);
    this.grate.rotation.y = rotY;
    parent.add(this.grate);
    mesh(rbox(width, height, 0.1, 0.05), Mats.darkMetal(), this.grate);
    for (let i = 0; i < 7; i++) {
      const slat = mesh(rbox(width - 0.25, 0.08, 0.16, 0.03), Mats.steelPlain(), this.grate, 0, -height / 2 + 0.25 + i * ((height - 0.5) / 6), 0.04);
      slat.rotation.x = 0.5;
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) mesh(sphere(0.05, 8, 6), Mats.chrome(), this.grate, sx * (width / 2 - 0.12), sy * (height / 2 - 0.12), 0.08);
    this.collider = physics.box(center.x, center.y, center.z, width, height, 0.3, rotY);
  }

  enabled = () => !this.opened;
  interact = () => this.onOpen?.();

  open(debris: DebrisManager, push: THREE.Vector3) {
    if (this.opened) return;
    this.opened = true;
    this.physics.removeCollider(this.collider);
    debris.add(this.grate, RAPIER.ColliderDesc.cuboid(this.width / 2, this.height / 2, 0.06), push, 6);
  }
}

// =====================================================================
// Sweeping security camera with a floor spotlight
// =====================================================================

export class SecurityCamera {
  readonly group: THREE.Group;
  readonly spot: THREE.Mesh;
  readonly beam: THREE.Mesh;
  private spotMat: THREE.ShaderMaterial;
  private beamMat: THREE.MeshBasicMaterial;
  readonly target = new THREE.Vector3();
  seeing = false;
  disabledUntil = 0;
  readonly radius: number;

  constructor(
    parent: THREE.Object3D,
    readonly mount: THREE.Vector3,
    readonly a: THREE.Vector3,
    readonly b: THREE.Vector3,
    readonly period = 6,
    radius = 2.2,
  ) {
    this.radius = radius;
    this.group = securityCam();
    this.group.position.copy(mount);
    parent.add(this.group);
    this.spotMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      uniforms: { uColor: { value: new THREE.Color(0.6, 0.85, 1.0) }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
        void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.8, d) * 0.35 + smoothstep(0.98, 0.9, d) * smoothstep(0.82, 0.9, d) * 0.6;
        a *= 0.85 + 0.15 * sin(uTime * 8.0); gl_FragColor = vec4(uColor * 1.6, a); }`,
    });
    this.spot = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), this.spotMat);
    this.spot.rotation.x = -Math.PI / 2;
    this.spot.userData.noAO = true;
    this.spot.renderOrder = 2;
    parent.add(this.spot);
    this.beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.4, 0.6), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const bg = new THREE.ConeGeometry(1, 1, 20, 1, true);
    bg.translate(0, -0.5, 0);
    this.beam = new THREE.Mesh(bg, this.beamMat);
    this.beam.userData.noAO = true;
    parent.add(this.beam);
  }

  update(t: number, alarm: boolean) {
    const k = 0.5 - 0.5 * Math.cos((t / this.period) * Math.PI * 2);
    this.target.lerpVectors(this.a, this.b, k);
    const disabled = t < this.disabledUntil;
    this.spot.visible = this.beam.visible = !disabled;
    this.spot.position.set(this.target.x, this.target.y + 0.04, this.target.z);
    const head = this.group.userData.head as THREE.Object3D;
    const local = this.group.worldToLocal(this.target.clone());
    head.lookAt(this.group.localToWorld(local.clone()));
    // beam from the camera to the floor spot
    const from = this.mount.clone().add(new THREE.Vector3(0, -0.35, 0));
    const dir = this.target.clone().sub(from);
    const len = dir.length();
    this.beam.position.copy(from);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    this.beam.scale.set(this.radius, len, this.radius);
    const col = this.seeing || alarm ? new THREE.Color(1.0, 0.25, 0.25) : new THREE.Color(0.6, 0.85, 1.0);
    (this.spotMat.uniforms.uColor.value as THREE.Color).copy(col);
    this.spotMat.uniforms.uTime.value = t;
    this.beamMat.color.copy(col).multiplyScalar(0.45);
  }

  sees(p: THREE.Vector3, t: number) {
    if (t < this.disabledUntil) return false;
    return Math.hypot(p.x - this.target.x, p.z - this.target.z) < this.radius * 0.9 && Math.abs(p.y - this.target.y) < 2.5;
  }
}

// =====================================================================
// Giant golden gift block (pushable physics prop for the pressure plate)
// =====================================================================

export class PushBlock {
  readonly obj: THREE.Group;
  readonly body: RAPIER.RigidBody;
  constructor(physics: Physics, parent: THREE.Object3D, pos: THREE.Vector3, size = 1.4) {
    this.obj = present(size, size, size, 0, 0xd31f2b, true);
    const inner = new THREE.Group();
    this.obj.children.forEach((c) => (c.position.y -= size / 2));
    parent.add(this.obj);
    void inner;
    const { body } = physics.dynamic(
      RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2)
        .setDensity(14)
        .setFriction(0.35)
        .setCollisionGroups(groups(G.PROPS, G.WORLD | G.PLAYER | G.PROPS | G.RAGDOLL | G.LOOT | G.HAZARD)),
      pos.x,
      pos.y + size / 2 + 0.02,
      pos.z,
      { linDamp: 1.6, angDamp: 4 },
    );
    this.body = body;
    physics.tag(body.collider(0), { kind: 'prop', id: 0 });
  }
  get position() {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }
  update() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.obj.position.set(t.x, t.y, t.z);
    this.obj.quaternion.set(r.x, r.y, r.z, r.w);
  }
}

export { cone };
