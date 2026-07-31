/**
 * Renderer and post-processing.
 *
 * The post stack is doing a large share of the work of making a browser game
 * look expensive. In rough order of contribution per millisecond:
 *
 *   1. Tone mapping (ACES) -- without it, bright emissives clip to flat white
 *      and the whole image looks like untreated WebGL.
 *   2. Bloom fed by emissives -- faction light strips, the solar filament,
 *      muzzle flashes and explosions all bleed correctly.
 *   3. Ambient occlusion -- contact shadows are what glue objects to ground.
 *   4. SMAA -- cheap, and jaggies read as "web demo" more than anything else.
 *   5. Grade, vignette, grain -- small individually, but together they turn a
 *      render into a photograph.
 */

import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  NormalPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  SSAOEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  pixelRatio: number;
  shadowMapSize: number;
  ssao: boolean;
  bloom: boolean;
  smaa: boolean;
  grain: boolean;
  chromaticAberration: boolean;
  /** Terrain detail-normal strength. */
  detailFade: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: {
    pixelRatio: 1,
    shadowMapSize: 1024,
    ssao: false,
    bloom: true, // kept even on low -- it carries the art direction
    smaa: false,
    grain: false,
    chromaticAberration: false,
    detailFade: 0.5,
  },
  medium: {
    pixelRatio: 1,
    shadowMapSize: 2048,
    ssao: true,
    bloom: true,
    smaa: true,
    grain: true,
    chromaticAberration: false,
    detailFade: 1,
  },
  high: {
    pixelRatio: 1.25,
    shadowMapSize: 2048,
    ssao: true,
    bloom: true,
    smaa: true,
    grain: true,
    chromaticAberration: true,
    detailFade: 1,
  },
  ultra: {
    pixelRatio: 1.6,
    shadowMapSize: 4096,
    ssao: true,
    bloom: true,
    smaa: true,
    grain: true,
    chromaticAberration: true,
    detailFade: 1,
  },
};

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly composer: EffectComposer;

  quality: QualityLevel = 'high';
  private settings: QualitySettings;
  private camera: THREE.PerspectiveCamera;
  private renderPass: RenderPass;
  private normalPass: NormalPass | null = null;
  private effectPass: EffectPass | null = null;
  /** Chromatic aberration is a convolution effect, so it cannot share a pass. */
  private aberrationPass: EffectPass | null = null;
  private bloom!: BloomEffect;

  /** Milliseconds spent in the last frame's render call. */
  frameMs = 0;
  /** Totals across every pass of the last frame, not just the final one. */
  drawCalls = 0;
  triangles = 0;

  constructor(container: HTMLElement, camera: THREE.PerspectiveCamera, quality: QualityLevel = 'high') {
    this.camera = camera;
    this.quality = quality;
    this.settings = QUALITY[quality];

    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // SMAA handles it; MSAA would conflict with the composer
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.pixelRatio));
    this.gl.setSize(container.clientWidth, container.clientHeight);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping is done in the composer so that bloom operates on HDR values.
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color('#0b1018');

    this.composer = new EffectComposer(this.gl, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    this.renderPass = new RenderPass(this.scene, camera);
    this.composer.addPass(this.renderPass);

    this.buildEffects();
  }

  private buildEffects(): void {
    // Tear down any existing effect passes before rebuilding.
    for (const pass of [this.effectPass, this.aberrationPass, this.normalPass]) {
      if (pass) {
        this.composer.removePass(pass);
        pass.dispose();
      }
    }
    this.effectPass = null;
    this.aberrationPass = null;
    this.normalPass = null;

    const s = this.settings;
    const effects = [];

    if (s.ssao) {
      this.normalPass = new NormalPass(this.scene, this.camera);
      this.composer.addPass(this.normalPass);
      effects.push(
        new SSAOEffect(this.camera, this.normalPass.texture, {
          blendFunction: BlendFunction.MULTIPLY,
          worldDistanceThreshold: 1200,
          worldDistanceFalloff: 400,
          worldProximityThreshold: 8,
          worldProximityFalloff: 4,
          luminanceInfluence: 0.6,
          samples: 16,
          rings: 5,
          radius: 0.06,
          intensity: 2.2,
          bias: 0.03,
          fade: 0.02,
          resolutionScale: 0.6,
        }),
      );
    }

    if (s.bloom) {
      this.bloom = new BloomEffect({
        blendFunction: BlendFunction.ADD,
        // A high threshold keeps bloom on genuine light sources -- emissive
        // strips, muzzle flashes, the filament -- rather than fogging the image.
        luminanceThreshold: 0.72,
        luminanceSmoothing: 0.3,
        intensity: 1.35,
        mipmapBlur: true,
        radius: 0.72,
      });
      effects.push(this.bloom);
    }

    effects.push(
      new ToneMappingEffect({
        mode: ToneMappingMode.ACES_FILMIC,
      }),
    );

    effects.push(
      new VignetteEffect({
        offset: 0.32,
        darkness: 0.42,
      }),
    );

    if (s.grain) {
      const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY });
      // Very light. Grain you can consciously see is too much grain.
      (noise as unknown as { blendMode: { opacity: { value: number } } }).blendMode.opacity.value = 0.055;
      effects.push(noise);
    }

    if (s.smaa) {
      effects.push(new SMAAEffect({ preset: SMAAPreset.HIGH }));
    }

    this.effectPass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.effectPass);

    if (s.chromaticAberration) {
      // Radially modulated aberration is a convolution effect and must own its
      // pass. Applied last so it fringes the finished, graded image.
      this.aberrationPass = new EffectPass(
        this.camera,
        new ChromaticAberrationEffect({
          offset: new THREE.Vector2(0.0006, 0.0006),
          radialModulation: true,
          modulationOffset: 0.45,
        }),
      );
      this.composer.addPass(this.aberrationPass);
    }
  }

  setQuality(level: QualityLevel): void {
    this.quality = level;
    this.settings = QUALITY[level];
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.pixelRatio));
    this.buildEffects();
  }

  get currentSettings(): QualitySettings {
    return this.settings;
  }

  /** Bloom intensity, raised briefly by big explosions. */
  setBloomBoost(v: number): void {
    if (this.bloom) this.bloom.intensity = 1.35 + v;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(width, height);
    this.composer.setSize(width, height);
  }

  render(dt: number): void {
    const t0 = performance.now();
    // The composer runs several passes; letting Three auto-reset would leave
    // the counters showing only the final fullscreen quad.
    this.gl.info.autoReset = false;
    this.gl.info.reset();
    this.composer.render(dt);
    this.drawCalls = this.gl.info.render.calls;
    this.triangles = this.gl.info.render.triangles;
    this.frameMs = performance.now() - t0;
  }

  dispose(): void {
    this.composer.dispose();
    this.gl.dispose();
  }
}
