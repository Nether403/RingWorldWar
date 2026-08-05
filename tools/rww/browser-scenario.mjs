import { readFile } from 'node:fs/promises';
import { acquireVite } from './browser.mjs';
import { sanitizeSecrets } from './receipt.mjs';

const WINDOWS_ARGS = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const OTHER_ARGS = ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export async function withBrowserScenario(cwd, scenario, operation) {
  const session = await openBrowserScenario(cwd, scenario, { headless: true });
  try {
    const result = await operation(session);
    return {
      ...result,
      browser: session.browserDetails,
      vite: { reused: session.server.reused, url: session.server.url },
      consoleErrors: session.consoleErrors,
      pageErrors: session.pageErrors,
    };
  } finally {
    await session.close();
  }
}

export async function openBrowserScenario(cwd, scenario, { headless = true, handleSignals = true } = {}) {
  const server = await acquireVite(cwd, { handleSignals });
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      headless,
      args: process.platform === 'win32' ? WINDOWS_ARGS : OTHER_ARGS,
    });
    const context = await browser.newContext({
      viewport: { width: scenario.viewport.width, height: scenario.viewport.height },
      deviceScaleFactor: scenario.viewport.deviceScaleFactor,
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(sanitizeSecrets(message.text())); });
    page.on('pageerror', (error) => pageErrors.push(sanitizeSecrets(error.message)));
    const url = `${server.url}/?seed=${scenario.worldSeed}&quality=${scenario.quality}&scenarioDriver=1`;
    await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
    await page.waitForFunction(() => Boolean(window.RWW?.testDriver), undefined, { timeout: 90_000 });
    const preScenarioState = await page.evaluate(async () => {
      const driver = await import('/e2e/support/scenario-driver.ts');
      return driver.captureScenarioState();
    });
    const entityIds = await page.evaluate(async (value) => {
      const driver = await import('/e2e/support/scenario-driver.ts');
      return driver.applyBrowserScenario(value);
    }, scenario);
    const appliedScenarioState = await page.evaluate(async () => {
      const driver = await import('/e2e/support/scenario-driver.ts');
      return driver.captureScenarioState();
    });
    const browserDetails = await page.evaluate(() => {
      const renderer = window.RWW.renderer;
      const gl = renderer.gl.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererName = String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const vendor = String(debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
      return {
        renderer: rendererName,
        vendor,
        softwareRenderer: /(swiftshader|llvmpipe|software|microsoft basic render)/i.test(rendererName),
        drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
        devicePixelRatio: window.devicePixelRatio,
        webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
      };
    });
    let closed = false;
    return {
      page, browser, server, entityIds, preScenarioState, appliedScenarioState,
      browserDetails: { name: browser.browserType().name(), version: browser.version(), ...browserDetails },
      consoleErrors, pageErrors,
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await browser.close();
        } finally {
          await server.stop();
        }
      },
    };
  } catch (error) {
    try {
      await browser?.close();
    } finally {
      await server.stop();
    }
    throw error;
  }
}

export async function captureVisualScenario(cwd, scenario, screenshotPath) {
  return withBrowserScenario(cwd, scenario, async ({ page }) => {
    const frame = await page.evaluate(async (value) => {
      const driver = await import('/e2e/support/scenario-driver.ts');
      return driver.captureScenarioFrame(value);
    }, scenario);
    const screenshot = await page.screenshot({ path: screenshotPath, type: 'png', animations: 'disabled' });
    const pixels = await decodeScreenshot(page, screenshot);
    return { frame: { ...frame, pixels }, screenshotBytes: screenshot.length };
  });
}

export async function benchmarkBrowserScenario(cwd, scenario, warmupSeconds, sampleSeconds, variant = 'default') {
  return withBrowserScenario(cwd, scenario, async ({ page }) => {
    const benchmark = await page.evaluate(async ([warmup, sample, benchmarkVariant]) => {
      const driver = await import('/e2e/support/scenario-driver.ts');
      return driver.benchmarkScenario(warmup, sample, benchmarkVariant);
    }, [warmupSeconds, sampleSeconds, variant]);
    const frame = await page.evaluate(async (value) => {
      const driver = await import('/e2e/support/scenario-driver.ts');
      return driver.captureScenarioFrame(value);
    }, scenario);
    return { benchmark, frame };
  });
}

async function decodeScreenshot(page, png) {
  const base64 = png.toString('base64');
  const pixels = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create screenshot decode context');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let binary = '';
    for (let offset = 0; offset < data.length; offset += 32_768) {
      binary += String.fromCharCode(...data.subarray(offset, offset + 32_768));
    }
    return btoa(binary);
  }, base64);
  return Uint8Array.from(Buffer.from(pixels, 'base64'));
}

export async function readJsonFile(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} file not found: ${path}`);
    if (error instanceof SyntaxError) throw new Error(`${label} is not valid JSON: ${path}`);
    throw error;
  }
}
