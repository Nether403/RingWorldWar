/**
 * Capture screenshots of the running game for visual iteration.
 *
 * WebGL in headless Chromium needs software rasterisation flags, and the game
 * needs a few seconds to generate its world before there is anything worth
 * photographing, so both are handled here.
 *
 * Usage:
 *   node tools/shot.mjs                       one shot at the default view
 *   node tools/shot.mjs --wait 12             wait longer before capturing
 *   node tools/shot.mjs --zoom 40             scroll out 40 notches first
 *   node tools/shot.mjs --out output/x.png
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const url = arg('url', 'http://localhost:5180/');
const out = arg('out', 'output/playwright/shot.jpg');
const waitMs = Number(arg('wait', '10')) * 1000;
const zoomNotches = Number(arg('zoom', '0'));
const width = Number(arg('w', '1600'));
const height = Number(arg('h', '900'));
const panS = Number(arg('pan', '0'));

mkdirSync(dirname(out), { recursive: true });

// Headed Chromium can reach the real GPU; SwiftShader cannot render a scene
// this heavy in any reasonable time.
const headed = !args.includes('--software');
const browser = await chromium.launch({
  headless: !headed,
  args: headed
    ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
    : [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
});

const page = await browser.newPage({ viewport: { width, height } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(waitMs);

if (zoomNotches !== 0) {
  const canvas = await page.$('canvas');
  if (canvas) {
    await canvas.hover({ position: { x: width / 2, y: height / 2 } });
    for (let i = 0; i < Math.abs(zoomNotches); i++) {
      await page.mouse.wheel(0, zoomNotches > 0 ? 120 : -120);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(1600);
  }
}

if (panS !== 0) {
  await page.keyboard.down(panS > 0 ? 'KeyW' : 'KeyS');
  await page.waitForTimeout(Math.abs(panS));
  await page.keyboard.up(panS > 0 ? 'KeyW' : 'KeyS');
  await page.waitForTimeout(900);
}

// Capture at viewport size, then downscale via the page itself so the file
// stays small enough to inspect quickly.
const raw = await page.screenshot({ timeout: 120000 });
const scaled = await page.evaluate(async (bytes) => {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1100 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}, Array.from(raw));
writeFileSync(out, Buffer.from(scaled.split(',')[1], 'base64'));

// Report whatever the page had to say -- boot failures show up here.
const bootMsg = await page.evaluate(() => document.getElementById('bootmsg')?.textContent ?? '');
console.log(`saved ${out}`);
if (bootMsg) console.log(`boot: ${bootMsg}`);
if (logs.length) console.log('console:\n' + logs.slice(-40).join('\n'));

await browser.close();
