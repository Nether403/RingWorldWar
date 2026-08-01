import { expect, test, type Page } from 'playwright/test';
import type { Game } from '../src/game';
import type { RenderAnchor } from '../src/render/anchor';
import type { CameraRig } from '../src/render/cameraRig';
import type { Renderer } from '../src/render/renderer';

declare global {
  interface Window {
    RWW?: {
      game: Game;
      rig: CameraRig;
      anchor: RenderAnchor;
      renderer: Renderer;
    };
  }
}

async function canvasStats(page: Page): Promise<{ mean: number; variance: number }> {
  return page.evaluate(() => {
    const renderer = window.RWW!.renderer;
    renderer.render(1 / 60);
    const gl = renderer.gl.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const sampleWidth = Math.min(256, width);
    const sampleHeight = Math.min(192, height);
    const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
    gl.readPixels(
      Math.floor((width - sampleWidth) / 2),
      Math.floor((height - sampleHeight) / 2),
      sampleWidth,
      sampleHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let sum = 0;
    let sumSquares = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
      sum += luminance;
      sumSquares += luminance * luminance;
    }
    const count = pixels.length / 4;
    const mean = sum / count;
    return { mean, variance: sumSquares / count - mean * mean };
  });
}

async function lowerCanvasVariance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const renderer = window.RWW!.renderer;
    renderer.render(1 / 60);
    const gl = renderer.gl.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const sampleWidth = Math.min(320, width);
    const sampleHeight = Math.min(160, Math.floor(height * 0.3));
    const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
    gl.readPixels(
      Math.floor((width - sampleWidth) / 2),
      Math.floor(height * 0.08),
      sampleWidth,
      sampleHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let sum = 0;
    let sumSquares = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
      sum += luminance;
      sumSquares += luminance * luminance;
    }
    const count = pixels.length / 4;
    const mean = sum / count;
    return sumSquares / count - mean * mean;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?seed=20260731&quality=high');
  await page.waitForFunction(() => Boolean(window.RWW));
});

test('keeps the rendered world visible during a sustained run', async ({ page }) => {
  await page.waitForTimeout(8_000);
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(100);
  const stats = await canvasStats(page);
  expect(stats.mean).toBeGreaterThan(4);
  expect(stats.variance).toBeGreaterThan(5);
  expect(await page.evaluate(() => window.RWW!.game.world.units.length)).toBeGreaterThan(0);
});

test('keeps the ring surface visible in an ultrawide viewport', async ({ page }) => {
  await page.setViewportSize({ width: 2000, height: 720 });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.RWW));
  await page.evaluate(() => {
    window.RWW!.game.world.time = 66;
  });
  await page.waitForTimeout(500);

  const centerGround = await page.evaluate(() => {
    const { game, rig } = window.RWW!;
    return game.pickGround(0, 0, rig.camera);
  });
  const stats = await canvasStats(page);
  const lowerVariance = await lowerCanvasVariance(page);

  expect(centerGround).not.toBeNull();
  expect(stats.mean).toBeGreaterThan(4);
  expect(stats.variance).toBeGreaterThan(20);
  expect(lowerVariance).toBeGreaterThan(50);

  const qualityVariances: Record<string, number> = {};
  for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
    await page.evaluate((level) => window.RWW!.renderer.setQuality(level), quality);
    qualityVariances[quality] = await lowerCanvasVariance(page);
  }
  expect(Math.min(...Object.values(qualityVariances))).toBeGreaterThan(50);
});

test('releases render resources when the viewport is rebuilt', async ({ page }) => {
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(100);
  const textureCounts = await page.evaluate(() => {
    const renderer = window.RWW!.renderer;
    const counts = [renderer.gl.info.memory.textures];
    const qualities = ['low', 'medium', 'high', 'ultra', 'medium', 'low'] as const;
    for (let i = 0; i < qualities.length; i++) {
      renderer.setQuality(qualities[i]!);
      renderer.resize(1100 + (i % 2) * 2, 640);
      renderer.render(1 / 60);
      renderer.gl.getContext().finish();
      counts.push(renderer.gl.info.memory.textures);
    }
    return counts;
  });

  expect(Math.max(...textureCounts) - Math.min(...textureCounts)).toBeLessThanOrEqual(2);
});
