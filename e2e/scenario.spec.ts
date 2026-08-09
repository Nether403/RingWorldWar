import { expect, test, type Page } from 'playwright/test';
import { readFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync('validation/scenarios/signature-lance.json', 'utf8'));
const directionalScenario = JSON.parse(readFileSync('validation/scenarios/directional-artillery.json', 'utf8'));
const EXPECTED_PRE_SETUP_HASH = '1f413b87';
const EXPECTED_APPLIED_HASH = '5c174281';

async function useScenarioViewport(
  page: Page,
  scenarioDefinition: typeof directionalScenario,
): Promise<void> {
  await page.setViewportSize({
    width: scenarioDefinition.viewport.width,
    height: scenarioDefinition.viewport.height,
  });
  await expect.poll(() => page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    deviceScaleFactor: devicePixelRatio,
  }))).toEqual(scenarioDefinition.viewport);
}

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

test('keeps delayed scenario imports at tick zero and repeats exact state hashes', async ({ page, browserName }, testInfo) => {
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
  expect(runs.map((run) => run.preHash)).toEqual(Array(3).fill(EXPECTED_PRE_SETUP_HASH));
  expect(runs.map((run) => run.appliedHash)).toEqual(Array(3).fill(EXPECTED_APPLIED_HASH));
  expect(new Set(runs.map((run) => run.preHash)).size).toBe(1);
  expect(new Set(runs.map((run) => run.appliedHash)).size).toBe(1);
  expect(runs.map((run) => run.applied)).toEqual([runs[0]!.applied, runs[0]!.applied, runs[0]!.applied]);
  console.log('phase4e scenario hash evidence', JSON.stringify({
    project: testInfo.project.name,
    browserName,
    preHash: runs[0]!.preHash,
    appliedHash: runs[0]!.appliedHash,
  }));
});

test('deployed Longbow exposes wrapped directional range and authoritative targeting', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await useScenarioViewport(page, directionalScenario);
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
  await expect(page.locator('.rww-sel')).toContainText('APPROXIMATE ENVELOPE');
  await expect(map).toHaveAttribute('aria-label', /Approximate envelope; live preview and fire checks are authoritative/i);

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

test('keeps directional guidance exclusive to conventional ballistic fire', async ({ page }) => {
  await useScenarioViewport(page, directionalScenario);
  await page.goto(`/?seed=${directionalScenario.worldSeed}&quality=${directionalScenario.quality}&scenarioDriver=1`);
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const guidance = await page.evaluate(async (value) => {
    const modulePath = '/e2e/support/scenario-driver.ts';
    const driver = await import(/* @vite-ignore */ modulePath);
    driver.applyBrowserScenario(value);
    const rww = (window as unknown as { RWW: any }).RWW;
    const game = rww.game;
    const battery = game.world.spawnStructure(0, 'rocketBattery', 700, 360, 1);
    const silo = game.world.spawnStructure(0, 'silo', 920, 360, 1);
    const read = () => {
      const map = document.querySelector<HTMLCanvasElement>('.rww-map canvas')!;
      return {
        overlay: map.dataset.artilleryOverlay ?? null,
        selection: document.querySelector('.rww-sel')?.textContent ?? '',
        targetDirection: game.markers.object.userData.artilleryTargetDirection ?? null,
      };
    };

    game.selectAt(battery.s, battery.z, false);
    rww.testDriver.renderFrame(0, 19.1);
    const conventional = read();

    game.beginArtilleryTarget(battery.id, 'cruiseMissile');
    game.updateCursor(1_100, 360);
    rww.testDriver.renderFrame(0, 19.2);
    const cruise = read();

    game.cancelArtilleryTarget();
    game.selectAt(silo.s, silo.z, false);
    game.beginArtilleryTarget(silo.id, 'chordShot');
    game.updateCursor(1_300, 360);
    rww.testDriver.renderFrame(0, 19.3);
    const chord = read();
    return { conventional, cruise, chord };
  }, directionalScenario);

  expect(guidance.conventional).toMatchObject({ overlay: 'directional' });
  expect(guidance.conventional.selection).toContain('ANTISPINWARD = LONG SHOT');
  expect(guidance.cruise).toMatchObject({ overlay: null, targetDirection: null });
  expect(guidance.cruise.selection).not.toContain('ANTISPINWARD = LONG SHOT');
  expect(guidance.chord).toMatchObject({ overlay: null, targetDirection: null });
  expect(guidance.chord.selection).not.toContain('ANTISPINWARD = LONG SHOT');
});
