/**
 * Close-range review sheets for procedural graphics.
 *
 * WHY THESE EXIST. The wide contact sheets answer "does every class still
 * render, and does the palette still hold". They cannot answer "did that change
 * do anything", and during the overhaul that repeatedly mattered. The mech sheet
 * stages twelve mechs across 1100 px, so each is around 100 px tall, and the
 * snapshot comparison allows a `maxDiffPixelRatio` of 0.004 -- about 2,800 pixels.
 * Task 11 added four hydraulic actuators, real inset channels, and a routed
 * conduit to every mech and removed six greebles, and the mech sheet passed
 * BYTE-IDENTICAL. Every visual check in Tasks 8 through 13 had to be done with a
 * throwaway spec driving the camera by hand.
 *
 * At this framing, a mech is roughly 300 px tall and a channel is a channel. The
 * baseline is therefore sensitive to exactly the changes the wide sheets are blind
 * to, and the tolerance can be tightened.
 *
 * The terrain sheet carries 100 m of relief inside a 300 m window, so the frame
 * has silhouette in it, and the chosen spot runs a real drainage network through
 * it, so the flow-driven material bands are visible. Not an arbitrary pick.
 */

import { expect, test } from 'playwright/test';

test('detail units', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/dev/calibration?quality=high&sheet=detailUnits');
  await page.waitForFunction(() => Boolean((window as unknown as { RWWCalibration?: { ready: boolean } }).RWWCalibration?.ready), null, { timeout: 180_000 });
  await page.waitForTimeout(1_500);
  await expect(page).toHaveScreenshot({ maxDiffPixelRatio: 0.0015, fullPage: true, timeout: 20_000 });
  expect(errors.length).toBe(0);
});

test('detail terrain', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/dev/calibration?quality=high&sheet=detailTerrain');
  await page.waitForFunction(() => Boolean((window as unknown as { RWWCalibration?: { ready: boolean } }).RWWCalibration?.ready), null, { timeout: 180_000 });
  await page.waitForTimeout(1_500);
  await expect(page).toHaveScreenshot({ maxDiffPixelRatio: 0.0015, fullPage: true, timeout: 20_000 });
  expect(errors.length).toBe(0);
});
