import { expect, test } from 'playwright/test';
import { readFileSync } from 'node:fs';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { parseScenario } from '../tools/rww/scenario.mjs';

const scenario = parseScenario(JSON.parse(readFileSync('validation/scenarios/counterfire.json', 'utf8')));

test('Counterfire completes through power restoration, interception, and ammunition adaptation', async ({ page }) => {
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

    if (!stepUntil('restore-defensive-power', 300)) return { stage: 'detect', hud: game.missionHudModel };
    const engineer = world.unitById(ids['compact-engineer']);
    const core = world.structureById(ids['emergency-core']);
    game.selectAt(engineer.s, engineer.z, false);
    game.issueOrder(core.s, core.z, false);
    if (!stepUntil('raise-umbrella', 1_200)) return { stage: 'power', hud: game.missionHudModel };

    const aegis = world.unitById(ids['compact-aegis']);
    game.selection.clear();
    game.selection.add(aegis.id);
    game.toggleSelectedAbility();
    if (!stepUntil('locate-launcher', 2_000)) return { stage: 'defense', hud: game.missionHudModel };

    const wisp = world.unitById(ids['compact-wisp']);
    game.selection.clear();
    game.selection.add(wisp.id);
    game.issueOrder(850, 200, false);
    if (!stepUntil('test-grid', 3_000)) return { stage: 'scout', hud: game.missionHudModel };

    const battery = world.structureById(ids['compact-battery']);
    const launcher = () => world.unitById(ids['choir-longbow']);
    const fire = (weaponId: string): boolean => {
      const target = launcher();
      if (!target) return false;
      game.beginArtilleryTarget(battery.id, weaponId);
      return game.fireArtilleryTarget(target.s, target.z);
    };
    if (!fire('batteryGun')) return { stage: 'standard-fire', hud: game.missionHudModel, result: game.artilleryResult };
    if (!stepUntil('adapt-ammunition', 2_000)) return { stage: 'grid', hud: game.missionHudModel };

    if (!fire('cruiseMissile')) return { stage: 'cruise-fire', hud: game.missionHudModel, result: game.artilleryResult };
    if (!stepUntil('neutralize-launcher', 300)) return { stage: 'adapt', hud: game.missionHudModel };
    game.selection.clear();
    game.selection.add(wisp.id);
    game.issueOrder(1_050, 100, false);
    for (let tick = 0; tick < 600 && Math.hypot(wisp.s - 1_050, wisp.z - 100) > 20; tick++) {
      game.stepSimulationExactlyOnce();
    }
    for (let tick = 0; tick < 8_000 && launcher(); tick++) {
      if (battery.cd[1] <= 0) fire('cruiseMissile');
      game.stepSimulationExactlyOnce();
    }
    game.update(0, world.time);
    const saved = game.saveGame();
    const loaded = game.loadGame();
    game.update(0, world.time);
    return {
      stage: game.missionHudModel.status === 'completed' ? 'complete' : 'launcher',
      hud: game.missionHudModel,
      debrief: game.missionDebriefModel,
      snapshot: game.missionSnapshot,
      dialog: document.querySelector('.rww-end')?.textContent ?? '',
      launcherHp: launcher()?.hp ?? null,
      artilleryResult: game.artilleryResult,
      saved,
      loaded,
    };
  }, scenario);

  expect(result.stage, JSON.stringify(result)).toBe('complete');
  expect(result.hud.status).toBe('completed');
  expect(result.snapshot.milestones.counterfire.standardIntercepted).toBe(true);
  expect(result.snapshot.milestones.counterfire.cruiseFired).toBe(true);
  expect(result.debrief).toMatchObject({ outcome: 'success' });
  expect(result.saved.ok).toBe(true);
  expect(result.loaded.ok, result.loaded.message).toBe(true);
  expect(result.dialog).toContain('Counterfire objectives secured');
  expect(result.dialog).toContain('Intercepted');
  expect(result.dialog).toContain('Asset integrity');
});
