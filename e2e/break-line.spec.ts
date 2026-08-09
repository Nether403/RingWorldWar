import { expect, test } from 'playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { collectGit } from '../tools/rww/process.mjs';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { parseScenario } from '../tools/rww/scenario.mjs';

const scenarioPath = 'validation/scenarios/break-the-line.json';
const scenarioBytes = readFileSync(scenarioPath);
const scenario = parseScenario(JSON.parse(scenarioBytes.toString('utf8')));
const scenarioSha256 = createHash('sha256').update(scenarioBytes).digest('hex');

test('Break the Line starts with an established deterministic battlefield', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/?seed=${scenario.worldSeed}&quality=${scenario.quality}&scenarioDriver=1`);
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const applied = await page.evaluate(async (value) => {
    const modulePath = '/e2e/support/scenario-driver.ts';
    const driver = await import(/* @vite-ignore */ modulePath);
    const ids = driver.applyBrowserScenario(value);
    const game = window.RWW!.game;
    const extractor = game.world.structureById(ids['protected-extractor'])!;
    const state = driver.captureScenarioState();
    const raiderIds = ['raider-one', 'raider-three'];
    const starts = raiderIds.map((id) => game.world.unitById(ids[id])!.s);
    game.stepSimulationExactlyOnce();
    return {
      ids,
      state,
      depositClaim: game.world.depositAt(extractor.s, extractor.z)?.claimedBy,
      raidPressure: {
        orders: raiderIds.map((id) => game.world.unitById(ids[id])!.order.kind),
        moved: raiderIds.map((id, index) => game.world.unitById(ids[id])!.s !== starts[index]),
      },
    };
  }, scenario);

  expect(applied.state).toMatchObject({
    tick: 0,
    aiEnabled: false,
    units: 15,
    structures: 20,
    mission: {
      missionId: 'break-the-line',
      objectiveId: 'hold-salvage-line',
      status: 'active',
      progressText: '1 / 7',
    },
  });
  expect(applied.depositClaim).toBe(applied.ids['protected-extractor']);
  expect(applied.raidPressure.orders).toEqual(['attackMove', 'attackMove']);
  expect(applied.raidPressure.moved).toEqual([true, true]);
  const mission = page.locator('.rww-mission');
  await expect(mission).toContainText('Break the Line');
  await expect(mission).toContainText('Hold the salvage line');
  expect(errors).toEqual([]);
});

test('Break the Line records every core-loop milestone and completes the territorial hold', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/?seed=${scenario.worldSeed}&quality=${scenario.quality}&scenarioDriver=1`);
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const result = await page.evaluate(async (value) => {
    const modulePath = '/e2e/support/scenario-driver.ts';
    const driver = await import(/* @vite-ignore */ modulePath);
    const ids = driver.applyBrowserScenario(value);
    const rww = (window as unknown as { RWW: any }).RWW;
    const game = rww.game;
    const world = game.world;

    for (const id of ['raider-one', 'raider-three']) world.unitById(ids[id])!.alive = false;
    game.stepSimulationExactlyOnce();
    const objectives = [game.missionHudModel.objectiveId];

    const battery = world.structureById(ids['choir-battery'])!;
    world.spawnUnit(0, 'wisp', battery.s, battery.z);
    game.stepSimulationExactlyOnce();
    objectives.push(game.missionHudModel.objectiveId);

    world.structureById(ids['forward-node'])!.faction = 0;
    game.stepSimulationExactlyOnce();
    objectives.push(game.missionHudModel.objectiveId);

    const node = world.structureById(ids['forward-node'])!;
    const longbow = world.unitById(ids['compact-longbow'])!;
    longbow.s = node.s;
    longbow.z = node.z;
    longbow.prevS = node.s;
    longbow.prevZ = node.z;
    longbow.ability.active = true;
    longbow.ability.transitionTimer = 0;
    game.stepSimulationExactlyOnce();
    objectives.push(game.missionHudModel.objectiveId);

    battery.alive = false;
    game.stepSimulationExactlyOnce();
    objectives.push(game.missionHudModel.objectiveId);

    for (const id of ['choir-core', 'choir-radar']) {
      world.structureById(ids[id])!.alive = false;
    }
    game.stepSimulationExactlyOnce();
    objectives.push(game.missionHudModel.objectiveId);

    for (let tick = 0; tick < 900; tick++) game.stepSimulationExactlyOnce();
    const snapshot = game.missionSnapshot;
    const saved = game.saveGame();
    const loaded = game.loadGame();
    return {
      objectives,
      hud: game.missionHudModel,
      snapshot,
      saved,
      loaded,
    };
  }, scenario);

  expect(result.objectives).toEqual([
    'scout-forward-line',
    'secure-forward-node',
    'establish-high-ground',
    'silence-artillery',
    'break-strongpoint',
    'hold-forward-line',
  ]);
  expect(result.hud).toMatchObject({ status: 'completed', objectiveId: null, progressText: '7 / 7' });
  expect(result.snapshot.completedObjectiveTicks).toHaveLength(7);
  expect(result.snapshot.completedObjectiveTicks).toEqual(
    [...result.snapshot.completedObjectiveTicks].sort((a, b) => a - b),
  );
  expect(result.saved.ok).toBe(true);
  expect(result.loaded.ok).toBe(true);
});

test('Break the Line is completable through normal orders, capture, combat, and artillery', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto(`/?seed=${scenario.worldSeed}&quality=${scenario.quality}&scenarioDriver=1`);
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const result = await page.evaluate(async (value) => {
    const modulePath = '/e2e/support/scenario-driver.ts';
    const driver = await import(/* @vite-ignore */ modulePath);
    const ids = driver.applyBrowserScenario(value);
    const game = (window as unknown as { RWW: any }).RWW.game;
    const world = game.world;
    const stepUntil = (objectiveId: string, maximumTicks: number): boolean => {
      for (let tick = 0; tick < maximumTicks; tick++) {
        if (game.missionHudModel.status !== 'active') return false;
        if (game.missionHudModel.objectiveId === objectiveId) return true;
        game.stepSimulationExactlyOnce();
      }
      return game.missionHudModel.objectiveId === objectiveId;
    };

    // The scenario starts with the defence group selected.
    game.issueOrder(700, 110, true);
    if (!stepUntil('scout-forward-line', 4_000)) return { stage: 'defence', hud: game.missionHudModel };

    const wisp = world.unitById(ids['compact-wisp']);
    game.selectAt(wisp.s, wisp.z, false);
    game.issueOrder(1_850, 300, false);
    if (!stepUntil('secure-forward-node', 7_000)) return {
      stage: 'scout', hud: game.missionHudModel,
      scout: { alive: wisp.alive, s: wisp.s, z: wisp.z, order: wisp.order },
    };

    const node = world.structureById(ids['forward-node']);
    game.selection.clear();
    game.selectAt(wisp.s, wisp.z, true);
    for (const id of ['compact-vanguard-one', 'compact-vanguard-two', 'compact-vanguard-three', 'compact-vanguard-four', 'compact-aegis']) {
      const unit = world.unitById(ids[id]);
      if (unit) game.selectAt(unit.s, unit.z, true);
    }
    game.issueOrder(node.s, node.z, true);
    if (!stepUntil('establish-high-ground', 14_000)) return { stage: 'capture', hud: game.missionHudModel };

    game.selection.clear();
    game.selection.add(wisp.id);
    game.issueOrder(1_850, 300, false);
    const longbow = world.unitById(ids['compact-longbow']);
    game.selection.clear();
    game.selection.add(longbow.id);
    game.issueOrder(node.s, node.z, false);
    for (let tick = 0; tick < 20_000 && Math.hypot(longbow.s - node.s, longbow.z - node.z) > 500; tick++) {
      game.stepSimulationExactlyOnce();
    }
    game.selection.clear();
    game.selection.add(longbow.id);
    game.toggleSelectedAbility();
    if (!stepUntil('silence-artillery', 300)) return {
      stage: 'position', hud: game.missionHudModel,
      longbow: { alive: longbow.alive, s: longbow.s, z: longbow.z, order: longbow.order, ability: longbow.ability },
      node: { s: node.s, z: node.z },
    };

    const fireAt = (target: any): boolean => {
      if (!target?.alive || longbow.cd[0] > 0) return false;
      game.beginArtilleryTarget(longbow.id, 'siegeMortar');
      return game.fireArtilleryTarget(target.s, target.z);
    };
    for (let tick = 0; tick < 5_000 && world.structureById(ids['choir-battery']); tick++) {
      fireAt(world.structureById(ids['choir-battery']));
      game.stepSimulationExactlyOnce();
    }
    if (game.missionHudModel.objectiveId !== 'break-strongpoint') {
      const target = world.structureById(ids['choir-battery']);
      game.beginArtilleryTarget(longbow.id, 'siegeMortar');
      game.updateCursor(target.s, target.z);
      game.update(0, world.time);
      return {
        stage: 'artillery', hud: game.missionHudModel,
        battery: target ? { hp: target.hp, alive: target.alive } : null,
        longbow: { s: longbow.s, z: longbow.z, cd: longbow.cd[0], ability: longbow.ability },
        wisp: world.unitById(wisp.id) ? { s: wisp.s, z: wisp.z } : null,
        lineUnits: ['compact-vanguard-one', 'compact-vanguard-two', 'compact-vanguard-three', 'compact-vanguard-four', 'compact-aegis']
          .map((id) => world.unitById(ids[id]) ? { id, hp: world.unitById(ids[id]).hp } : null),
        blocker: game.artilleryResult,
      };
    }

    game.selection.clear();
    for (const id of ['compact-vanguard-one', 'compact-vanguard-two', 'compact-vanguard-three', 'compact-vanguard-four', 'compact-aegis']) {
      const unit = world.unitById(ids[id]);
      if (unit) game.selection.add(unit.id);
    }
    game.issueOrder(2_300, 0, true);
    game.selection.clear();
    if (world.unitById(wisp.id)) {
      game.selection.add(wisp.id);
      game.issueOrder(2_250, -100, false);
    }
    const strongpointIds = ['choir-core', 'choir-radar'];
    for (let tick = 0; tick < 12_000 && game.missionHudModel.objectiveId === 'break-strongpoint'; tick++) {
      const target = strongpointIds.map((id) => world.structureById(ids[id])).find(Boolean);
      fireAt(target);
      game.stepSimulationExactlyOnce();
    }
    if (game.missionHudModel.objectiveId !== 'hold-forward-line') {
      return {
        stage: 'strongpoint', hud: game.missionHudModel,
        structures: strongpointIds.map((id) => {
          const structure = world.structureById(ids[id]);
          return structure ? { id, hp: structure.hp } : null;
        }),
        longbow: { s: longbow.s, z: longbow.z, cd: longbow.cd[0] },
        wisp: world.unitById(wisp.id) ? { s: wisp.s, z: wisp.z } : null,
      };
    }

    for (let tick = 0; tick < 1_000 && game.missionHudModel.status === 'active'; tick++) {
      game.stepSimulationExactlyOnce();
    }
    return {
      stage: 'complete',
      hud: game.missionHudModel,
      snapshot: game.missionSnapshot,
      extractorAlive: Boolean(world.structureById(ids['protected-extractor'])),
    };
  }, scenario);

  expect(result.stage, JSON.stringify(result)).toBe('complete');
  expect(result.hud.status).toBe('completed');
  expect(result.extractorAlive).toBe(true);
  expect(result.snapshot.completedObjectiveTicks).toHaveLength(7);
  const durationTicks = result.snapshot.completedAtTick - result.snapshot.startedAtTick;
  expect(durationTicks).toBeGreaterThanOrEqual(15 * 60 * 30);
  expect(durationTicks).toBeLessThanOrEqual(25 * 60 * 30);
  const evidence = {
    schema: 'rww.break-line-completion',
    version: 1,
    test: testInfo.title,
    scenario: {
      schema: scenario.schema,
      version: scenario.version,
      id: scenario.id,
      revision: scenario.revision,
      path: scenarioPath,
      sha256: scenarioSha256,
    },
    status: result.hud.status,
    durationTicks,
    durationSeconds: durationTicks / 30,
    completedObjectiveTicks: result.snapshot.completedObjectiveTicks,
    milestoneTicks: result.snapshot.milestones.breakLine.milestoneTicks,
    code: await collectGit(process.cwd()),
  };
  writeFileSync(testInfo.outputPath('break-line-completion.json'), JSON.stringify(evidence, null, 2));
  await testInfo.attach('break-line-completion', {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: 'application/json',
  });
  console.log(`break-line completion evidence ${JSON.stringify(evidence)}`);
});
