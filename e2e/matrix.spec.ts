import { expect, test } from 'playwright/test';
import type { Game } from '../src/game';
import type { CameraRig } from '../src/render/cameraRig';
import type { Environment } from '../src/render/environment';
import type { Renderer } from '../src/render/renderer';

interface MatrixSession {
  game: Game;
  rig: CameraRig;
  renderer: Renderer;
  environment: Environment;
  startup(): {
    firstPlayableAt: number | null;
    durationMilliseconds: number | null;
  };
}

test('boots a playable WebGL2 frame without browser errors', async ({ page, browser, browserName }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?seed=701&quality=low');
  await page.waitForFunction(() => {
    const session = (window as unknown as { RWW?: MatrixSession }).RWW;
    return Boolean(session && session.startup().firstPlayableAt !== null);
  });
  const initialTick = await page.evaluate(() =>
    (window as unknown as { RWW: MatrixSession }).RWW.game.world.tick);
  await page.waitForFunction((tick) =>
    (window as unknown as { RWW: MatrixSession }).RWW.game.world.tick > tick, initialTick);

  const result = await page.evaluate(() => {
    const session = (window as unknown as { RWW: MatrixSession }).RWW;
    const renderer = session.renderer;
    renderer.render(1 / 60);
    const gl = renderer.gl.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const sampleWidth = Math.min(160, width);
    const sampleHeight = Math.min(120, height);
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
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = 0.2126 * pixels[index]! +
        0.7152 * pixels[index + 1]! +
        0.0722 * pixels[index + 2]!;
      sum += luminance;
      sumSquares += luminance * luminance;
    }
    const pixelCount = pixels.length / 4;
    const mean = sum / pixelCount;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const unmasked = debug as WEBGL_debug_renderer_info | null;
    const vendor = unmasked
      ? String(gl.getParameter(unmasked.UNMASKED_VENDOR_WEBGL))
      : String(gl.getParameter(gl.VENDOR));
    const rendererName = unmasked
      ? String(gl.getParameter(unmasked.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    return {
      startup: session.startup(),
      tick: session.game.world.tick,
      quality: renderer.quality,
      contextVersion: String(gl.getParameter(gl.VERSION)),
      contextLost: gl.isContextLost(),
      width,
      height,
      vendor,
      renderer: rendererName,
      softwareRenderer: /swiftshader|llvmpipe|software|microsoft basic render/i.test(rendererName),
      programs: renderer.gl.info.programs?.length ?? 0,
      mean,
      variance: sumSquares / pixelCount - mean * mean,
      centerGround: session.game.pickGround(0, 0, session.rig.camera),
    };
  });

  const evidence = {
    project: testInfo.project.name,
    browserName,
    browserVersion: browser.version(),
    ...result,
    consoleErrors,
    pageErrors,
  };
  console.log('phase4e browser evidence', JSON.stringify(evidence));

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(result.startup.durationMilliseconds).toBeGreaterThan(0);
  expect(result.startup.durationMilliseconds).toBeLessThan(30_000);
  expect(result.quality).toBe('low');
  expect(result.contextVersion).toContain('WebGL 2');
  expect(result.contextLost).toBe(false);
  expect(result.width).toBeGreaterThanOrEqual(960);
  expect(result.height).toBeGreaterThanOrEqual(540);
  expect(result.programs).toBeGreaterThan(0);
  expect(result.mean).toBeGreaterThan(4);
  expect(result.variance).toBeGreaterThan(5);
  expect(result.centerGround).not.toBeNull();
  expect(result.tick).toBeGreaterThan(initialTick);
});

test('restores the same match after WebGL context loss', async ({ page, browser, browserName }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?seed=702&quality=medium');
  await page.waitForFunction(() => {
    const session = (window as unknown as { RWW?: MatrixSession }).RWW;
    return Boolean(session && session.startup().firstPlayableAt !== null);
  });
  const beforeTick = await page.evaluate(() =>
    (window as unknown as { RWW: MatrixSession }).RWW.game.world.tick);
  const extensionAvailable = await page.evaluate(() => {
    const target = window as unknown as {
      RWW: MatrixSession;
      matrixLossExtension?: WEBGL_lose_context;
    };
    const extension = target.RWW.renderer.gl.getContext().getExtension('WEBGL_lose_context');
    if (!extension) return false;
    target.matrixLossExtension = extension;
    extension.loseContext();
    return true;
  });
  expect(extensionAvailable).toBe(true);
  await expect(page.locator('[data-rww-context-recovery]')).toBeVisible();
  const pausedTick = await page.evaluate(() =>
    (window as unknown as { RWW: MatrixSession }).RWW.game.world.tick);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() =>
    (window as unknown as { RWW: MatrixSession }).RWW.game.world.tick)).toBe(pausedTick);

  await page.evaluate(() =>
    (window as unknown as { matrixLossExtension: WEBGL_lose_context }).matrixLossExtension.restoreContext());
  await expect(page.locator('[data-rww-context-recovery]')).toHaveCount(0);
  await page.waitForFunction((tick) =>
    (window as unknown as { RWW: MatrixSession }).RWW.game.world.tick > tick, beforeTick);

  const result = await page.evaluate(() => {
    const session = (window as unknown as { RWW: MatrixSession }).RWW;
    const gl = session.renderer.gl.getContext();
    return {
      tick: session.game.world.tick,
      contextLost: gl.isContextLost(),
      programs: session.renderer.gl.info.programs?.length ?? 0,
      shadowMapPresent: session.environment.keyLight.shadow.map !== null,
      centerGround: session.game.pickGround(0, 0, session.rig.camera),
    };
  });
  console.log('phase4e recovery evidence', JSON.stringify({
    project: testInfo.project.name,
    browserName,
    browserVersion: browser.version(),
    ...result,
    consoleErrors,
    pageErrors,
  }));

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(result.contextLost).toBe(false);
  expect(result.programs).toBeGreaterThan(0);
  expect(result.shadowMapPresent).toBe(true);
  expect(result.centerGround).not.toBeNull();
  expect(result.tick).toBeGreaterThan(beforeTick);
});
