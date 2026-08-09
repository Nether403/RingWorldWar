import { expect, test, type Page } from 'playwright/test';
import { readFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync('validation/scenarios/first-contact.json', 'utf8'));

async function useScenarioViewport(page: Page): Promise<void> {
  await page.setViewportSize({ width: scenario.viewport.width, height: scenario.viewport.height });
  await expect.poll(() => page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    deviceScaleFactor: devicePixelRatio,
  }))).toEqual(scenario.viewport);
}

test('First Contact starts at tick zero, advances from a real selection, and restores mission progress', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await useScenarioViewport(page);
  await page.goto(`/?seed=${scenario.worldSeed}&quality=${scenario.quality}&scenarioDriver=1`);
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const applied = await page.evaluate(async (value) => {
    const modulePath = '/e2e/support/scenario-driver.ts';
    const driver = await import(/* @vite-ignore */ modulePath);
    const ids = driver.applyBrowserScenario(value);
    return { ids, state: driver.captureScenarioState() };
  }, scenario);

  expect(applied.state).toMatchObject({
    tick: 0,
    aiEnabled: false,
    mission: { missionId: 'first-contact', objectiveId: 'select-engineer', status: 'active' },
  });
  const mission = page.locator('.rww-mission');
  await expect(mission).toBeVisible();
  await expect(mission).toHaveAttribute('data-mission-id', 'first-contact');
  await expect(mission).toHaveAttribute('data-objective-id', 'select-engineer');
  await expect(mission).toContainText('Wake the construction crew');
  await expect(mission).toContainText('1 / 10');

  const depositGuidance = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const game = rww.game;
    game.setBuild('extractor');
    game.update(0, 8.05);
    const starPivot = rww.environment.group.getObjectByName('environment:star-pivot');
    const starRotationBefore = starPivot.rotation.z;
    rww.testDriver.renderFrame(0, 18.05);
    return {
      worldMarkers: Number(game.markers.object.userData.depositGuidanceCount ?? 0),
      minimapMarkers: Number(document.querySelector<HTMLCanvasElement>('.rww-map canvas')?.dataset.depositGuidance ?? 0),
      starRotationDelta: starPivot.rotation.z - starRotationBefore,
    };
  });
  expect(depositGuidance.worldMarkers).toBeGreaterThanOrEqual(3);
  expect(depositGuidance.minimapMarkers).toBeGreaterThanOrEqual(3);
  expect(depositGuidance.starRotationDelta).toBeLessThan(-0.3);

  await page.evaluate(() => {
    const game = window.RWW!.game;
    const engineer = game.world.units.find((unit) => unit.faction === 0 && unit.kind === 'engineer')!;
    game.selectAt(engineer.s, engineer.z, false);
    game.update(0, 8.1);
  });
  await expect(mission).toHaveAttribute('data-objective-id', 'build-power');
  await expect(mission).toContainText('Establish reliable power');
  await expect(mission).toContainText('2 / 10');

  const saved = await page.evaluate(() => window.RWW!.game.saveGame());
  expect(saved.ok).toBe(true);
  await page.evaluate((ids) => {
    const game = window.RWW!.game;
    game.startMission('first-contact', {
      tutorialNode: ids['tutorial-node'],
      artilleryTarget: ids['choir-power-core'],
    });
    game.update(0, 8.2);
  }, applied.ids);
  await expect(mission).toHaveAttribute('data-objective-id', 'select-engineer');

  const loaded = await page.evaluate(() => {
    const result = window.RWW!.game.loadGame();
    window.RWW!.game.update(0, 8.3);
    return result;
  });
  expect(loaded.ok).toBe(true);
  await expect(mission).toHaveAttribute('data-objective-id', 'build-power');

  const rejected = await page.evaluate(() => {
    const key = 'ring-world-war/save-slot';
    const forged = JSON.parse(localStorage.getItem(key)!);
    forged.mission.objectiveIndex = 10;
    forged.mission.completedObjectiveTicks = Array.from({ length: 10 }, () => forged.session.world.world.tick);
    localStorage.setItem(key, JSON.stringify(forged));
    const before = {
      world: window.RWW!.game.world.stateHash(),
      mission: window.RWW!.game.missionSnapshot,
      aiEnabled: window.RWW!.game.isAiEnabled,
    };
    const result = window.RWW!.game.loadGame();
    return {
      result,
      before,
      after: {
        world: window.RWW!.game.world.stateHash(),
        mission: window.RWW!.game.missionSnapshot,
        aiEnabled: window.RWW!.game.isAiEnabled,
      },
    };
  });
  expect(rejected.result.ok).toBe(false);
  expect(rejected.after).toEqual(rejected.before);

  await page.setViewportSize({ width: 320, height: 180 });
  const compactBounds = await mission.boundingBox();
  expect(compactBounds).not.toBeNull();
  expect(compactBounds!.x).toBeGreaterThanOrEqual(0);
  expect(compactBounds!.y).toBeGreaterThanOrEqual(0);
  expect(compactBounds!.x + compactBounds!.width).toBeLessThanOrEqual(320);
  expect(compactBounds!.y + compactBounds!.height).toBeLessThanOrEqual(180);
  expect(errors).toEqual([]);
});

test('First Contact completes through fixed-step construction, production, capture, deployment, and manual fire', async ({ page }) => {
  await useScenarioViewport(page);
  await page.goto(`/?seed=${scenario.worldSeed}&quality=${scenario.quality}&scenarioDriver=1`);
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const setup = await page.evaluate(async (value) => {
    const modulePath = '/e2e/support/scenario-driver.ts';
    const driver = await import(/* @vite-ignore */ modulePath);
    const ids = driver.applyBrowserScenario(value);
    const rww = window.RWW! as unknown as {
      testDriver: { renderFrame: (dt: number, visualTime: number) => void };
    };
    const game = window.RWW!.game;
    const world = game.world;
    const engineer = world.units.find((unit) => unit.faction === 0 && unit.kind === 'engineer')!;
    game.selectAt(engineer.s, engineer.z, false);

    let structureS = 100;
    const completeStructure = (kind: Parameters<typeof world.spawnStructure>[1]) => {
      structureS += 90;
      const structure = world.spawnStructure(0, kind, structureS, 300, 0.999);
      engineer.s = structure.s;
      engineer.z = structure.z;
      engineer.prevS = structure.s;
      engineer.prevZ = structure.z;
      engineer.order = { kind: 'build', s: structure.s, z: structure.z, targetId: structure.id };
      engineer.buildTargetId = structure.id;
      game.stepSimulationExactlyOnce();
      return structure;
    };

    completeStructure('solarArray');
    completeStructure('solarArray');
    completeStructure('extractor');
    completeStructure('fabricator');
    const foundry = completeStructure('mechFoundry');

    const existingUnits = new Set(world.units.map((unit) => unit.id));
    foundry.queue.push('wisp');
    foundry.queueTimer = 1_000;
    game.stepSimulationExactlyOnce();
    const wisp = world.units.find((unit) => !existingUnits.has(unit.id) && unit.kind === 'wisp')!;

    const node = world.structureById(ids['tutorial-node'])!;
    node.capture = -0.999;
    wisp.s = node.s;
    wisp.z = node.z;
    wisp.prevS = node.s;
    wisp.prevZ = node.z;
    game.stepSimulationExactlyOnce();

    const beforeLongbow = new Set(world.units.map((unit) => unit.id));
    foundry.queue.push('longbow');
    foundry.queueTimer = 1_000;
    game.stepSimulationExactlyOnce();
    const longbow = world.units.find((unit) => !beforeLongbow.has(unit.id) && unit.kind === 'longbow')!;
    const target = world.structureById(ids['choir-power-core'])!;
    wisp.s = target.s;
    wisp.z = target.z;
    wisp.prevS = target.s;
    wisp.prevZ = target.z;
    game.stepSimulationExactlyOnce();

    game.selectAt(longbow.s, longbow.z, false);
    rww.testDriver.renderFrame(0, 19.4);
    game.beginArtilleryTarget(longbow.id, 'siegeMortar');
    const firedBeforeDeployment = game.fireArtilleryTarget(target.s, target.z);
    const blockedResult = game.artilleryResult;
    game.cancelArtilleryTarget();
    return {
      longbow: { id: longbow.id, s: longbow.s, z: longbow.z, cooldown: longbow.cd[0] },
      target: { s: target.s, z: target.z },
      objectiveBeforeDeployment: game.missionHudModel?.objectiveId,
      targetButtonBeforeDeployment: Boolean(document.querySelector('[data-artillery-weapon="siegeMortar"]')),
      firedBeforeDeployment,
      blockedResult,
    };
  }, scenario);

  expect(setup.objectiveBeforeDeployment).toBe('deploy-longbow');
  expect(setup.longbow.cooldown).toBe(0);
  expect(setup.targetButtonBeforeDeployment).toBe(false);
  expect(setup.firedBeforeDeployment).toBe(false);
  expect(setup.blockedResult).toMatchObject({ reason: 'longbow-not-deployed' });
  await expect(page.locator('[aria-label="Siege Mode ability"]')).toBeVisible();
  await page.locator('[aria-label="Siege Mode ability"]').click();

  const deploying = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    rww.testDriver.renderFrame(0, 19.5);
    const longbow = rww.game.world.units.find((unit: any) => unit.kind === 'longbow')!;
    return {
      active: longbow.ability.active,
      transitionTimer: longbow.ability.transitionTimer,
      targetButton: Boolean(document.querySelector('[data-artillery-weapon="siegeMortar"]')),
    };
  });
  expect(deploying).toMatchObject({ active: true, targetButton: false });
  expect(deploying.transitionTimer).toBeGreaterThan(0);

  const deployed = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    for (let step = 0; step < 90; step++) rww.game.stepSimulationExactlyOnce();
    rww.testDriver.renderFrame(0, 22.5);
    const longbow = rww.game.world.units.find((unit: any) => unit.kind === 'longbow')!;
    return {
      active: longbow.ability.active,
      transitionTimer: longbow.ability.transitionTimer,
      mission: rww.game.missionHudModel,
      targetButton: Boolean(document.querySelector('[data-artillery-weapon="siegeMortar"]')),
    };
  });
  expect(deployed).toMatchObject({ active: true, transitionTimer: 0, targetButton: true });
  expect(deployed.mission).toMatchObject({ objectiveId: 'fire-antispinward' });
  await page.locator('[data-artillery-weapon="siegeMortar"]').click();

  const result = await page.evaluate((value) => {
    const game = window.RWW!.game;
    game.updateCursor(value.target.s, value.target.z);
    const fired = game.fireArtilleryTarget(value.target.s, value.target.z);
    return {
      fired,
      artilleryResult: game.artilleryResult,
      mission: game.missionHudModel,
      shot: game.world.projectiles.find((projectile) => projectile.weapon === 'siegeMortar')?.weapon ?? null,
    };
  }, setup);

  expect(result.fired, JSON.stringify(result.artilleryResult)).toBe(true);
  expect(result.shot).toBe('siegeMortar');
  expect(result.mission).toMatchObject({ status: 'completed', objectiveId: null, progressText: '10 / 10' });
});
