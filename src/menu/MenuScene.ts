import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { Bean } from '../characters/Bean';
import type { Outfit } from '../characters/outfits';
import { VaultDoor } from '../game/objects';
import { Mats } from '../gfx/materials';
import { BulbField, OrnamentField, christmasTree, column, garland, lampPost, present, sharedTime, wreath, candyCane, lightString } from '../gfx/props';
import { SnowVolume } from '../gfx/Snow';
import { createSky } from '../gfx/Sky';
import { fluffySphere, rbox, torus, cyl } from '../gfx/geom';
import { PenguinModel } from '../characters/Penguin';
import { damp, dampVec3 } from '../core/math';

export type MenuMode = 'main' | 'customize' | 'wide';

const CAMS: Record<MenuMode, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
  main: { pos: new THREE.Vector3(0.1, 2.05, 7.4), look: new THREE.Vector3(2.0, 1.95, -1.2) },
  customize: { pos: new THREE.Vector3(2.1, 1.55, 4.3), look: new THREE.Vector3(3.35, 1.05, 0.5) },
  wide: { pos: new THREE.Vector3(-1.5, 3.4, 11), look: new THREE.Vector3(0.5, 2.8, -3) },
};

/** Animated 3D backdrop for the main menu: Santa in front of a giant vault. */
export class MenuScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 900);
  readonly bean: Bean;
  private vault: VaultDoor;
  private snow: SnowVolume;
  private sky = createSky();
  private t = 0;
  private mode: MenuMode = 'main';
  private camPos = CAMS.main.pos.clone();
  private camLook = CAMS.main.look.clone();
  private mouse = new THREE.Vector2();
  private spin = 0;
  private spinVel = 0;
  private dragging = false;
  private lastX = 0;
  private celebrateT = 4;
  private celebrating = 0;
  private guard: PenguinModel;
  private dial = 0;

  constructor(private engine: Engine, outfit: Outfit) {
    const s = this.scene;
    s.background = new THREE.Color(0x070a1c);
    s.environment = engine.envTexture;
    s.environmentIntensity = 0.22;
    s.fog = new THREE.Fog(0x0b1030, 25, 120);
    s.add(this.sky.mesh);
    const bulbs = new BulbField();
    const orn = new OrnamentField();

    // ground: snow + marble plinth
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), Mats.snow(8, 8));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);
    const plinth = new THREE.Mesh(rbox(12, 0.3, 7, 0.12), Mats.marbleFloor(1.5, 0.9));
    plinth.position.set(2, 0.12, -1.8);
    plinth.receiveShadow = true;
    s.add(plinth);
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 6), Mats.carpet(1, 2.3));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(2.4, 0.28, -1.4);
    carpet.receiveShadow = true;
    s.add(carpet);

    // vault wall
    const wall = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(-9, 0);
    shape.lineTo(9, 0);
    shape.lineTo(9, 10);
    shape.lineTo(-9, 10);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 3.6, 3.45, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const wg = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 48 });
    const uv = wg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
    const wm = new THREE.Mesh(wg, Mats.wallpaper(1, 1));
    wm.receiveShadow = true;
    wm.castShadow = true;
    wall.add(wm);
    const back = new THREE.Mesh(new THREE.CircleGeometry(3.5, 48), new THREE.MeshBasicMaterial({ color: 0x120a00 }));
    back.position.set(0, 3.6, 0.2);
    wall.add(back);
    const frame = new THREE.Mesh(torus(3.62, 0.34, 18, 80), Mats.gold());
    frame.position.set(0, 3.6, 1.05);
    wall.add(frame);
    const top = new THREE.Mesh(rbox(18.4, 0.6, 1.6, 0.15), Mats.gold());
    top.position.set(0, 10, 0.5);
    wall.add(top);
    wall.position.set(2.4, 0, -6);
    s.add(wall);
    this.vault = new VaultDoor(null, s, new THREE.Vector3(2.4, 3.6, -5.2), 3.4);
    const w1 = wreath(1.0);
    w1.position.set(2.4, 8.6, -4.85);
    s.add(w1);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1), Mats.signMat('GRAND VAULT'));
    sign.position.set(2.4, 9.95, -4.68);
    s.add(sign);
    for (const x of [-3.6, 8.4]) {
      const c = column(9.6, 0.55, bulbs, new THREE.Vector3(x, 0.27, -4.4));
      c.position.set(x, 0.27, -4.4);
      s.add(c);
    }
    // garland arch with bulbs
    const ga = new THREE.Group();
    garland(new THREE.Vector3(-3.6, 9.3, -4.2), new THREE.Vector3(2.4, 9.3, -4.2), 1.3, ga, bulbs, 0.16);
    garland(new THREE.Vector3(2.4, 9.3, -4.2), new THREE.Vector3(8.4, 9.3, -4.2), 1.3, ga, bulbs, 0.16);
    s.add(ga);
    // trees
    for (const [x, z, h] of [
      [-6.5, -3.5, 6.5],
      [11, -3.2, 6.8],
      [-11, -9, 9],
      [15, -10, 8],
    ]) {
      const tr = christmasTree(h, { bulbs, ornaments: orn, seed: Math.round(x * 10), snow: true, at: new THREE.Vector3(x, 0, z) });
      tr.position.set(x, 0, z);
      s.add(tr);
    }
    // presents pile beside Santa
    [
      [4.2, 0.3, 1.0, 0.9, 1],
      [5.1, 0.3, 0.2, 0.7, 4],
      [4.5, 1.02, 0.7, 0.5, 6],
      [-0.3, 0.3, 0.9, 0.75, 2],
      [0.5, 0.3, 1.6, 0.55, 5],
    ].forEach(([x, y, z, sz, v]) => {
      const p = present(sz, sz * 0.85, sz, v);
      p.position.set(x, y, z);
      p.rotation.y = x;
      s.add(p);
    });
    // coin pile spilling from the vault
    for (let i = 0; i < 40; i++) {
      const c = new THREE.Mesh(cyl(0.16, 0.16, 0.04, 16), Mats.gold());
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.6;
      c.position.set(2.6 + Math.cos(a) * r, 0.3 + Math.random() * 0.06, -2.6 + Math.sin(a) * r * 0.6);
      c.rotation.set(Math.random() * 0.4, Math.random() * 6, Math.random() * 0.4);
      c.castShadow = true;
      s.add(c);
    }
    // lamp posts + candy canes + drifts
    for (const x of [-2.2, 7.4]) lampPost(s, x, 0, 2.6);
    for (const [x, z] of [
      [-1.2, 3.2],
      [6.2, 3.4],
    ]) {
      const cc = candyCane(1.4);
      cc.position.set(x, 0, z);
      s.add(cc);
    }
    for (let i = 0; i < 10; i++) {
      const d = new THREE.Mesh(fluffySphere(1.5, 0.08, i), Mats.snowCap());
      d.position.set(-12 + i * 3.4, -0.25, -7.5 + (i % 3));
      d.scale.set(1.6, 0.45, 1.2);
      d.receiveShadow = true;
      s.add(d);
    }
    lightString(new THREE.Vector3(-2.2, 4.6, 2.6), new THREE.Vector3(7.4, 4.6, 2.6), 1.0, s, bulbs, 0.4);
    s.add(bulbs.build(6.5, 0.06));
    s.add(orn.build());

    // a sleepy penguin guard on watch
    this.guard = new PenguinModel(false);
    this.guard.root.position.set(6.3, 0.27, -1.9);
    this.guard.root.rotation.y = -0.7;
    this.guard.anim = 'idle';
    s.add(this.guard.root);

    // Santa
    this.bean = new Bean(outfit);
    this.bean.root.position.set(2.4, 0.27, 0.4);
    this.bean.root.rotation.y = -0.25;
    this.bean.setLoot(1);
    s.add(this.bean.root);

    // lights
    const hemi = new THREE.HemisphereLight(0xb8ccff, 0x2a1a14, 0.35);
    s.add(hemi);
    const key = new THREE.DirectionalLight(0xffe2c0, 1.9);
    key.position.set(6, 9, 9);
    key.target.position.set(2, 1, -1);
    key.castShadow = true;
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    s.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x7fa6ff, 1.6);
    rim.position.set(-6, 6, -8);
    s.add(rim);
    const vaultGlow = new THREE.PointLight(0xffb84a, 3, 8, 2);
    vaultGlow.position.set(5.5, 1.2, -0.5);
    s.add(vaultGlow);
    const lamp = new THREE.PointLight(0xffb86b, 10, 10, 2);
    lamp.position.set(-2.2, 4.2, 2.6);
    s.add(lamp);

    this.snow = new SnowVolume(new THREE.Vector3(-14, 0, -10), new THREE.Vector3(18, 14, 10), 2600 * engine.preset.snowScale, { size: 0.06 });
    s.add(this.snow.points);

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mousedown', this.onDown);
    window.addEventListener('mouseup', this.onUp);
  }

  private onMove = (e: MouseEvent) => {
    this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    if (this.dragging && this.mode === 'customize') {
      this.spinVel = (e.clientX - this.lastX) * 0.012;
      this.spin += this.spinVel;
      this.lastX = e.clientX;
    }
  };
  private onDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).id === 'game-canvas') {
      this.dragging = true;
      this.lastX = e.clientX;
    }
  };
  private onUp = () => (this.dragging = false);

  setOutfit(o: Outfit) {
    this.bean.setOutfit(o);
    this.bean.setLoot(1);
    this.bean.flash('happy', 0.9);
    this.celebrating = 0.9;
  }

  setMode(m: MenuMode) {
    this.mode = m;
    if (m !== 'customize') this.spin = 0;
  }

  activate() {
    this.engine.setView(this.scene, this.camera, { bloomStrength: 0.5, bloomRadius: 0.45, bloomThreshold: 2.2, exposure: 0.95, aoIntensity: 0.8 });
  }

  update(dt: number) {
    this.t += dt;
    sharedTime.value += dt;
    const t = this.t;
    const cam = CAMS[this.mode];
    const target = cam.pos.clone();
    target.x += Math.sin(t * 0.25) * 0.25 + this.mouse.x * (this.mode === 'customize' ? 0.1 : 0.45);
    target.y += Math.sin(t * 0.33) * 0.12 - this.mouse.y * 0.2;
    dampVec3(this.camPos, target, 2.6, dt);
    dampVec3(this.camLook, cam.look, 2.6, dt);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    // Santa idles, glances at the camera, celebrates now and then
    this.celebrateT -= dt;
    if (this.celebrateT <= 0 && this.mode === 'main') {
      this.celebrateT = 7 + Math.random() * 5;
      this.celebrating = 1.2;
    }
    this.celebrating = Math.max(0, this.celebrating - dt);
    if (!this.dragging) {
      this.spinVel *= Math.exp(-3 * dt);
      this.spin += this.spinVel;
    }
    const baseYaw = this.mode === 'customize' ? 0.1 : -0.62;
    this.bean.root.rotation.y = damp(this.bean.root.rotation.y, baseYaw + this.spin + Math.sin(t * 0.6) * 0.08, 6, dt);
    this.bean.lookAtWorld = this.camera.position;
    this.bean.update(dt, { state: this.celebrating > 0 ? 'celebrate' : 'menu', speed: 0, maxSpeed: 10, vy: 0, turnRate: 0, sprinting: false, accel: 0 });
    if (this.celebrating <= 0) this.bean.root.position.y = 0.27;

    // the vault dial ticks; the guard dozes and looks around
    this.dial += dt * 0.6;
    this.vault.setDial(Math.sin(this.dial) * 1.5);
    this.guard.lookYaw = Math.sin(t * 0.5) * 0.7;
    this.guard.update(dt, 0);

    const vh = this.engine.renderer.domElement.height;
    this.snow.update(t, this.camera, vh);
    this.sky.uniforms.uTime.value = t;
  }

  dispose() {
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mouseup', this.onUp);
    this.snow.dispose();
    this.bean.dispose();
    this.scene.clear();
  }
}
