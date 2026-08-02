import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sanitizeSecrets } from './receipt.mjs';

export async function probeBrowser(cwd) {
  let server;
  try {
    server = await acquireVite(cwd);
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: process.platform === 'win32'
        ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
        : ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      const consoleErrors = [];
      const pageErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(sanitizeSecrets(message.text()));
      });
      page.on('pageerror', (error) => pageErrors.push(sanitizeSecrets(error.message)));
      await page.goto(`${server.url}/?quality=low`, { waitUntil: 'load', timeout: 90_000 });
      await page.waitForFunction(() => Boolean(window.RWW?.renderer), undefined, { timeout: 90_000 });
      const details = await page.evaluate(() => {
        const renderer = window.RWW.renderer;
        const gl = renderer.gl.getContext();
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        const rendererName = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        const name = String(rendererName ?? 'unavailable');
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          devicePixelRatio: window.devicePixelRatio,
          drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
          webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
          vendor: String(vendor ?? 'unavailable'),
          renderer: name,
          softwareRenderer: /(swiftshader|llvmpipe|software|microsoft basic render)/i.test(name),
          limits: {
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            maxCubeMapTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
            maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
            maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
            maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
          },
          extensions: gl.getSupportedExtensions()?.sort() ?? [],
          quality: { level: renderer.quality, adaptive: renderer.autoQuality },
        };
      });
      return {
        status: 'available',
        name: browser.browserType().name(),
        version: browser.version(),
        ...details,
        consoleErrors,
        pageErrors,
        vite: { reused: server.reused, url: server.url },
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    return { status: 'error', error: sanitizeSecrets(error instanceof Error ? error.message : String(error)) };
  } finally {
    await server?.stop();
  }
}

export async function acquireVite(cwd, { handleSignals = true } = {}) {
  const existingUrl = 'http://127.0.0.1:5180';
  if (await isRingWorldWar(existingUrl)) return { url: existingUrl, reused: true, stop: async () => {} };

  const port = await availablePort();
  const vite = resolve(cwd, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  const url = `http://127.0.0.1:${port}`;
  const stop = once(async () => stopChild(child));
  const interrupt = () => { void stop().finally(() => process.exit(4)); };
  if (handleSignals) {
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
  }
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error(`Vite exited before becoming ready: ${logs.trim()}`);
      if (await isRingWorldWar(url)) return {
        url,
        reused: false,
        stop: async () => {
          if (handleSignals) {
            process.removeListener('SIGINT', interrupt);
            process.removeListener('SIGTERM', interrupt);
          }
          await stop();
        },
      };
      await delay(250);
    }
    throw new Error(`Timed out waiting for Vite at ${url}`);
  } catch (error) {
    if (handleSignals) {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
    await stop();
    throw error;
  }
}

async function isRingWorldWar(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(750) });
    return response.ok && (await response.text()).includes('<title>Ring World War</title>');
  } catch {
    return false;
  }
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolveTaskkill) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', resolveTaskkill);
      killer.once('close', resolveTaskkill);
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  await Promise.race([
    new Promise((resolveClose) => child.once('close', resolveClose)),
    delay(2_000),
  ]);
  if (child.exitCode === null) {
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    } else child.kill('SIGKILL');
  }
}

function once(operation) {
  let result;
  return () => result ??= operation();
}
