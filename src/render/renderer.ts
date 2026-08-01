/**
 * Stable forward renderer for the playable slice.
 *
 * Gate 1 values correctness over a decorative post stack. The previous
 * composer path could intermittently output a black frame and leaked eleven
 * bloom targets whenever it was rebuilt. Direct rendering keeps Three's ACES
 * output transform and hardware antialiasing on the default framebuffer while
 * preserving the quality presets used by the rest of the game.
 */

import * as THREE from 'three';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  pixelRatio: number;
  shadowMapSize: number;
  shadows: boolean;
  /** Terrain detail-normal strength. */
  detailFade: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: {
    pixelRatio: 1,
    shadowMapSize: 1024,
    shadows: false,
    detailFade: 0.4,
  },
  medium: {
    pixelRatio: 1,
    shadowMapSize: 1536,
    shadows: true,
    detailFade: 0.8,
  },
  high: {
    pixelRatio: 1.25,
    shadowMapSize: 2048,
    shadows: true,
    detailFade: 1,
  },
  ultra: {
    pixelRatio: 1.5,
    shadowMapSize: 4096,
    shadows: true,
    detailFade: 1,
  },
};

const ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

function snapRatio(raw: number, cap: number): number {
  const snapped = Math.round(raw * 4) / 4;
  return Math.max(0.5, Math.min(snapped, cap));
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

  constructor(container: HTMLElement, camera: THREE.PerspectiveCamera, quality: QualityLevel = 'high') {
    this.camera = camera;
    this.quality = quality;
    this.settings = QUALITY[quality];

    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.15;
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
  }

  resize(width: number, height: number): void {
    const safeWidth = Math.max(2, Math.round(width));
    const safeHeight = Math.max(2, Math.round(height));
    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(safeWidth, safeHeight, false);
    this.gl.domElement.style.width = '100%';
    this.gl.domElement.style.height = '100%';
  }

  render(dt: number): void {
    this.governQuality(dt);
    const t0 = performance.now();
    this.gl.info.autoReset = true;
    this.gl.setRenderTarget(null);
    this.gl.render(this.scene, this.camera);
    this.drawCalls = this.gl.info.render.calls;
    this.triangles = this.gl.info.render.triangles;
    this.frameMs = performance.now() - t0;
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
    this.gl.dispose();
  }
}
