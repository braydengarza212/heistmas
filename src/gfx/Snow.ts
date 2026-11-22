import * as THREE from 'three';

const vert = /* glsl */ `
uniform float uTime;
uniform vec3 uMin;
uniform vec3 uSize;
uniform float uScale;
uniform float uOpacity;
attribute vec4 aRand;
varying float vAlpha;
void main() {
  vec3 p = position;
  p.y = uMin.y + mod(p.y - uMin.y - uTime * aRand.y, uSize.y);
  p.x += sin(uTime * aRand.w + aRand.z) * 0.4;
  p.z += cos(uTime * aRand.w * 0.8 + aRand.z * 1.3) * 0.4;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aRand.x * uScale / -mv.z, 0.0, 48.0);
  float fadeY = smoothstep(0.0, 1.0, p.y - uMin.y) * smoothstep(0.0, 2.5, uMin.y + uSize.y - p.y);
  vAlpha = uOpacity * fadeY * smoothstep(0.4, 2.5, -mv.z);
}`;

const frag = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.1, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.92, 0.96, 1.0) * 1.15, a);
}`;

/** World-space box of falling snow (one per outdoor area / skylight). */
export class SnowVolume {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;

  constructor(min: THREE.Vector3, max: THREE.Vector3, count: number, opts: { speed?: number; size?: number; opacity?: number } = {}) {
    const size = max.clone().sub(min);
    const n = Math.max(10, Math.floor(count));
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = min.x + Math.random() * size.x;
      pos[i * 3 + 1] = min.y + Math.random() * size.y;
      pos[i * 3 + 2] = min.z + Math.random() * size.z;
      rnd[i * 4] = (opts.size ?? 0.07) * (0.5 + Math.random());
      rnd[i * 4 + 1] = (opts.speed ?? 1.1) * (0.6 + Math.random() * 0.8);
      rnd[i * 4 + 2] = Math.random() * 6.28;
      rnd[i * 4 + 3] = 0.3 + Math.random() * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
    geo.boundingSphere = new THREE.Sphere(min.clone().add(max).multiplyScalar(0.5), size.length() / 2);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uTime: { value: 0 },
        uMin: { value: min.clone() },
        uSize: { value: size },
        uScale: { value: 600 },
        uOpacity: { value: opts.opacity ?? 0.9 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = true;
  }

  update(time: number, camera: THREE.PerspectiveCamera, viewportHeight: number) {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uScale.value = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }

  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
