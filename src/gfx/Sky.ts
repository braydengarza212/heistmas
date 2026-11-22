import * as THREE from 'three';

/** Night sky dome: gradient, procedural stars, soft aurora and a glowing moon. */
export function createSky(radius = 450) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(-0.35, 0.55, -0.75).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uMoonDir;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 horizon = vec3(0.16, 0.12, 0.32);
        vec3 mid = vec3(0.04, 0.06, 0.2);
        vec3 top = vec3(0.01, 0.015, 0.06);
        vec3 col = mix(horizon, mid, smoothstep(-0.05, 0.25, h));
        col = mix(col, top, smoothstep(0.25, 0.9, h));
        // stars
        vec3 cell = floor(d * 220.0);
        float s = hash(cell);
        float star = step(0.9965, s) * smoothstep(0.02, 0.2, h);
        float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 4.0) + s * 40.0);
        col += vec3(0.9, 0.95, 1.0) * star * tw * 2.5;
        // aurora ribbons
        float band = sin(d.x * 3.0 + uTime * 0.05) * 0.08 + 0.42;
        float aur = exp(-pow((h - band) * 9.0, 2.0)) * (0.5 + 0.5 * sin(d.x * 18.0 + d.z * 7.0 + uTime * 0.25));
        aur *= smoothstep(-0.6, 0.2, d.z) * 0.55;
        col += vec3(0.1, 0.55, 0.38) * aur * 0.45 + vec3(0.35, 0.15, 0.5) * aur * 0.15;
        // moon
        float md = dot(d, uMoonDir);
        float moon = smoothstep(0.99935, 0.99955, md);
        float glow = pow(max(md, 0.0), 220.0) * 0.6 + pow(max(md, 0.0), 18.0) * 0.08;
        col += vec3(1.0, 0.97, 0.88) * moon * 3.0 + vec3(0.6, 0.7, 1.0) * glow;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.userData.noAO = true;
  return { mesh, uniforms: mat.uniforms };
}

/** Distant city silhouette blocks with lit windows (cheap backdrop). */
export function createSkyline(center: THREE.Vector3, radius: number, count: number, seed = 3, ...gaps: [number, number][]) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const group = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0d1230';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 128; y += 10)
    for (let x = 4; x < 64; x += 10) {
      if (rnd() > 0.55) {
        ctx.fillStyle = rnd() > 0.85 ? '#ffd27a' : '#f7b955';
        ctx.fillRect(x, y, 5, 6);
      }
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, fog: true });
  mat.color.setScalar(1.4);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.1;
    const w = 6 + rnd() * 12;
    const h = 12 + rnd() * 40;
    // leave openings where roads lead out of town
    const an = Math.atan2(Math.sin(a), Math.cos(a));
    if (gaps.some(([g0, g1]) => an > g0 && an < g1)) continue;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / 6.4), uv.getY(k) * (h / 12.8));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(w, h, 8);
    mesh.position.set(center.x + Math.cos(a) * radius, center.y + h / 2 - 6, center.z + Math.sin(a) * radius);
    mesh.lookAt(center.x, mesh.position.y, center.z);
    group.add(mesh);
  }
  return group;
}
