import { expect, test } from 'playwright/test';
import { readFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync('validation/scenarios/signature-lance.json', 'utf8'));
const directionalScenario = JSON.parse(readFileSync('validation/scenarios/directional-artillery.json', 'utf8'));

test('drives a deterministic browser scenario without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/?seed=${scenario.worldSeed}&quality=${scenario.quality}&scenarioDriver=1`);
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const result = await page.evaluate(async (value) => {
    const modulePath = '/e2e/support/scenario-driver.ts';
    const driver = await import(/* @vite-ignore */ modulePath);
    driver.applyBrowserScenario(value);
    const frame = driver.captureScenarioFrame(value);
    return { state: frame.state, resources: frame.resources, pixelCount: frame.pixels.length };
  }, scenario);

  expect(result.state).toMatchObject({
    tick: scenario.simulation.targetTick,
    quality: scenario.quality,
    adaptiveQuality: false,
  });
  expect(result.pixelCount).toBe(1100 * 640 * 4);
  expect(result.resources.drawCalls).toBeGreaterThan(0);
  expect(Number(result.state.projectiles)).toBeGreaterThan(0);
  expect(Number(result.resources.lines)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('keeps delayed scenario imports at tick zero and repeats exact state hashes', async ({ page }) => {
  const zeroTickScenario = {
    ...scenario,
    simulation: { ...scenario.simulation, targetTick: 0 },
  };
  const runs: Array<{ pre: Record<string, unknown>; preHash: string; applied: Record<string, unknown>; appliedHash: string }> = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`/?seed=${scenario.worldSeed}&quality=${scenario.quality}&scenarioDriver=1`);
    await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));
    await page.waitForTimeout(250);
    runs.push(await page.evaluate(async (value) => {
      const modulePath = '/e2e/support/scenario-driver.ts';
      const driver = await import(/* @vite-ignore */ modulePath);
      const pre = driver.captureScenarioState();
      const preHash = driver.captureScenarioStateHash();
      driver.applyBrowserScenario(value);
      return {
        pre,
        preHash,
        applied: driver.captureScenarioState(),
        appliedHash: driver.captureScenarioStateHash(),
      };
    }, zeroTickScenario));
  }
  expect(runs.map((run) => run.pre.tick)).toEqual([0, 0, 0]);
  expect(runs.map((run) => run.applied.tick)).toEqual([0, 0, 0]);
  expect(new Set(runs.map((run) => run.preHash)).size).toBe(1);
  expect(new Set(runs.map((run) => run.appliedHash)).size).toBe(1);
  expect(runs.map((run) => run.applied)).toEqual([runs[0]!.applied, runs[0]!.applied, runs[0]!.applied]);
});

test('deployed Longbow exposes wrapped directional range and authoritative targeting', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/?seed=${directionalScenario.worldSeed}&quality=${directionalScenario.quality}&scenarioDriver=1`);
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const ids = await page.evaluate(async (value) => {
    const modulePath = '/e2e/support/scenario-driver.ts';
    const driver = await import(/* @vite-ignore */ modulePath);
    return driver.applyBrowserScenario(value);
  }, directionalScenario);
  const map = page.locator('.rww-map canvas');
  await expect(page.locator('.rww-sensor-lbl')).toHaveText('SENSOR COVERAGE');
  await expect(map).toHaveAttribute('data-sensor-coverage', 'nominal');
  await expect(map).toHaveAttribute('data-artillery-overlay', 'directional');
  const ranges = await map.evaluate((canvas) => ({
    antispinward: Number((canvas as HTMLCanvasElement).dataset.antispinwardRange),
    spinward: Number((canvas as HTMLCanvasElement).dataset.spinwardRange),
    wrapCopies: Number((canvas as HTMLCanvasElement).dataset.wrapCopies),
  }));
  expect(ranges.antispinward).toBeGreaterThan(ranges.spinward);
  expect(ranges.wrapCopies).toBeGreaterThan(1);
  await expect(page.locator('.rww-sel')).toContainText(/SENSOR .* EFFECTIVE/);
  await expect(page.locator('.rww-sel')).toContainText('EXACT LOS CHECKED SEPARATELY');
  await expect(page.locator('.rww-sel')).toContainText('ANTISPINWARD = LONG SHOT');

  const targetButton = page.locator('[data-artillery-weapon="siegeMortar"]');
  await expect(targetButton).toBeVisible();
  await targetButton.click();
  const authority = await page.evaluate(({ sourceId, targetId }) => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const target = rww.game.world.unitById(targetId)!;
    rww.game.updateCursor(target.s, target.z);
    const targetingStarted = rww.game.artilleryTargeting;
    rww.testDriver.renderFrame(0, 18.11);
    const preview = rww.game.trajectoryPreview;
    const previewImpact = preview?.[preview.length - 1];
    const projectileIds = new Set(rww.game.world.projectiles.map((projectile: any) => projectile.id));
    const fired = rww.game.fireArtilleryTarget(target.s, target.z);
    const projectile = rww.game.world.projectiles.find((candidate: any) =>
      candidate.weapon === 'siegeMortar' && !projectileIds.has(candidate.id));
    rww.game.world.step();
    const first = preview?.[1];
    const circumference = 2 * Math.PI * 3600;
    const delta = (a: number, b: number): number => {
      let value = b - a;
      if (value > circumference / 2) value -= circumference;
      if (value < -circumference / 2) value += circumference;
      return value;
    };
    rww.game.beginArtilleryTarget(sourceId, 'siegeMortar');
    rww.game.world.activateAbility(sourceId, false);
    rww.testDriver.renderFrame(0, 18.12);
    return {
      targetingStarted,
      previewSamples: preview?.length ?? 0,
      fired,
      impactMiss: previewImpact && projectile
        ? Math.hypot(delta(previewImpact.s, projectile.impactS), previewImpact.z - projectile.impactZ)
        : Infinity,
      firstStepMiss: first && projectile
        ? Math.hypot(delta(first.s, projectile.p.s), first.h - projectile.p.h, first.z - projectile.p.z)
        : Infinity,
      targetingRetainedOnUndeploy: rww.game.artilleryTargeting,
      undeployBlocker: rww.game.artilleryResult?.reason,
      targetButtonAfterUndeploy: Boolean(document.querySelector('[data-artillery-weapon="siegeMortar"]')),
    };
  }, { sourceId: ids['compact-longbow'], targetId: ids['choir-target'] });

  expect(authority.targetingStarted).toBe(true);
  expect(authority.previewSamples).toBeGreaterThan(2);
  expect(authority.fired).toBe(true);
  expect(authority.impactMiss).toBeLessThan(0.05);
  expect(authority.firstStepMiss).toBeLessThan(0.05);
  expect(authority.targetingRetainedOnUndeploy).toBe(true);
  expect(authority.undeployBlocker).toBe('longbow-transitioning');
  expect(authority.targetButtonAfterUndeploy).toBe(false);
  expect(errors).toEqual([]);
});
