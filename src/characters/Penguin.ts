import * as THREE from 'three';
import { capsule, cone, cyl, mergeMeshes, rbox, smoothLathe, sphere, star3D, torus } from '../gfx/geom';
import { Mats } from '../gfx/materials';
import { Spring, clamp, damp, noise1, smoothstep } from '../core/math';

export type PenguinAnim = 'idle' | 'walk' | 'suspicious' | 'alert' | 'chase' | 'slide' | 'stunned' | 'celebrate' | 'search';

const PROFILE: [number, number][] = [
  [0.0, 0.12],
  [0.27, 0.14],
  [0.44, 0.22],
  [0.53, 0.4],
  [0.55, 0.6],
  [0.51, 0.84],
  [0.44, 1.02],
  [0.34, 1.17],
  [0.2, 1.28],
  [0.0, 1.33],
];

const SAMPLED = new THREE.SplineCurve(PROFILE.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(160);
function radiusAt(y: number) {
  for (let i = 1; i < SAMPLED.length; i++) {
    const a = SAMPLED[i - 1];
    const b = SAMPLED[i];
    if ((y >= a.y && y <= b.y) || (y <= a.y && y >= b.y)) return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1);
  }
  return 0;
}
function surf(y: number, th: number, out = 0) {
  const r = radiusAt(y) + out;
  return new THREE.Vector3(Math.sin(th) * r, y, Math.cos(th) * r);
}

// Shared geometry/material for all guards (they are identical apart from the cap).
let shared: {
  body: THREE.BufferGeometry;
  bodyMat: THREE.MeshPhysicalMaterial;
  white: THREE.MeshPhysicalMaterial;
  black: THREE.MeshPhysicalMaterial;
  orange: THREE.MeshPhysicalMaterial;
  blush: THREE.MeshStandardMaterial;
  navy: THREE.MeshPhysicalMaterial;
  red: THREE.MeshPhysicalMaterial;
  visor: THREE.MeshPhysicalMaterial;
} | null = null;

function getShared() {
  if (shared) return shared;
  const body = smoothLathe(PROFILE, 60, 56);
  const pos = body.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const dark = new THREE.Color(0x1b2030);
  const light = new THREE.Color(0xf7f8fc);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const th = Math.atan2(x, z);
    const belly = Math.pow(th / 1.0, 2) + Math.pow((y - 0.55) / 0.46, 2);
    const face = Math.pow(th / 0.72, 2) + Math.pow((y - 0.98) / 0.2, 2);
    const w = Math.max(1 - smoothstep(0.85, 1.0, belly), 1 - smoothstep(0.8, 1.0, face));
    c.copy(dark).lerp(light, w);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  shared = {
    body,
    bodyMat: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.2, sheen: 0.3 }),
    white: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1 }),
    black: new THREE.MeshPhysicalMaterial({ color: 0x0b0b10, roughness: 0.15, clearcoat: 1 }),
    orange: new THREE.MeshPhysicalMaterial({ color: 0xff9a1f, roughness: 0.35, clearcoat: 0.8 }),
    blush: new THREE.MeshStandardMaterial({ color: 0xff8fa8, roughness: 0.6, transparent: true, opacity: 0.75 }),
    navy: new THREE.MeshPhysicalMaterial({ color: 0x1f3a8a, roughness: 0.45, clearcoat: 0.4, sheen: 0.5 }),
    red: new THREE.MeshPhysicalMaterial({ color: 0xc8202e, roughness: 0.45, clearcoat: 0.4, sheen: 0.5 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x0f1220, roughness: 0.15, clearcoat: 1 }),
  };
  return shared;
}

export class PenguinModel {
  readonly root = new THREE.Group();
  readonly pivot = new THREE.Group();
  private body = new THREE.Group();
  private flipL = new THREE.Group();
  private flipR = new THREE.Group();
  private footL!: THREE.Mesh;
  private footR!: THREE.Mesh;
  private eyes: { open: THREE.Group; pupil: THREE.Mesh; dizzy: THREE.Group; happy: THREE.Mesh }[] = [];
  private brows: THREE.Mesh[] = [];
  private stunStars = new THREE.Group();
  readonly flashlight = new THREE.Group();
  private cap = new THREE.Group();
  private t = Math.random() * 10;
  private phase = 0;
  private squash = new Spring(1, 300, 12);
  private blink = 0;
  private blinkTimer = 2 + Math.random() * 3;
  private pitch = 0;
  private roll = 0;
  private hop = 0;
  anim: PenguinAnim = 'idle';
  lookYaw = 0;

  constructor(elite = false) {
    const S = getShared();
    this.root.add(this.pivot);
    this.pivot.position.y = 0.7;
    this.pivot.add(this.body);
    this.body.position.y = -0.7;
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const statics: THREE.Mesh[] = [];
    statics.push(mk(S.body, S.bodyMat, this.body));

    // eyes
    for (const side of [-1, 1]) {
      const th = side * 0.27;
      const g = new THREE.Group();
      g.position.copy(surf(1.02, th, 0.02));
      g.rotation.y = th;
      this.body.add(g);
      const open = new THREE.Group();
      g.add(open);
      const sc = mk(sphere(0.09, 20, 14), S.white, open, false);
      sc.scale.set(1, 1.2, 0.45);
      const pupil = mk(sphere(0.055, 16, 12), S.black, open, false);
      pupil.position.z = 0.03;
      pupil.scale.set(1, 1.1, 0.5);
      const hl = mk(sphere(0.017, 8, 6), Mats.glow(0xffffff, 1.6), pupil, false);
      hl.position.set(0.02, 0.025, 0.04);
      const dizzy = new THREE.Group();
      for (const r of [0.785, -0.785]) mk(capsule(0.014, 0.1, 4, 8), S.black, dizzy, false).rotation.z = r;
      dizzy.position.z = 0.03;
      dizzy.visible = false;
      g.add(dizzy);
      const happy = mk(torus(0.05, 0.017, 8, 18, Math.PI), S.black, g, false);
      happy.position.z = 0.03;
      happy.visible = false;
      this.eyes.push({ open, pupil, dizzy, happy });
      const brow = mk(capsule(0.022, 0.08, 4, 8), S.black, this.body, false);
      brow.position.copy(surf(1.15, side * 0.28, 0.03));
      brow.rotation.set(0, th, Math.PI / 2);
      this.brows.push(brow);
      const cheek = mk(sphere(0.06, 12, 8), S.blush, this.body, false);
      statics.push(cheek);
      cheek.position.copy(surf(0.9, side * 0.55, 0.0));
      cheek.rotation.y = side * 0.55;
      cheek.scale.set(1, 0.6, 0.25);
    }

    // beak
    const beak = mk(cone(0.085, 0.2, 16), S.orange, this.body);
    beak.position.copy(surf(0.92, 0, 0.08));
    beak.rotation.x = Math.PI / 2 + 0.2;
    beak.scale.set(1.2, 1, 0.75);
    statics.push(beak);

    // flippers
    for (const side of [-1, 1]) {
      const f = side < 0 ? this.flipL : this.flipR;
      f.position.set(side * 0.5, 0.82, 0);
      this.body.add(f);
      const fl = mk(capsule(0.085, 0.3, 6, 10), S.bodyMat, f);
      fl.position.y = -0.2;
      fl.scale.set(0.55, 1, 1);
      // flipper needs vertex colors; reuse body material with a dark tint geometry
      const g2 = fl.geometry.clone();
      const n = g2.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        col[i * 3] = 0.03;
        col[i * 3 + 1] = 0.04;
        col[i * 3 + 2] = 0.07;
      }
      g2.setAttribute('color', new THREE.BufferAttribute(col, 3));
      fl.geometry = g2;
    }

    // flashlight in right flipper
    this.flashlight.position.set(0.04, -0.36, 0.1);
    this.flipR.add(this.flashlight);
    mk(cyl(0.045, 0.04, 0.22, 12), Mats.darkMetal(), this.flashlight).rotation.x = Math.PI / 2;
    mk(cyl(0.055, 0.055, 0.04, 12), Mats.glow(0xfff2c0, 2.2), this.flashlight, false).rotation.x = Math.PI / 2;
    (this.flashlight.children[1] as THREE.Mesh).position.z = 0.12;

    // feet
    this.footL = mk(sphere(0.13, 16, 10), S.orange, this.root);
    this.footR = mk(sphere(0.13, 16, 10), S.orange, this.root);
    for (const [f, s] of [
      [this.footL, -1],
      [this.footR, 1],
    ] as const) {
      f.scale.set(1, 0.32, 1.55);
      f.position.set(s * 0.2, 0.04, 0.12);
    }

    // police cap
    this.cap.position.set(0, 1.24, -0.02);
    this.body.add(this.cap);
    const capMat = elite ? S.red : S.navy;
    const crown = mk(cyl(0.3, 0.25, 0.2, 28), capMat, this.cap);
    crown.position.y = 0.08;
    const capBand = mk(cyl(0.255, 0.255, 0.07, 28), S.visor, this.cap);
    statics.push(crown, capBand);
    const visor = mk(new THREE.CylinderGeometry(0.26, 0.26, 0.025, 24, 1, false, -Math.PI / 2, Math.PI), S.visor, this.cap);
    visor.position.set(0, -0.01, 0.08);
    visor.scale.set(1, 1, 0.9);
    visor.rotation.x = 0.15;
    statics.push(visor);
    const badge = mk(star3D(0.06, 0.028, 0.02), Mats.gold(), this.cap);
    badge.position.set(0, 0.09, 0.27);
    badge.rotation.x = -0.15;
    this.cap.rotation.x = -0.1;
    statics.push(badge);

    if (elite) {
      const shades = mk(rbox(0.42, 0.1, 0.05, 0.04), S.visor, this.body);
      shades.position.copy(surf(1.03, 0, 0.04));
      shades.scale.set(1, 1, 1);
      statics.push(shades);
    }

    // belt + radio
    const belt = mk(torus(radiusAt(0.48) + 0.01, 0.035, 8, 48), capMat, this.body);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.48;
    const buckle = mk(rbox(0.12, 0.1, 0.04, 0.015), Mats.gold(), this.body);
    buckle.position.copy(surf(0.48, 0, 0.04));
    const radio = mk(rbox(0.1, 0.16, 0.08, 0.02), Mats.blackGloss(), this.body);
    radio.position.copy(surf(0.52, -1.2, 0.05));
    const ant = mk(cyl(0.008, 0.008, 0.16, 6), Mats.blackGloss(), radio);
    ant.position.set(0.03, 0.14, 0);
    statics.push(belt, buckle, radio, ant);

    // stun stars
    this.body.add(this.stunStars);
    this.stunStars.position.y = 1.55;
    for (let i = 0; i < 4; i++) {
      const st = mk(star3D(0.07, 0.03, 0.02), Mats.glow(0xffe066, 3.5), this.stunStars, false);
      const a = (i / 4) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
    }
    this.stunStars.visible = false;
    // bake the non-animated parts into a few meshes (fewer draw calls per guard)
    mergeMeshes(this.body, statics);
  }

  bounce(amount = 0.75) {
    this.squash.value = amount;
    this.squash.velocity = 0;
  }

  update(dt: number, speed: number) {
    this.t += dt;
    const t = this.t;
    const a = this.anim;
    const moving = (a === 'walk' || a === 'chase' || a === 'search' || a === 'suspicious') && speed > 0.2;
    if (moving) this.phase += dt * (6 + speed * 1.4);
    const s = Math.sin(this.phase);
    const runK = clamp(speed / 6, 0, 1.2);

    let pitch = 0;
    let roll = 0;
    let hopY = 0;
    let fl = 0.25;
    let fr = 0.25;
    let flx = 0;
    let frx = 0;
    if (moving) {
      roll = s * (0.16 + runK * 0.06);
      pitch = a === 'chase' ? 0.32 : 0.08;
      hopY = Math.abs(Math.cos(this.phase)) * 0.05 * (1 + runK);
      fl = 0.35 + Math.abs(s) * 0.3 * runK + (a === 'chase' ? 0.6 + noise1(t * 10) * 0.4 : 0);
      fr = 0.35 + Math.abs(s) * 0.3 * runK + (a === 'chase' ? 0.3 : 0);
      this.footL.position.z = 0.12 + s * 0.12;
      this.footR.position.z = 0.12 - s * 0.12;
      this.footL.position.y = 0.04 + Math.max(0, s) * 0.06;
      this.footR.position.y = 0.04 + Math.max(0, -s) * 0.06;
    } else {
      this.footL.position.z = damp(this.footL.position.z, 0.12, 10, dt);
      this.footR.position.z = damp(this.footR.position.z, 0.12, 10, dt);
      this.footL.position.y = 0.04;
      this.footR.position.y = 0.04;
    }
    if (a === 'idle') {
      roll = Math.sin(t * 1.3) * 0.04;
      fl = 0.2 + Math.sin(t * 2) * 0.05;
      fr = 0.2;
    }
    if (a === 'suspicious') {
      roll = 0.22;
      pitch = 0.18;
      fl = 0.6;
      frx = -0.9;
    }
    if (a === 'alert') {
      hopY = Math.max(0, Math.sin(t * 14)) * 0.12;
      fl = 2.2;
      fr = 2.2;
    }
    if (a === 'slide') {
      pitch = 1.45;
      fl = 0.9;
      fr = 0.9;
      flx = 0.5;
      frx = 0.5;
      hopY = -0.25;
    }
    if (a === 'stunned') {
      roll = Math.sin(t * 5) * 0.25;
      pitch = Math.cos(t * 4) * 0.12;
      fl = 1.2 + Math.sin(t * 9) * 0.3;
      fr = 1.2 + Math.cos(t * 9) * 0.3;
    }
    if (a === 'celebrate') {
      hopY = Math.abs(Math.sin(t * 9)) * 0.35;
      fl = 2.6 + Math.sin(t * 18) * 0.3;
      fr = 2.6 - Math.sin(t * 18) * 0.3;
    }
    if (a === 'search') {
      fl = 0.4;
      frx = -1.1 + Math.sin(t * 3) * 0.3;
    }
    this.pitch = damp(this.pitch, pitch, 10, dt);
    this.roll = damp(this.roll, roll, 10, dt);
    this.hop = damp(this.hop, hopY, 18, dt);
    this.pivot.position.y = 0.7 + this.hop;
    this.pivot.rotation.set(this.pitch, this.lookYaw, this.roll, 'YXZ');
    this.flipL.rotation.z = damp(this.flipL.rotation.z, fl, 14, dt);
    this.flipR.rotation.z = damp(this.flipR.rotation.z, -fr, 14, dt);
    this.flipL.rotation.x = damp(this.flipL.rotation.x, flx, 14, dt);
    this.flipR.rotation.x = damp(this.flipR.rotation.x, frx, 14, dt);

    const sq = this.squash.update(1 + (moving ? Math.abs(Math.cos(this.phase)) * 0.04 : Math.sin(t * 2) * 0.015), dt);
    const inv = 1 / Math.sqrt(Math.max(0.5, sq));
    this.body.scale.set(inv, sq, inv);

    // face
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 0.13;
      this.blinkTimer = 2 + Math.random() * 3;
    }
    this.blink = Math.max(0, this.blink - dt);
    const stunned = a === 'stunned';
    const happy = a === 'celebrate';
    const angry = a === 'chase' || a === 'alert';
    for (const e of this.eyes) {
      e.open.visible = !stunned && !happy;
      e.dizzy.visible = stunned;
      e.happy.visible = happy;
      const sy = this.blink > 0 ? 0.1 : a === 'alert' ? 1.25 : angry ? 0.8 : 1;
      e.open.scale.set(a === 'alert' ? 1.2 : 1, sy, 1);
      e.pupil.position.x = Math.sin(t * 0.7) * 0.012;
      if (stunned) e.dizzy.rotation.z = t * 7;
    }
    this.brows.forEach((b, i) => {
      const side = i === 0 ? -1 : 1;
      const tilt = angry ? -side * 0.45 : a === 'suspicious' ? (i === 0 ? 0.3 : -0.1) : side * 0.1;
      b.rotation.z = damp(b.rotation.z, Math.PI / 2 + tilt, 12, dt);
    });
    this.stunStars.visible = stunned;
    if (stunned) this.stunStars.rotation.y = t * 5;
  }
}

/** Ground vision fan + volumetric flashlight beam, colored by alert state. */
export class VisionCone {
  readonly fan: THREE.Mesh;
  readonly beam: THREE.Mesh;
  private fanMat: THREE.ShaderMaterial;
  private beamMat: THREE.ShaderMaterial;
  private range = 1;
  private half = 0.5;

  constructor() {
    this.fanMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { uColor: { value: new THREE.Color(1, 0.85, 0.3) }, uAlpha: { value: 0.3 }, uFill: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; uniform float uFill; uniform float uTime;
        varying vec2 vP;
        void main(){
          float d = length(vP);
          float edge = smoothstep(1.0, 0.94, d);
          float rings = 0.5 + 0.5 * sin(d * 30.0 - uTime * 4.0);
          float fill = step(d, uFill);
          float a = edge * (0.35 + 0.25 * rings * (1.0 - d)) * uAlpha + fill * 0.25 * edge;
          a += smoothstep(0.9, 1.0, d) * edge * uAlpha * 1.5;
          gl_FragColor = vec4(uColor * 1.4, a);
        }`,
    });
    const g = new THREE.CircleGeometry(1, 32, 0, 1);
    this.fan = new THREE.Mesh(g, this.fanMat);
    this.fan.rotation.x = -Math.PI / 2;
    this.fan.renderOrder = 2;
    this.fan.userData.noAO = true;

    this.beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(1, 0.9, 0.6) }, uAlpha: { value: 0.12 } },
      vertexShader: /* glsl */ `
        varying float vT; varying vec3 vN; varying vec3 vV;
        void main(){
          vT = position.z;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha;
        varying float vT; varying vec3 vN; varying vec3 vV;
        void main(){
          float f = pow(abs(dot(vN, vV)), 1.5);
          float a = uAlpha * f * (1.0 - vT) * smoothstep(0.0, 0.08, vT);
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    // cone with tip at origin pointing -Y, we rotate to +Z
    const cg = new THREE.ConeGeometry(1, 1, 24, 1, true);
    cg.translate(0, -0.5, 0);
    cg.rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(cg, this.beamMat);
    this.beam.userData.noAO = true;
    this.beam.renderOrder = 3;
  }

  setShape(range: number, halfAngle: number) {
    if (Math.abs(range - this.range) < 0.01 && Math.abs(halfAngle - this.half) < 0.001) return;
    this.range = range;
    this.half = halfAngle;
    this.fan.geometry.dispose();
    this.fan.geometry = new THREE.CircleGeometry(1, 32, -Math.PI / 2 - halfAngle, halfAngle * 2);
    this.fan.scale.set(range, range, 1);
    const r = Math.tan(halfAngle) * range * 0.6;
    this.beam.scale.set(r, r, range * 0.9);
  }

  setState(color: THREE.Color, fill: number, alpha: number, time: number) {
    (this.fanMat.uniforms.uColor.value as THREE.Color).copy(color);
    this.fanMat.uniforms.uFill.value = fill;
    this.fanMat.uniforms.uAlpha.value = alpha;
    this.fanMat.uniforms.uTime.value = time;
    (this.beamMat.uniforms.uColor.value as THREE.Color).copy(color).lerp(new THREE.Color(1, 1, 1), 0.4);
    this.beamMat.uniforms.uAlpha.value = alpha * 0.35;
  }

  dispose() {
    this.fan.geometry.dispose();
    this.beam.geometry.dispose();
    this.fanMat.dispose();
    this.beamMat.dispose();
  }
}
