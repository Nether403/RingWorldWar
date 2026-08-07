import { expect, test, type Page } from 'playwright/test';

// Visual-review fixture: equivalent to a post-mission archive, using a profile
// shape accepted by the production parser rather than display-only mock data.
const POST_MISSION_VISUAL_PROFILE = {
  schema: 'ring-world-war/campaign-profile',
  version: 2,
  revision: 4,
  unlockedMissionIds: ['compact-01', 'compact-02', 'choir-01'],
  completedMissionIds: ['compact-01'],
  currentMissionId: 'compact-02',
  lastResult: { missionId: 'compact-01', outcome: 'completed' },
} as const;

test('browses both campaign arcs and launches First Contact through the production runtime route', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1_280, height: 720 });
  await page.goto('/?menu=1&quality=low');

  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'Campaign' }).click();
  const campaign = title.getByRole('dialog', { name: 'Campaign archive' });
  await expect(campaign).toBeVisible();
  await expect(campaign.getByRole('heading', { name: 'Meridian Compact' })).toBeVisible();
  await expect(campaign.getByRole('heading', { name: 'Axiom Choir' })).toBeVisible();
  await expect(campaign.locator('[data-campaign-mission-id]')).toHaveCount(12);
  await expect(campaign.locator('[data-campaign-mission-id="compact-01"]')).toHaveAttribute('data-state', 'current');
  await expect(campaign.locator('[data-campaign-mission-id="compact-02"]')).toHaveAttribute('data-state', 'locked');
  await expect(campaign.locator('[data-campaign-mission-id="choir-01"]')).toHaveAttribute('data-state', 'unavailable');
  const record = campaign.getByRole('region', { name: 'Campaign record' });
  await expect(record).toContainText('0 / 12');
  await expect(record).toContainText('No operation recorded');
  await expect(record).toContainText('First Contact // ready');
  const detail = campaign.getByRole('region', { name: 'Selected mission details' });
  const firstContactOption = campaign.getByRole('option', { name: 'First Contact' });
  await expect(firstContactOption).toHaveAttribute('aria-selected', 'true');
  await expect(firstContactOption).toHaveAttribute('aria-controls', 'rww-campaign-detail');
  await expect(detail).toHaveAttribute('aria-live', 'polite');
  await expect(detail.getByRole('heading', { name: 'First Contact' })).toBeVisible();
  await expect(detail).toContainText('Controls, economy, wrap, first Node, favorable artillery direction');
  await expect(detail).toContainText('Mission 01 of 06');
  await expect(detail.getByRole('button', { name: 'Begin First Contact' })).toBeEnabled();

  const lockedMission = campaign.locator('[data-campaign-mission-id="compact-02"]');
  await lockedMission.focus();
  await expect(detail.getByRole('heading', { name: 'Break the Line' })).toBeVisible();
  await expect(detail).toContainText('Complete First Contact to unlock this mission');
  await expect(detail.getByRole('button', { name: /Locked/ })).toBeDisabled();
  await campaign.locator('[data-campaign-mission-id="choir-01"]').click();
  await expect(detail.getByRole('heading', { name: 'The Listening Arc' })).toBeVisible();
  await expect(detail).toContainText('production runtime scenario has not been migrated');
  await campaign.locator('[data-campaign-mission-id="compact-01"]').click();
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
  expect(state.mission).toMatchObject({ missionId: 'first-contact', status: 'active' });
  expect(errors).toEqual([]);
});

test('documents the valid post-mission archive visual fixture and replay record', async ({ page }) => {
  await page.goto('/?menu=1&campaign=1&quality=low');
  await page.evaluate((profile) => {
    localStorage.setItem('ring-world-war/campaign-profile', JSON.stringify(profile));
  }, POST_MISSION_VISUAL_PROFILE);
  await page.reload();

  const campaign = page.getByRole('dialog', { name: 'Campaign archive' });
  const record = campaign.getByRole('region', { name: 'Campaign record' });
  await expect(record).toContainText('1 / 12');
  await expect(record).toContainText('1 / 6');
  await expect(record).toContainText('0 / 6');
  await expect(record).toContainText('First Contact // completed');
  await expect(record).toContainText('Break the Line // unavailable');
  await expect(campaign.locator('[data-campaign-mission-id="compact-01"]')).toHaveAttribute('data-state', 'completed');
  await expect(campaign.locator('[data-campaign-mission-id="compact-02"]')).toHaveAttribute('data-continuation', 'true');

  await campaign.getByRole('option', { name: 'First Contact' }).click();
  const detail = campaign.getByRole('region', { name: 'Selected mission details' });
  await expect(detail).toContainText('Completion recorded');
  await expect(detail).toContainText('Last operation: completed');
  await expect(detail.getByRole('button', { name: 'Replay First Contact' })).toBeEnabled();
});

test('keeps mission inspection and the detail action usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?menu=1&campaign=1&quality=low');
  const campaign = page.getByRole('dialog', { name: 'Campaign archive' });
  const detail = campaign.getByRole('region', { name: 'Selected mission details' });
  await expect(detail.getByRole('heading', { name: 'First Contact' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Begin First Contact' })).toBeVisible();
  await campaign.getByRole('option', { name: 'The Listening Arc' }).click();
  await expect(detail.getByRole('heading', { name: 'The Listening Arc' })).toBeVisible();
  await expect(detail.getByRole('button', { name: /Unavailable/ })).toBeVisible();
  const bounds = await campaign.evaluate((element) => {
    const root = element as HTMLElement;
    const card = root.querySelector<HTMLElement>('.rww-title-campaign-card')!;
    const rect = card.getBoundingClientRect();
    return {
      rootScrollWidth: root.scrollWidth,
      rootClientWidth: root.clientWidth,
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(bounds.rootScrollWidth).toBeLessThanOrEqual(bounds.rootClientWidth);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
});

test('keeps the procedural campaign destination usable when optional reviewed media is missing', async ({ page }) => {
  await page.goto('/?menu=1&campaign=1&quality=low&mediaTest=missing-campaign');
  const campaign = page.getByRole('dialog', { name: 'Campaign archive' });
  const detail = campaign.getByRole('region', { name: 'Selected mission details' });
  await expect(campaign.locator('.rww-title-campaign-backdrop')).toHaveCount(0);
  await expect(campaign.locator('.rww-title-campaign-ring')).toBeVisible();
  await expect(detail.locator('.rww-title-campaign-art img')).not.toHaveAttribute('src');
  await expect(detail.getByRole('heading', { name: 'First Contact' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Begin First Contact' })).toBeEnabled();
});

test('completes First Contact through the ordinary mission hook and offers continuation and replay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'Campaign' }).click();
  await title.getByRole('dialog', { name: 'Campaign archive' })
    .getByRole('region', { name: 'Selected mission details' })
    .getByRole('button', { name: 'Begin First Contact' }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));

  await completeFirstContact(page);
  await expect.poll(() => page.evaluate(() => {
    const profile = JSON.parse(localStorage.getItem('ring-world-war/campaign-profile')!);
    return {
      completed: profile.completedMissionIds,
      unlocked: profile.unlockedMissionIds,
      current: profile.currentMissionId,
    };
  })).toEqual({
    completed: ['compact-01'],
    unlocked: ['compact-01', 'compact-02', 'choir-01'],
    current: 'compact-02',
  });

  const debrief = page.getByRole('dialog', { name: 'Mission complete' });
  await expect(debrief.getByRole('button', { name: 'Continue Campaign' })).toBeVisible();
  await expect(debrief.getByRole('button', { name: 'Replay Mission' })).toBeVisible();
  await debrief.getByRole('button', { name: 'Continue Campaign' }).click();

  const campaign = page.getByRole('dialog', { name: 'Campaign archive' });
  await expect(campaign).toBeVisible();
  await expect(campaign.locator('[data-campaign-mission-id="compact-01"]')).toHaveAttribute('data-state', 'completed');
  await expect(campaign.locator('[data-campaign-mission-id="compact-02"]')).toHaveAttribute('data-state', 'unavailable');
  await expect(campaign.getByRole('status')).toContainText('Break the Line is unlocked but not available yet');
  const detail = campaign.getByRole('region', { name: 'Selected mission details' });
  await expect(detail.getByRole('heading', { name: 'Break the Line' })).toBeVisible();
  await expect(detail.getByRole('button', { name: /Unavailable/ })).toBeDisabled();
});

test('completes repeated replay reloads with campaign actions and without replacing continuation', async ({ page }) => {
  await page.goto('/?menu=1&campaign=1&quality=low');
  await page.evaluate((profile) => localStorage.setItem(
    'ring-world-war/campaign-profile',
    JSON.stringify(profile),
  ), POST_MISSION_VISUAL_PROFILE);
  await page.reload();
  const campaign = page.getByRole('dialog', { name: 'Campaign archive' });
  await expect(campaign).toBeVisible();
  await campaign.locator('[data-campaign-mission-id="compact-01"]').click();
  await campaign.getByRole('region', { name: 'Selected mission details' })
    .getByRole('button', { name: 'Replay First Contact' }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await expect(page).toHaveURL(/campaignMission=compact-01/);
  await expect(page).toHaveURL(/campaignIntent=replay/);
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await completeFirstContact(page);
  const firstDebrief = page.getByRole('dialog', { name: 'Mission complete' });
  await expect(firstDebrief.getByRole('button', { name: 'Continue Campaign' })).toBeVisible();
  await expect(firstDebrief.getByRole('button', { name: 'Replay Mission' })).toBeVisible();
  expect(await campaignProfile(page)).toMatchObject({
    currentMissionId: 'compact-02',
    completedMissionIds: ['compact-01'],
    lastResult: { missionId: 'compact-01', outcome: 'completed' },
  });

  await firstDebrief.getByRole('button', { name: 'Replay Mission' }).click();
  await page.waitForURL((url) => url.searchParams.get('campaignIntent') === 'replay');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await completeFirstContact(page);
  await expect(page.getByRole('dialog', { name: 'Mission complete' })
    .getByRole('button', { name: 'Replay Mission' })).toBeVisible();
  expect(await campaignProfile(page)).toMatchObject({
    currentMissionId: 'compact-02',
    lastResult: { missionId: 'compact-01', outcome: 'completed' },
  });
});

test('restores retry context after reload and records normal completion semantics', async ({ page }) => {
  await page.goto('/?menu=1&quality=low');
  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'Campaign' }).click();
  await title.getByRole('dialog', { name: 'Campaign archive' })
    .getByRole('region', { name: 'Selected mission details' })
    .getByRole('button', { name: 'Begin First Contact' }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));

  const failedWorld = await failFirstContactByEngineerLoss(page);
  const failedDebrief = page.getByRole('dialog', { name: 'Mission failed' });
  await expect(failedDebrief).toContainText('Construction crew lost');
  await expect(failedDebrief.getByRole('button', { name: 'Retry Mission' })).toBeVisible();
  expect(await campaignProfile(page)).toMatchObject({
    currentMissionId: 'compact-01',
    completedMissionIds: [],
    lastResult: { missionId: 'compact-01', outcome: 'failed' },
  });

  expect((await page.evaluate(() => (window as unknown as { RWW: any }).RWW.game.saveGame())).ok).toBe(true);
  const savedFailure = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('ring-world-war/save-slot')!);
    return {
      status: saved.mission.status,
      reason: saved.mission.milestones.firstContactFailureReason,
    };
  });
  expect(savedFailure).toEqual({ status: 'failed', reason: 'engineers-lost' });

  await failedDebrief.getByRole('button', { name: 'Retry Mission' }).click();
  await page.waitForURL((url) => url.searchParams.get('campaignIntent') === 'retry');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  const freshWorld = await page.evaluate(() => {
    const game = (window as unknown as { RWW: any }).RWW.game;
    return {
      tick: game.world.tick,
      status: game.missionHudModel.status,
      objectiveId: game.missionHudModel.objectiveId,
      engineers: game.world.units.filter((unit: any) =>
        unit.alive && unit.faction === 0 && unit.kind === 'engineer').length,
    };
  });
  expect(freshWorld).toMatchObject({ status: 'active', objectiveId: 'select-engineer', engineers: 3 });
  expect(freshWorld.tick).toBeLessThan(failedWorld.tick + 2);
  await completeFirstContact(page);

  const debrief = page.getByRole('dialog', { name: 'Mission complete' });
  await expect(debrief.getByRole('button', { name: 'Continue Campaign' })).toBeVisible();
  await expect(debrief.getByRole('button', { name: 'Replay Mission' })).toBeVisible();
  expect(await campaignProfile(page)).toMatchObject({
    currentMissionId: 'compact-02',
    completedMissionIds: ['compact-01'],
    unlockedMissionIds: ['compact-01', 'compact-02', 'choir-01'],
    lastResult: { missionId: 'compact-01', outcome: 'completed' },
  });
});

test('rejects invalid or mismatched campaign route context', async ({ page }) => {
  await page.goto('/?menu=0&scenario=first-contact&campaignMission=choir-01&campaignIntent=start&quality=low');
  await expect(page.locator('#bootmsg')).toContainText(/Failed to start:.*scenario/i);
  await expect(page.locator('#app canvas')).toHaveCount(0);

  await page.goto('/?menu=0&scenario=first-contact&campaignMission=compact-01&campaignIntent=replay&quality=low');
  await expect(page.locator('#bootmsg')).toContainText(/Failed to start:.*completed/i);
  await expect(page.locator('#app canvas')).toHaveCount(0);
});

test('keeps standalone First Contact outside campaign profile and debrief actions', async ({ page }) => {
  await page.goto('/?menu=0&scenario=first-contact&quality=low');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await completeFirstContact(page);

  const debrief = page.getByRole('dialog', { name: 'Mission complete' });
  await expect(debrief.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(debrief.getByRole('button', { name: 'Replay Mission' })).toHaveCount(0);
  expect(await campaignProfile(page)).toMatchObject({
    revision: 0,
    currentMissionId: 'compact-01',
    completedMissionIds: [],
    lastResult: null,
  });
});

async function campaignProfile(page: Page): Promise<any> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('ring-world-war/campaign-profile')!));
}

async function failFirstContactByEngineerLoss(page: Page): Promise<{ tick: number }> {
  return page.evaluate(() => {
    const game = (window as unknown as { RWW: any }).RWW.game;
    for (let tick = 0; tick < 6_000 && game.missionHudModel.status === 'active'; tick++) {
      game.stepSimulationExactlyOnce();
    }
    game.updatePresentation(0, 1);
    if (game.missionHudModel.status !== 'failed') {
      const units = game.world.units.map((unit: any) => ({
        faction: unit.faction,
        kind: unit.kind,
        alive: unit.alive,
        s: Math.round(unit.s),
        z: Math.round(unit.z),
        hp: Math.round(unit.hp),
        order: unit.order.kind,
        targetId: unit.targetId,
      }));
      throw new Error(`shipped First Contact threat did not reach mission failure: ${JSON.stringify(units)}`);
    }
    return { tick: game.world.tick };
  });
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
