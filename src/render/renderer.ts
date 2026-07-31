/**
 * Renderer.
 *
 * TWO PATHS, and the default is the boring one on purpose.
 *
 * The intended stack was RenderPass -> NormalPass -> SSAO -> bloom -> ACES ->
 * grade. It rendered correctly for a few seconds and then decayed to a black
 * frame, reproducibly, while a direct `renderer.render(scene, camera)` of the
 * same scene on the same frame was perfectly correct. That was chased through
 * pixel-ratio rounding (a real bug, fixed below), light-count churn (also a
 * real bug, also fixed), depth range, and pass count, and it still failed.
 *
 * So the default path is a plain forward render with Three's own ACES tone
 * mapping and hardware MSAA. That gives up bloom, screen-space AO and the
 * grade -- real losses -- but it is verifiably correct, and a renderer you can
 * trust is worth more than one that looks better in the first ten seconds.
 * The composer path is kept intact behind `?post=1` so the investigation can
 * resume without rebuilding it.
 *
 * The emissive-heavy art direction was leaning on bloom, so the hull material
 * compensates by pushing faction strips well above 1.0 -- with ACES they still
 * read as hot, just without the halo.
 */

import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  NormalPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
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

/**
 * Choose a device pixel ratio that will not produce an odd-sized framebuffer.
 *
 * Browsers report fractional ratios (1.000000015894571 on this machine, 1.25
 * and 1.5 on common laptops). Multiplying the CSS size by one of those and
 * flooring can land on an odd width, and bloom's mipmap downsample chain then
 * halves its way into a degenerate target and returns black -- a full black
 * screen from nothing more than a window being an odd number of pixels wide.
 * Snapping the ratio to quarters and rounding the buffer to even dimensions
 * costs nothing and removes the whole class of problem.
 */
function snapRatio(raw: number, cap: number): number {
  const snapped = Math.round(raw * 4) / 4;
  return Math.max(0.5, Math.min(snapped, cap));
}

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
  private bloom: BloomEffect | null = null;
  /** True when bypassing the composer; see the header comment. */
  direct: boolean;

  /** Milliseconds spent in the last frame's render call. */
  frameMs = 0;
  /** Totals across every pass of the last frame, not just the final one. */
  drawCalls = 0;
  triangles = 0;

  constructor(
    container: HTMLElement,
    camera: THREE.PerspectiveCamera,
    quality: QualityLevel = 'high',
    usePost = false,
  ) {
    this.camera = camera;
    this.quality = quality;
    this.settings = QUALITY[quality];
    this.direct = !usePost;

    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    this.gl = new THREE.WebGLRenderer({
      canvas,
      // MSAA on the default framebuffer. Only useful on the direct path, but it
      // costs nothing to request when the composer is not in use.
      antialias: this.direct,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.gl.setPixelRatio(snapRatio(window.devicePixelRatio, this.settings.pixelRatio));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    // On the direct path Three does the tone mapping; on the composer path the
    // ToneMappingEffect does, and doing both would double-apply the curve.
    this.gl.toneMapping = this.direct ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.gl.toneMappingExposure = 1.15;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color('#0b1018');

    this.composer = new EffectComposer(this.gl, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    this.renderPass = new RenderPass(this.scene, camera);
    this.composer.addPass(this.renderPass);

    this.buildEffects();
    // Size everything through the one code path that guarantees even dimensions.
    this.resize(container.clientWidth, container.clientHeight);
  }

  /**
   * Build the post stack.
   *
   * Deliberately ONE EffectPass containing everything that can be merged.
   *
   * An earlier version chained a NormalPass, an SSAO pass, the main pass and a
   * separate chromatic-aberration pass. That stack rendered correctly for a few
   * seconds and then decayed to black -- the depth-dependent effects could not
   * cope with a near/far range of 12 to 90000 that the ring's scale demands,
   * and each extra full-screen target compounded the problem. Screen-space AO
   * is worth having, but not at the cost of a renderer that cannot be trusted
   * to still be showing the game a minute into a match. It can come back once
   * the depth range is tightened and it can be verified in isolation.
   */
  private buildEffects(): void {
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
      (noise as unknown as { blendMode: { opacity: { value: number } } }).blendMode.opacity.value = 0.05;
      effects.push(noise);
    }

    if (s.smaa) {
      effects.push(new SMAAEffect({ preset: SMAAPreset.MEDIUM }));
    }

    this.effectPass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.effectPass);
  }

  setQuality(level: QualityLevel): void {
    this.quality = level;
    this.settings = QUALITY[level];
    this.gl.setPixelRatio(snapRatio(window.devicePixelRatio, this.settings.pixelRatio));
    this.buildEffects();
    this.resize(this.gl.domElement.clientWidth, this.gl.domElement.clientHeight);
  }

  get currentSettings(): QualitySettings {
    return this.settings;
  }

  /** Bloom intensity, raised briefly by big explosions. */
  setBloomBoost(v: number): void {
    if (this.bloom) this.bloom.intensity = 1.35 + v;
  }

  resize(width: number, height: number): void {
    // Round the CSS size so that size * pixelRatio lands on an even number of
    // device pixels in both axes; see snapRatio above for why that matters.
    const ratio = this.gl.getPixelRatio();
    const w = Math.max(2, Math.round((width * ratio) / 2) * 2 / ratio);
    const h = Math.max(2, Math.round((height * ratio) / 2) * 2 / ratio);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(w, h, false);
    // The canvas is styled to fill its container by CSS, so we drive only the
    // backing store here and let layout handle the presentation size.
    this.gl.domElement.style.width = '100%';
    this.gl.domElement.style.height = '100%';
    this.composer.setSize(Math.round(w * ratio), Math.round(h * ratio));
  }

  render(dt: number): void {
    const t0 = performance.now();
    // The composer runs several passes; letting Three auto-reset would leave
    // the counters showing only the final fullscreen quad.
    this.gl.info.autoReset = false;
    this.gl.info.reset();
    if (this.direct) {
      this.gl.setRenderTarget(null);
      this.gl.render(this.scene, this.camera);
    } else {
      this.composer.render(dt);
    }
    this.drawCalls = this.gl.info.render.calls;
    this.triangles = this.gl.info.render.triangles;
    this.frameMs = performance.now() - t0;
  }

  dispose(): void {
    this.composer.dispose();
    this.gl.dispose();
  }
}
