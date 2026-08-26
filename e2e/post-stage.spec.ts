import { expect, test } from 'playwright/test';

/**
 * Browser-level guarantees for the owned post stage.
 *
 * The composer this replaces failed in two specific ways: it could intermittently
 * present a black frame, and it leaked eleven targets when rebuilt. Both are
 * asserted here against the real renderer rather than a unit double, because both
 * were runtime faults that a descriptor-level test cannot see.
 */

const TARGETS = 8;

interface StageProbe {
  quality: string;
  postProcessingLevel: string;
  diagnostics: {
    allocations: number;
    disposals: number;
    live: number;
    width: number;
    height: number;
    samples: number;
    hasDepthTexture: boolean;
    contextLost: boolean;
    bloomLevels: number;
  } | null;
  textures: number;
  drawCalls: number;
}

async function probe(page: import('playwright/test').Page, quality: string): Promise<StageProbe> {
  return page.evaluate((level) => {
    const renderer = (window as any).RWW.renderer;
    renderer.setQuality(level);
    renderer.render(1 / 60);
    return {
      quality: renderer.quality,
      postProcessingLevel: renderer.currentSettings.postProcessingLevel,
      diagnostics: renderer.postStageDiagnostics,
      textures: renderer.gl.info.memory.textures,
      drawCalls: renderer.drawCalls,
    };
  }, quality);
}

test('the frozen Low path allocates no post target and renders direct', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?seed=20260731&quality=low');
  await page.waitForFunction(() => Boolean((window as any).RWW));
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

  const low = await probe(page, 'low');
  expect(low.postProcessingLevel).toBe('none');
  expect(low.diagnostics).toBeNull();
  expect(errors).toEqual([]);
});

test('holds one post target across resize and quality churn', async ({ page }) => {
  await page.goto('/?seed=20260731&quality=high');
  await page.waitForFunction(() => Boolean((window as any).RWW));
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

  const result = await page.evaluate(() => {
    const renderer = (window as any).RWW.renderer;
    // Resize storm first: the previous composer rebuilt its whole chain on every
    // resize, which is where the eleven-target leak came from.
    for (let index = 0; index < 24; index++) {
      renderer.resize(1000 + index * 4, 600 + (index % 5) * 3);
      renderer.render(1 / 60);
    }
    const afterResize = renderer.postStageDiagnostics;

    // Then tier churn, including repeated transitions across the none/standard
    // boundary, which is what creates and destroys the stage.
    const order = ['low', 'high', 'ultra', 'medium', 'low', 'high', 'low', 'ultra'];
    for (const level of order) {
      renderer.setQuality(level);
      renderer.render(1 / 60);
    }
    renderer.setQuality('high');
    renderer.render(1 / 60);

    return {
      afterResize,
      afterChurn: renderer.postStageDiagnostics,
      textures: renderer.gl.info.memory.textures,
    };
  });

  // One full target set for the whole resize storm: the HDR scene target plus
  // five bloom mips, all resized in place.
  expect(result.afterResize!.allocations).toBe(TARGETS);
  expect(result.afterResize!.live).toBe(TARGETS);
  expect(result.afterResize!.bloomLevels).toBe(5);

  // Each crossing back into a post tier builds exactly one target, and the
  // previous one was disposed rather than abandoned. Four standard tiers are
  // entered in the churn sequence after the initial one.
  expect(result.afterChurn!.live).toBe(TARGETS);
  expect(result.afterChurn!.allocations).toBeLessThanOrEqual(TARGETS * 2);
  expect(result.afterChurn!.samples).toBe(4);
  expect(result.afterChurn!.hasDepthTexture).toBe(true);
  expect(result.afterChurn!.contextLost).toBe(false);
});

test('never presents a black frame over a sustained run on the post path', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?seed=20260731&quality=ultra');
  await page.waitForFunction(() => Boolean((window as any).RWW));
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

  const frames = await page.evaluate(() => {
    const renderer = (window as any).RWW.renderer;
    const gl = renderer.gl.getContext();
    const width = 64;
    const height = 48;
    const pixels = new Uint8Array(width * height * 4);
    const means: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      renderer.render(1 / 60);
      gl.readPixels(
        Math.floor((gl.drawingBufferWidth - width) / 2),
        Math.floor((gl.drawingBufferHeight - height) / 2),
        width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels,
      );
      let sum = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        sum += pixels[index]! * 0.2126 + pixels[index + 1]! * 0.7152 + pixels[index + 2]! * 0.0722;
      }
      means.push(sum / (pixels.length / 4));
    }
    return { means, quality: renderer.quality, diagnostics: renderer.postStageDiagnostics };
  });

  expect(frames.diagnostics).not.toBeNull();
  expect(frames.means).toHaveLength(120);
  // Not one frame may go black. This is the exact fault that removed the
  // previous composer, and it was intermittent, so every frame is checked.
  expect(Math.min(...frames.means)).toBeGreaterThan(1);
  expect(frames.diagnostics!.allocations).toBe(TARGETS);
  expect(errors).toEqual([]);
});

test('rebuilds the post target after a simulated context loss', async ({ page }) => {
  await page.goto('/?seed=20260731&quality=high');
  await page.waitForFunction(() => Boolean((window as any).RWW));
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

  const result = await page.evaluate(async () => {
    const renderer = (window as any).RWW.renderer;
    renderer.render(1 / 60);
    const before = renderer.postStageDiagnostics;

    renderer.handleContextLoss();
    const lost = renderer.postStageDiagnostics;

    // Resize is the path the game takes back to a sized target after a restore.
    renderer.resize(1100, 640);
    renderer.render(1 / 60);
    const after = renderer.postStageDiagnostics;
    return { before, lost, after };
  });

  expect(result.before!.live).toBe(TARGETS);
  // Handles are dropped, not deleted, so no invalid delete is issued against a
  // context that no longer owns them.
  expect(result.lost!.live).toBe(0);
  expect(result.lost!.disposals).toBe(0);
  expect(result.lost!.contextLost).toBe(true);
  expect(result.after!.live).toBe(TARGETS);
  expect(result.after!.allocations).toBe(TARGETS * 2);
  expect(result.after!.contextLost).toBe(false);
});
