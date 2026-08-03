import { expect, test } from 'playwright/test';
import { readFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync('validation/scenarios/a-signal-in-the-spine.json', 'utf8'));

test('A Signal in the Spine pauses for briefing and completes through the story battlefield', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`/?seed=${scenario.worldSeed}&quality=${scenario.quality}&scenarioDriver=1`);
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const ids = await page.evaluate(async (value) => {
    const modulePath = '/e2e/support/scenario-driver.ts';
    const driver = await import(/* @vite-ignore */ modulePath);
    return driver.applyBrowserScenario(value);
  }, scenario);
  const narrative = page.locator('.rww-narrative');
  await expect(narrative).toContainText('A Signal in the Spine');
  expect(await page.evaluate(() => {
    const game = window.RWW!.game;
    const before = game.world.tick;
    game.stepSimulationExactlyOnce();
    return game.world.tick - before;
  })).toBe(0);
  await narrative.getByRole('button', { name: 'Begin' }).click();

  const result = await page.evaluate(({ ids }) => {
    const game = window.RWW!.game;
    const world = game.world;
    const stepUntil = (objective: string, maximum: number): boolean => {
      for (let tick = 0; tick < maximum; tick++) {
        if (game.missionHudModel!.status !== 'active') return false;
        if (game.missionHudModel!.objectiveId === objective) return true;
        game.stepSimulationExactlyOnce();
      }
      return game.missionHudModel!.objectiveId === objective;
    };

    game.selection.clear();
    for (const id of ['compact-bulwark', 'compact-vanguard-one', 'compact-vanguard-two', 'compact-vanguard-three']) {
      game.selection.add(ids[id]);
    }
    game.issueOrder(1_250, 0, true);
    for (let tick = 0; tick < 3_000 && world.unitById(ids['compact-bulwark'])!.s < 1_200; tick++) {
      game.stepSimulationExactlyOnce();
    }
    for (const needleId of ['needle-one', 'needle-two']) {
      const needle = world.unitById(ids[needleId]);
      if (!needle) continue;
      game.selection.clear();
      for (const id of ['compact-bulwark', 'compact-vanguard-one', 'compact-vanguard-two', 'compact-vanguard-three']) {
        const unit = world.unitById(ids[id]);
        if (unit) game.selection.add(unit.id);
      }
      game.issueOrder(needle.s, needle.z, false);
      for (let tick = 0; tick < 2_000 && world.unitById(ids[needleId]); tick++) {
        game.stepSimulationExactlyOnce();
      }
    }
    const remainingNeedles = ['needle-one', 'needle-two']
      .filter((id) => world.unitById(ids[id]));
    if (remainingNeedles.length > 0) return {
      stage: 'hunters', hud: game.missionHudModel, remainingNeedles,
      needles: remainingNeedles.map((id) => {
        const unit = world.unitById(ids[id])!;
        return { id, s: unit.s, z: unit.z, cloaked: unit.cloaked, hp: unit.hp };
      }),
      line: ['compact-bulwark', 'compact-vanguard-one', 'compact-vanguard-two', 'compact-vanguard-three']
        .map((id) => world.unitById(ids[id]) ? {
          id, hp: world.unitById(ids[id])!.hp, s: world.unitById(ids[id])!.s, z: world.unitById(ids[id])!.z,
        } : null),
    };
    game.selection.clear();
    for (const id of ['restoration-engineer', 'compact-bulwark']) {
      const unit = world.unitById(ids[id]);
      if (unit) game.selection.add(unit.id);
    }
    game.issueOrder(1_450, 0, false);
    if (!stepUntil('restore-node-power', 8_000)) return {
      stage: 'approach', hud: game.missionHudModel, snapshot: game.missionSnapshot,
      engineer: world.unitById(ids['restoration-engineer'])?.hp ?? null,
      bulwark: world.unitById(ids['compact-bulwark'])?.hp ?? null,
      positions: {
        engineer: world.unitById(ids['restoration-engineer']) ? {
          s: world.unitById(ids['restoration-engineer'])!.s, z: world.unitById(ids['restoration-engineer'])!.z,
        } : null,
        bulwark: world.unitById(ids['compact-bulwark']) ? {
          s: world.unitById(ids['compact-bulwark'])!.s, z: world.unitById(ids['compact-bulwark'])!.z,
        } : null,
      },
    };
    game.acknowledgeNarrative();

    const engineer = world.unitById(ids['restoration-engineer']);
    const core = world.structureById(ids['restoration-core']);
    game.selection.clear();
    game.selection.add(engineer!.id);
    game.issueOrder(core!.s, core!.z, false);
    for (let tick = 0; tick < 2_000 &&
      !['take-node', 'decode-signal', 'disable-field-command'].includes(game.missionHudModel!.objectiveId ?? ''); tick++) {
      game.stepSimulationExactlyOnce();
    }
    if (!['take-node', 'decode-signal', 'disable-field-command'].includes(game.missionHudModel!.objectiveId ?? '')) {
      return { stage: 'power', hud: game.missionHudModel };
    }
    game.acknowledgeNarrative();

    const node = world.structureById(ids['signal-node']);
    game.selection.clear();
    for (const id of ['compact-bulwark', 'compact-vanguard-one', 'compact-vanguard-two', 'compact-vanguard-three']) {
      const unit = world.unitById(ids[id]);
      if (unit) game.selection.add(unit.id);
    }
    game.issueOrder(node!.s, node!.z, true);
    if (game.missionHudModel!.objectiveId === 'take-node' && !stepUntil('decode-signal', 5_000)) {
      return { stage: 'capture', hud: game.missionHudModel };
    }
    if (game.missionHudModel!.objectiveId === 'decode-signal' && !stepUntil('disable-field-command', 1_000)) {
      return { stage: 'decode', hud: game.missionHudModel };
    }
    if (game.narrativeHudModel?.id === 'signal-migration') game.acknowledgeNarrative();

    const command = world.structureById(ids['choir-field-command']);
    game.selection.clear();
    for (const id of ['compact-bulwark', 'compact-vanguard-one', 'compact-vanguard-two', 'compact-vanguard-three']) {
      const unit = world.unitById(ids[id]);
      if (unit) game.selection.add(unit.id);
    }
    game.issueOrder(command!.s, command!.z, true);
    for (let tick = 0; tick < 8_000 && game.missionHudModel!.status === 'active'; tick++) {
      game.stepSimulationExactlyOnce();
    }
    const save = game.saveGame();
    game.acknowledgeNarrative();
    const load = game.loadGame();
    return {
      stage: game.missionHudModel!.status === 'completed' ? 'complete' : 'command',
      hud: game.missionHudModel,
      nodeAlive: Boolean(world.structureById(ids['signal-node'])),
      narrative: game.narrativeHudModel,
      save,
      load,
    };
  }, { ids });

  expect(result.stage, JSON.stringify(result)).toBe('complete');
  expect(result.nodeAlive).toBe(true);
  expect(result.narrative?.id).toBe('signal-last-correction');
  expect(result.save?.ok).toBe(true);
  expect(result.load?.ok).toBe(true);
  await page.evaluate(() => window.RWW!.game.update(0, window.RWW!.game.world.time));
  await expect(page.locator('.rww-narrative')).toContainText('Habitat-scale authority remaining: one operation');
  await expect(page.locator('.rww-end')).toBeHidden();
  await page.locator('.rww-narrative button').click();
  await page.evaluate(() => window.RWW!.game.update(0, window.RWW!.game.world.time));
  await expect(page.locator('.rww-end')).toContainText('A Signal in the Spine objectives secured');
  await expect(page.locator('.rww-end')).toContainText('Correction capacity');
});
