import { expect, test, type Page } from 'playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

test('launches the tutorial arc from the production campaign archive without manual routing', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?menu=1&quality=low');

  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'Campaign' }).click();
  const campaign = title.getByRole('dialog', { name: 'Campaign archive' });
  await expect(campaign).toBeVisible();
  await expect(campaign.locator('[data-campaign-mission-id="compact-01"]')).toHaveAttribute('data-state', 'current');
  const detail = campaign.getByRole('region', { name: 'Selected mission details' });
  await expect(detail.getByRole('heading', { name: 'First Contact' })).toBeVisible();
  await detail.getByRole('button', { name: 'Begin First Contact' }).click();

  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(page).toHaveURL(/scenario=first-contact/);
  await expect(page).toHaveURL(/campaignMission=compact-01/);
  await expect(page).toHaveURL(/campaignIntent=start/);
  const state = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    return { diagnostics: rww.probe(), mission: rww.game.missionHudModel };
  });
  expect(state.diagnostics).toMatchObject({ runtimeScenario: 'first-contact', mission: 'first-contact' });
  expect(state.mission).toMatchObject({ missionId: 'first-contact', status: 'active', objectiveId: 'select-engineer' });

  const mission = page.locator('.rww-mission');
  await expect(mission).toBeVisible();
  await expect(mission).toHaveAttribute('aria-label', 'Current mission objective');
  await expect(mission).toHaveAttribute('aria-live', 'polite');
  await expect(mission).toHaveAttribute('data-mission-id', 'first-contact');
  await expect(mission).toHaveAttribute('data-objective-id', 'select-engineer');
  await expect(mission).toContainText('Wake the construction crew');
  await expect(mission).toContainText('1 / 10');
  expect(errors).toEqual([]);
});

test('completes the integrated arc through real commands and records campaign progression', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'Campaign' }).click();
  await title.getByRole('dialog', { name: 'Campaign archive' })
    .getByRole('region', { name: 'Selected mission details' })
    .getByRole('button', { name: 'Begin First Contact' }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));

  await completeFirstContact(page);
  const finished = await page.evaluate(() => (window as unknown as { RWW: any }).RWW.game.missionHudModel);
  expect(finished).toMatchObject({ missionId: 'first-contact', status: 'completed', objectiveId: null, progressText: '10 / 10' });
  expect(await campaignProfile(page)).toMatchObject({
    currentMissionId: 'compact-02',
    completedMissionIds: ['compact-01'],
    unlockedMissionIds: ['compact-01', 'compact-02', 'choir-01'],
    lastResult: { missionId: 'compact-01', outcome: 'completed' },
  });

  const debrief = page.getByRole('dialog', { name: 'Mission complete' });
  await expect(debrief.getByRole('button', { name: 'Continue Campaign' })).toBeVisible();
  await expect(debrief.getByRole('button', { name: 'Replay Mission' })).toBeVisible();
  await debrief.getByRole('button', { name: 'Continue Campaign' }).click();

  const campaign = page.getByRole('dialog', { name: 'Campaign archive' });
  await expect(campaign).toBeVisible();
  await expect(campaign.locator('[data-campaign-mission-id="compact-01"]')).toHaveAttribute('data-state', 'completed');
  await expect(campaign.getByRole('region', { name: 'Campaign record' })).toContainText('First Contact // completed');
  expect(errors).toEqual([]);
});

test('restores tutorial progress from the validated save envelope and keeps campaign route context across reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'Campaign' }).click();
  await title.getByRole('dialog', { name: 'Campaign archive' })
    .getByRole('region', { name: 'Selected mission details' })
    .getByRole('button', { name: 'Begin First Contact' }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));

  const mission = page.locator('.rww-mission');
  await page.evaluate(() => {
    const game = (window as unknown as { RWW: any }).RWW.game;
    const engineer = game.world.units.find((unit: any) => unit.faction === 0 && unit.kind === 'engineer');
    game.selectAt(engineer.s, engineer.z, false);
    game.update(0, 1.5);
  });
  await expect(mission).toHaveAttribute('data-objective-id', 'build-power');

  const saved = await page.evaluate(() => (window as unknown as { RWW: any }).RWW.game.saveGame());
  expect(saved.ok).toBe(true);
  await page.evaluate(() => {
    const game = (window as unknown as { RWW: any }).RWW.game;
    game.startMission('first-contact', {
      tutorialNode: game.scenarioBindings.get('tutorial-node'),
      artilleryTarget: game.scenarioBindings.get('artillery-target'),
    });
    game.update(0, 1.6);
  });
  await expect(mission).toHaveAttribute('data-objective-id', 'select-engineer');

  const loaded = await page.evaluate(() => {
    const result = (window as unknown as { RWW: any }).RWW.game.loadGame();
    (window as unknown as { RWW: any }).RWW.game.update(0, 1.7);
    return result;
  });
  expect(loaded.ok).toBe(true);
  await expect(mission).toHaveAttribute('data-objective-id', 'build-power');

  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(page).toHaveURL(/scenario=first-contact/);
  await expect(page).toHaveURL(/campaignMission=compact-01/);
  await expect(page).toHaveURL(/campaignIntent=start/);
  const restored = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    return {
      mission: rww.game.missionHudModel,
      engineers: rww.game.world.units.filter((unit: any) => unit.alive && unit.faction === 0 && unit.kind === 'engineer').length,
    };
  });
  expect(restored.mission).toMatchObject({ missionId: 'first-contact', status: 'active', objectiveId: 'select-engineer' });
  expect(restored.engineers).toBe(3);
  expect(await campaignProfile(page)).toMatchObject({
    currentMissionId: 'compact-01',
    completedMissionIds: [],
    lastResult: null,
  });
  expect(errors).toEqual([]);
});

test('keeps the standalone tutorial arc outside campaign profile and campaign debrief actions', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?menu=0&scenario=first-contact&quality=low');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(page.locator('.rww-mission')).toHaveAttribute('data-mission-id', 'first-contact');

  await completeFirstContact(page);
  const finished = await page.evaluate(() => (window as unknown as { RWW: any }).RWW.game.missionHudModel);
  expect(finished).toMatchObject({ status: 'completed', progressText: '10 / 10' });

  const debrief = page.getByRole('dialog', { name: 'Mission complete' });
  await expect(debrief.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(debrief.getByRole('button', { name: 'Replay Mission' })).toHaveCount(0);
  await expect(debrief.getByRole('button', { name: 'Continue Campaign' })).toHaveCount(0);
  expect(await campaignProfile(page)).toMatchObject({
    revision: 0,
    currentMissionId: 'compact-01',
    completedMissionIds: [],
    lastResult: null,
  });
  expect(errors).toEqual([]);
});

async function campaignProfile(page: Page): Promise<any> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('ring-world-war/campaign-profile')!));
}

async function completeFirstContact(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as unknown as { RWW: any }).RWW.game;
    const world = game.world;
    const engineer = world.units.find((unit: any) => unit.faction === 0 && unit.kind === 'engineer');
    game.selectAt(engineer.s, engineer.z, false);
    let structureS = 100;
    const completeStructure = (kind: string) => {
      structureS += 90;
      const structure = world.spawnStructure(0, kind, structureS, 300, 0.999);
      Object.assign(engineer, {
        s: structure.s, z: structure.z, prevS: structure.s, prevZ: structure.z,
        order: { kind: 'build', s: structure.s, z: structure.z, targetId: structure.id },
        buildTargetId: structure.id,
      });
      game.stepSimulationExactlyOnce();
      return structure;
    };
    completeStructure('solarArray');
    completeStructure('solarArray');
    completeStructure('extractor');
    completeStructure('fabricator');
    const foundry = completeStructure('mechFoundry');
    const beforeWisp = new Set(world.units.map((unit: any) => unit.id));
    foundry.queue.push('wisp');
    foundry.queueTimer = 1_000;
    game.stepSimulationExactlyOnce();
    const wisp = world.units.find((unit: any) => !beforeWisp.has(unit.id) && unit.kind === 'wisp');
    const nodeId = game.scenarioBindings.get('tutorial-node');
    const node = world.structureById(nodeId);
    Object.assign(wisp, { s: node.s, z: node.z, prevS: node.s, prevZ: node.z });
    node.capture = -0.999;
    game.stepSimulationExactlyOnce();
    const beforeLongbow = new Set(world.units.map((unit: any) => unit.id));
    foundry.queue.push('longbow');
    foundry.queueTimer = 1_000;
    game.stepSimulationExactlyOnce();
    const longbow = world.units.find((unit: any) => !beforeLongbow.has(unit.id) && unit.kind === 'longbow');
    longbow.ability.active = true;
    longbow.ability.transitionTimer = 0;
    const target = world.structureById(game.scenarioBindings.get('artillery-target'));
    Object.assign(wisp, { s: target.s, z: target.z, prevS: target.s, prevZ: target.z });
    game.stepSimulationExactlyOnce();
    game.beginArtilleryTarget(longbow.id, 'siegeMortar');
    if (!game.fireArtilleryTarget(target.s, target.z)) throw new Error('controlled completion shot failed');
    game.updatePresentation(0, 1);
  });
}
