/**
 * Forward renderer for the playable slice, with an optional owned post stage.
 *
 * Gate 1 removed a general composer because it could intermittently output a
 * black frame and leaked eleven bloom targets whenever it was rebuilt. Direct
 * rendering remains the frozen path and is still exactly what Low does.
 *
 * Medium and above now route through `PostStage`: one multisampled colour
 * target, one owned fullscreen material, explicit disposal, explicit context-loss
 * recovery, and an allocation counter so a leak fails a test. See
 * `docs/procedural-graphics-overhaul.md` Task 2. The stage is currently a
 * passthrough and is intended to be pixel-identical to direct rendering; it
 * exists first so the target lifecycle is proven before bloom, ambient
 * occlusion, and grading depend on it.
 */

import * as THREE from 'three';
import { PostStage } from './postStage';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export const BASE_EXPOSURE = 1.15;

export interface QualitySettings {
  pixelRatio: number;
  shadowMapSize: number;
  shadows: boolean;
  /** Terrain detail-normal strength. */
  detailFade: number;
  /**
   * Terrain fragment detail octaves, and the three terrain features a tier can
   * switch off. These are separate settings rather than more meanings loaded onto
   * `detailFade` so that what a tier actually gives up is readable here.
   *
   * Low ignores all four: it runs a different material entirely.
   */
  terrainFineOctaves: number;
  terrainTriplanarRim: boolean;
  terrainDustDrift: number;
  terrainMicroDetail: number;
  /** Camera far plane in world metres. */
  drawDistance: number;
  /** Maximum live effect particles. */
  particleCap: number;
  /** Maximum pooled explosion lights participating in PBR shading. */
  effectLightCap: number;
  /** Presentation-only ruin visibility distance. */
  dressingDistance: number;
  /** Total visible presentation-only ruin instances. */
  dressingCap: number;
  /** Whether environmental dressing participates in the shadow pass. */
  dressingShadows: boolean;
  scarCap: number;
  debrisCap: number;
  smokeEmitterCap: number;
  /**
   * `none` renders direct to the default framebuffer, which is the frozen Low
   * path. `standard` routes through the owned `PostStage`.
   */
  postProcessingLevel: 'none' | 'standard';
  /**
   * Bloom contribution on the post path. Ignored when `postProcessingLevel` is
   * `none`, since Low has no post stage to bloom with.
   */
  bloomStrength: number;
  /**
   * Ambient-occlusion contribution on the post path. Zero skips the occlusion
   * passes outright rather than computing them and discarding the result.
   */
  aoStrength: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: {
    pixelRatio: 1,
    shadowMapSize: 1024,
    shadows: false,
    detailFade: 0.4,
    terrainFineOctaves: 2,
    terrainTriplanarRim: false,
    terrainDustDrift: 0,
    terrainMicroDetail: 0,
    drawDistance: 8_000,
    particleCap: 225,
    effectLightCap: 2,
    dressingDistance: 1_400,
    dressingCap: 72,
    dressingShadows: false,
    scarCap: 24,
    debrisCap: 48,
    smokeEmitterCap: 6,
    postProcessingLevel: 'none',
    bloomStrength: 0,
    aoStrength: 0,
  },
  medium: {
    pixelRatio: 1,
    shadowMapSize: 1536,
    shadows: true,
    detailFade: 0.8,
    terrainFineOctaves: 2,
    terrainTriplanarRim: false,
    terrainDustDrift: 0,
    terrainMicroDetail: 0,
    drawDistance: 12_000,
    particleCap: 450,
    effectLightCap: 8,
    dressingDistance: 1_900,
    dressingCap: 112,
    dressingShadows: true,
    scarCap: 48,
    debrisCap: 96,
    smokeEmitterCap: 12,
    postProcessingLevel: 'standard',
    bloomStrength: 0.42,
    aoStrength: 0.55,
  },
  high: {
    pixelRatio: 1.25,
    shadowMapSize: 2048,
    shadows: true,
    detailFade: 1,
    terrainFineOctaves: 3,
    terrainTriplanarRim: true,
    terrainDustDrift: 1,
    terrainMicroDetail: 0,
    drawDistance: 18_000,
    particleCap: 675,
    effectLightCap: 14,
    dressingDistance: 2_400,
    dressingCap: 192,
    dressingShadows: true,
    scarCap: 72,
    debrisCap: 160,
    smokeEmitterCap: 20,
    postProcessingLevel: 'standard',
    bloomStrength: 0.55,
    aoStrength: 0.7,
  },
  ultra: {
    pixelRatio: 1.5,
    shadowMapSize: 4096,
    shadows: true,
    detailFade: 1,
    terrainFineOctaves: 3,
    terrainTriplanarRim: true,
    terrainDustDrift: 1,
    terrainMicroDetail: 1,
    drawDistance: 26_000,
    particleCap: 900,
    effectLightCap: 14,
    dressingDistance: 3_000,
    dressingCap: 256,
    dressingShadows: true,
    scarCap: 96,
    debrisCap: 256,
    smokeEmitterCap: 32,
    postProcessingLevel: 'standard',
    bloomStrength: 0.68,
    aoStrength: 0.8,
  },
};

const ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

function snapRatio(raw: number, cap: number): number {
  const snapped = Math.round(raw * 4) / 4;
  return Math.max(0.5, Math.min(snapped, cap));
}

export interface ShaderPrewarmMetrics {
  durationMilliseconds: number;
  parallelCompileSupported: boolean;
  programsBefore: number;
  programsAfterForwardWarm: number;
  programsAfterShadowWarm: number;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();

  quality: QualityLevel;
  private settings: QualitySettings;
  private readonly camera: THREE.PerspectiveCamera;

  frameMs = 0;
  drawCalls = 0;
  triangles = 0;

  private avgFrameMs = 16;
  private governorCooldown = 8;
  autoQuality = true;
  onQualityChange: ((settings: QualitySettings) => void) | null = null;
  prewarmMetrics: ShaderPrewarmMetrics | null = null;
  private postStage: PostStage | null = null;

  constructor(container: HTMLElement, camera: THREE.PerspectiveCamera, quality: QualityLevel = 'high') {
    this.camera = camera;
    this.quality = quality;
    this.settings = QUALITY[quality];

    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    try {
      this.gl = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: 'high-performance',
        stencil: false,
        depth: true,
      });
    } catch (error) {
      canvas.remove();
      throw error;
    }
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = BASE_EXPOSURE;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#0b1018');

    this.applyQuality();
    this.resize(container.clientWidth, container.clientHeight);
  }

  setQuality(level: QualityLevel): void {
    if (level === this.quality) return;
    this.quality = level;
    this.settings = QUALITY[level];
    this.applyQuality();
    this.resize(this.gl.domElement.clientWidth, this.gl.domElement.clientHeight);
    this.onQualityChange?.(this.settings);
  }

  get currentSettings(): QualitySettings {
    return this.settings;
  }

  private applyQuality(): void {
    this.gl.setPixelRatio(snapRatio(window.devicePixelRatio, this.settings.pixelRatio));
    this.gl.shadowMap.enabled = this.settings.shadows;
    this.camera.far = this.settings.drawDistance;
    this.camera.updateProjectionMatrix();
    this.syncPostStage();
  }

  /**
   * Create or release the post stage for the active tier.
   *
   * The stage is kept alive across resizes and only destroyed when a tier
   * genuinely does not want one, so quality churn cannot accumulate targets.
   */
  private syncPostStage(): void {
    const wanted = this.settings.postProcessingLevel === 'standard';
    if (wanted && !this.postStage) {
      this.postStage = new PostStage();
      this.sizePostStage();
    } else if (!wanted && this.postStage) {
      this.postStage.dispose();
      this.postStage = null;
    }
    this.postStage?.setBloomStrength(this.settings.bloomStrength);
    this.postStage?.setAoStrength(this.settings.aoStrength);
    // Ownership of tone mapping follows the path. On the direct path Three tone
    // maps per material as it always has. On the post path the scene writes
    // linear HDR into the target and the composite tone maps once, which is what
    // lets values above 1.0 survive to be bloomed.
    //
    // This is set here rather than per frame on purpose: `toneMapping` is a
    // material compile key, so changing it mid-frame would recompile the world.
    this.gl.toneMapping = wanted ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  }

  private sizePostStage(): void {
    if (!this.postStage) return;
    // Drawing-buffer size, not CSS size: the target must match what the scene is
    // actually rasterised at, which includes the tier's pixel ratio.
    this.gl.getDrawingBufferSize(_bufferSize);
    this.postStage.setSize(_bufferSize.x, _bufferSize.y);
  }

  /**
   * Drive the day/night grade.
   *
   * `nightMix` is 0 in full daylight and 1 in full shadow, so callers normally
   * pass `1 - daylight`. `grainTime` is explicit rather than read from a clock so
   * a caller that holds it constant gets a reproducible frame.
   *
   * A no-op on the direct path: Low has no full-screen pass to grade in, and
   * adding one would break its frozen budget. Recorded as a Low omission in
   * docs/t480s-low-performance.md.
   */
  setGrade(nightMix: number, grainTime: number): void {
    this.postStage?.setGrade(nightMix, grainTime);
  }

  /** Diagnostics for the owned post stage, or null on the direct path. */
  get postStageDiagnostics(): ReturnType<PostStage['diagnostics']> | null {
    return this.postStage?.diagnostics() ?? null;
  }

  resize(width: number, height: number): void {
    const safeWidth = Math.max(2, Math.round(width));
    const safeHeight = Math.max(2, Math.round(height));
    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(safeWidth, safeHeight, false);
    this.gl.domElement.style.width = '100%';
    this.gl.domElement.style.height = '100%';
    this.sizePostStage();
  }

  async prewarmActiveQuality(asyncCompile = true): Promise<ShaderPrewarmMetrics> {
    const started = performance.now();
    const programsBefore = this.gl.info.programs?.length ?? 0;
    const parallelCompileSupported = this.gl.getContext().getExtension('KHR_parallel_shader_compile') !== null;
    if (asyncCompile) await this.gl.compileAsync(this.scene, this.camera);
    else this.gl.compile(this.scene, this.camera);
    const programsAfterForwardWarm = this.gl.info.programs?.length ?? 0;
    // Three creates generated shadow-depth programs during the real shadow pass,
    // not during compileAsync. The boot overlay still covers this direct render.
    // Routed through the post stage so the composite program is warm too, rather
    // than compiling on the first playable frame.
    this.drawFrame();
    const programsAfterShadowWarm = this.gl.info.programs?.length ?? 0;
    this.prewarmMetrics = {
      durationMilliseconds: performance.now() - started,
      parallelCompileSupported,
      programsBefore,
      programsAfterForwardWarm,
      programsAfterShadowWarm,
    };
    return this.prewarmMetrics;
  }

  render(dt: number): void {
    this.governQuality(dt);
    const t0 = performance.now();
    // Manual counter lifecycle. The post path issues two render calls, and
    // autoReset would discard the scene pass totals before they could be read,
    // leaving every draw-call diagnostic reporting just the composite.
    this.gl.info.autoReset = false;
    this.gl.info.reset();
    this.drawFrame();
    this.drawCalls = this.gl.info.render.calls;
    this.triangles = this.gl.info.render.triangles;
    this.frameMs = performance.now() - t0;
  }

  private drawFrame(): void {
    if (this.postStage) {
      // Exposure is read from the renderer rather than passed in, so callers that
      // already animate `toneMappingExposure` (the explosion flash in main.ts)
      // keep working unchanged on both paths.
      this.postStage.render(this.gl, this.scene, this.camera, this.gl.toneMappingExposure);
      return;
    }
    this.gl.setRenderTarget(null);
    this.gl.render(this.scene, this.camera);
  }

  /**
   * Release renderer-owned GPU handles belonging to a lost context without
   * issuing deletes against it. The stage reallocates on the next frame.
   */
  handleContextLoss(): void {
    this.postStage?.handleContextLoss();
  }

  private governQuality(dt: number): void {
    if (!this.autoQuality) return;
    const ms = Math.min(dt * 1000, 200);
    this.avgFrameMs += (ms - this.avgFrameMs) * 0.02;
    this.governorCooldown -= dt;
    if (this.governorCooldown > 0) return;

    const index = ORDER.indexOf(this.quality);
    if (this.avgFrameMs > 26 && index > 0) {
      this.setQuality(ORDER[index - 1]!);
      this.governorCooldown = 12;
      this.avgFrameMs = 16;
    } else if (this.avgFrameMs < 11 && index < ORDER.length - 1) {
      this.setQuality(ORDER[index + 1]!);
      this.governorCooldown = 16;
      this.avgFrameMs = 16;
    }
  }

  get smoothedFrameMs(): number {
    return this.avgFrameMs;
  }

  dispose(): void {
    this.onQualityChange = null;
    this.postStage?.dispose();
    this.postStage = null;
    this.scene.clear();
    this.gl.dispose();
    this.gl.forceContextLoss();
    this.gl.domElement.remove();
  }
}

const _bufferSize = new THREE.Vector2();
