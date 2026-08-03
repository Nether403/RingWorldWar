import { expect, test } from 'playwright/test';

test('production PBR calibration renders every generated reference without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dev/calibration?quality=high');
  await page.waitForFunction(() => Boolean((window as unknown as { RWWCalibration?: { ready?: boolean } }).RWWCalibration?.ready));
  await expect(page.locator('#boot')).toHaveCount(0);

  const result = await page.evaluate(() => {
    const calibration = (window as unknown as { RWWCalibration: any; RWW?: unknown }).RWWCalibration;
    calibration.renderFrame();
    const gl = calibration.renderer.gl.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let sum = 0;
    let squared = 0;
    let samples = 0;
    for (let index = 0; index < pixels.length; index += 64) {
      const value = pixels[index]! * 0.2126 + pixels[index + 1]! * 0.7152 + pixels[index + 2]! * 0.0722;
      sum += value;
      squared += value * value;
      samples++;
    }
    const mean = sum / samples;
    return {
      manifest: calibration.manifest,
      canvasCount: document.querySelectorAll('canvas').length,
      chartPatches: calibration.scene.getObjectByName('calibration:macbeth-chart')?.count,
      referenceParts: calibration.scene.getObjectByName('calibration:reference-mech')?.children.length,
      hasGame: Boolean((window as unknown as { RWW?: unknown }).RWW),
      mean,
      variance: squared / samples - mean * mean,
      resources: {
        calls: calibration.renderer.gl.info.render.calls,
        triangles: calibration.renderer.gl.info.render.triangles,
        textures: calibration.renderer.gl.info.memory.textures,
        programs: calibration.renderer.gl.info.programs?.length ?? 0,
      },
    };
  });

  expect(result.canvasCount).toBe(1);
  expect(result.hasGame).toBe(false);
  expect(result.manifest).toMatchObject({
    chromeBalls: 1,
    greyBalls: 1,
    roughnessSamples: 5,
    metalnessSamples: 5,
    macbethPatches: 24,
    materialSwatches: 4,
    referenceMechs: 1,
    quality: 'high',
    toneMapping: 'ACESFilmic',
    outputColorSpace: 'srgb',
    exposure: 1.15,
  });
  expect(result.chartPatches).toBe(24);
  expect(result.referenceParts).toBe(8);
  expect(result.mean).toBeGreaterThan(4);
  expect(result.variance).toBeGreaterThan(20);
  expect(result.resources.calls).toBeLessThanOrEqual(60);
  expect(result.resources.textures).toBeLessThanOrEqual(4);
  expect(errors).toEqual([]);
});
