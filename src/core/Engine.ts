import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  label: string;
  pixelRatio: number;
  msaa: number;
  fxaa: boolean;
  shadows: boolean;
  shadowMapSize: number;
  shadowRadius: number;
  ao: boolean;
  aoSamples: number;
  bloom: boolean;
  snowScale: number;
  particleScale: number;
  anisotropy: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Low',
    pixelRatio: 0.85,
    msaa: 0,
    fxaa: true,
    shadows: true,
    shadowMapSize: 1024,
    shadowRadius: 1.5,
    ao: false,
    aoSamples: 0,
    bloom: true,
    snowScale: 0.35,
    particleScale: 0.5,
    anisotropy: 2,
  },
  medium: {
    label: 'Medium',
    pixelRatio: 1,
    msaa: 2,
    fxaa: false,
    shadows: true,
    shadowMapSize: 2048,
    shadowRadius: 2.5,
    ao: false,
    aoSamples: 0,
    bloom: true,
    snowScale: 0.65,
    particleScale: 0.8,
    anisotropy: 4,
  },
  high: {
    label: 'High',
    pixelRatio: 1.5,
    msaa: 4,
    fxaa: false,
    shadows: true,
    shadowMapSize: 2048,
    shadowRadius: 3.5,
    ao: true,
    aoSamples: 8,
    bloom: true,
    snowScale: 1,
    particleScale: 1,
    anisotropy: 8,
  },
  ultra: {
    label: 'Ultra',
    pixelRatio: 2,
    msaa: 4,
    fxaa: false,
    shadows: true,
    shadowMapSize: 4096,
    shadowRadius: 4,
    ao: true,
    aoSamples: 16,
    bloom: true,
    snowScale: 1.4,
    particleScale: 1,
    anisotropy: 16,
  },
};

/**
 * GTAO that ignores transparent / glow geometry (vision cones, laser beams,
 * light shafts). Those would otherwise write depth into the AO G-buffer and
 * produce dark halos.
 */
class SelectiveGTAOPass extends GTAOPass {
  _overrideVisibility() {
    const cache = (this as unknown as { _visibilityCache: THREE.Object3D[] })._visibilityCache;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      const transparent =
        m.isMesh && !Array.isArray(m.material) && (m.material as THREE.Material).transparent;
      if (o.visible && ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || o.userData.noAO || transparent)) {
        o.visible = false;
        cache.push(o);
      }
    });
  }
}

export interface ViewSettings {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  exposure: number;
  aoIntensity: number;
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  composer: EffectComposer | null = null;
  scene: THREE.Scene | null = null;
  camera: THREE.PerspectiveCamera | null = null;
  quality: QualityLevel;
  preset: QualityPreset;
  readonly envTexture: THREE.Texture;
  view: ViewSettings = { bloomStrength: 0.5, bloomRadius: 0.45, bloomThreshold: 2.0, exposure: 1.0, aoIntensity: 0.85 };

  private bloomPass: UnrealBloomPass | null = null;
  private aoPass: SelectiveGTAOPass | null = null;
  private width = 1;
  private height = 1;
  /** Dynamic resolution: drops when frame time is consistently high. */
  private dynScale = 1;
  private slowFrames = 0;
  private fastFrames = 0;

  constructor(container: HTMLElement, quality: QualityLevel) {
    this.quality = quality;
    this.preset = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'game-canvas';
    this.canvas.tabIndex = 0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.canvas);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(room, 0.035).texture;
    room.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    pmrem.dispose();

    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  get maxAnisotropy() {
    return Math.min(this.preset.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
  }

  setView(scene: THREE.Scene, camera: THREE.PerspectiveCamera, view?: Partial<ViewSettings>) {
    this.scene = scene;
    this.camera = camera;
    if (view) Object.assign(this.view, view);
    this.applyShadowQuality(scene);
    this.rebuildComposer();
    this.handleResize();
  }

  setQuality(q: QualityLevel) {
    this.quality = q;
    this.preset = QUALITY[q];
    this.dynScale = 1;
    if (this.scene) this.applyShadowQuality(this.scene);
    this.rebuildComposer();
    this.handleResize();
  }

  applyShadowQuality(scene: THREE.Scene) {
    const p = this.preset;
    this.renderer.shadowMap.enabled = p.shadows;
    scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if ((l.isDirectionalLight || (o as THREE.SpotLight).isSpotLight) && l.castShadow) {
        const size = l.userData.shadowScale ? Math.max(512, p.shadowMapSize * l.userData.shadowScale) : p.shadowMapSize;
        if (l.shadow.mapSize.x !== size) {
          l.shadow.mapSize.set(size, size);
          l.shadow.map?.dispose();
          (l.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
        }
        l.shadow.radius = p.shadowRadius;
      }
    });
  }

  private rebuildComposer() {
    if (!this.scene || !this.camera) return;
    this.composer?.dispose();
    const p = this.preset;
    const pr = this.effectivePixelRatio();
    this.renderer.setPixelRatio(pr);
    const rt = new THREE.WebGLRenderTarget(this.width * pr, this.height * pr, {
      type: THREE.HalfFloatType,
      samples: p.msaa,
    });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(pr);
    composer.setSize(this.width, this.height);
    composer.addPass(new RenderPass(this.scene, this.camera));

    this.aoPass = null;
    if (p.ao) {
      const ao = new SelectiveGTAOPass(this.scene, this.camera, this.width * pr, this.height * pr);
      ao.updateGtaoMaterial({
        radius: 0.55,
        distanceExponent: 1.4,
        thickness: 1.2,
        scale: 1.15,
        samples: p.aoSamples,
        distanceFallOff: 1,
        screenSpaceRadius: false,
      });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      ao.blendIntensity = this.view.aoIntensity;
      composer.addPass(ao);
      this.aoPass = ao;
    }

    this.bloomPass = null;
    if (p.bloom) {
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(this.width, this.height),
        this.view.bloomStrength,
        this.view.bloomRadius,
        this.view.bloomThreshold,
      );
      composer.addPass(bloom);
      this.bloomPass = bloom;
    }
    composer.addPass(new OutputPass());
    if (p.fxaa) composer.addPass(new FXAAPass());
    this.composer = composer;
    this.renderer.toneMappingExposure = this.view.exposure;
  }

  updateView(view: Partial<ViewSettings>) {
    Object.assign(this.view, view);
    if (this.bloomPass) {
      this.bloomPass.strength = this.view.bloomStrength;
      this.bloomPass.radius = this.view.bloomRadius;
      this.bloomPass.threshold = this.view.bloomThreshold;
    }
    if (this.aoPass) this.aoPass.blendIntensity = this.view.aoIntensity;
    this.renderer.toneMappingExposure = this.view.exposure;
  }

  private effectivePixelRatio() {
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio) * this.dynScale);
  }

  handleResize() {
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    const pr = this.effectivePixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(this.width, this.height);
    }
    if (this.camera) {
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Lightweight adaptive resolution so weaker GPUs stay near 60 FPS. */
  trackFrameTime(dt: number) {
    if (dt > 1 / 45) {
      this.slowFrames++;
      this.fastFrames = 0;
    } else if (dt < 1 / 58) {
      this.fastFrames++;
      this.slowFrames = Math.max(0, this.slowFrames - 1);
    }
    if (this.slowFrames > 90 && this.dynScale > 0.6) {
      this.dynScale = Math.max(0.6, this.dynScale - 0.1);
      this.slowFrames = 0;
      this.handleResize();
    } else if (this.fastFrames > 600 && this.dynScale < 1) {
      this.dynScale = Math.min(1, this.dynScale + 0.1);
      this.fastFrames = 0;
      this.handleResize();
    }
  }

  /** Per-frame totals across all passes (draw calls, triangles) for profiling. */
  readonly frameStats = { calls: 0, triangles: 0 };

  render() {
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    if (this.composer) this.composer.render();
    else if (this.scene && this.camera) this.renderer.render(this.scene, this.camera);
    this.frameStats.calls = info.render.calls;
    this.frameStats.triangles = info.render.triangles;
  }
}
