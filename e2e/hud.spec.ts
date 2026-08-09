import { expect, test } from 'playwright/test';
import { readFileSync } from 'node:fs';
// @ts-expect-error The CLI helpers are intentionally plain Node ESM.
import { parseScenario } from '../tools/rww/scenario.mjs';

const signalScenario = parseScenario(JSON.parse(readFileSync('validation/scenarios/a-signal-in-the-spine.json', 'utf8')));

test('HUD zones remain stable, non-overlapping, and acknowledge commands', async ({ page }) => {
  await page.goto('/?scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));
  await expect(page.locator('[data-resource="salvage"]')).toBeVisible();
  await page.locator('[data-resource="salvage"]').evaluate((node) => { node.setAttribute('data-stability-probe', 'kept'); });

  const result = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const unit = rww.game.world.units.find((candidate: any) => candidate.faction === 0);
    rww.game.selection.clear();
    rww.game.selection.add(unit.id);
    rww.game.issueOrder(unit.s + 80, unit.z, false);
    rww.testDriver.presentFrame(0, 2);
    rww.game.hud.consumePresentation([
      { kind: 'unitComplete', id: 900, s: unit.s, z: unit.z, h: 0, faction: 0, scale: 1, entityKind: 'vanguard' },
      { kind: 'structureComplete', id: 901, s: unit.s, z: unit.z, h: 0, faction: 0, scale: 1, entityKind: 'fabricator' },
      { kind: 'intercepted', id: 902, s: unit.s, z: unit.z, h: 20, faction: 0, scale: 1 },
      { kind: 'nodeCaptured', id: 903, s: unit.s, z: unit.z, h: 0, faction: 0, scale: 1 },
    ]);
    const bottom = document.querySelector('.rww-bottom')!.getBoundingClientRect();
    const map = document.querySelector('.rww-map')!.getBoundingClientRect();
    return { bottomRight: bottom.right, mapLeft: map.left };
  });

  expect(result.bottomRight).toBeLessThanOrEqual(result.mapLeft + 1);
  await expect(page.locator('[data-resource="salvage"]')).toHaveAttribute('data-stability-probe', 'kept');
  await expect(page.locator('.rww-command-ack')).toContainText('Move');
  await expect(page.locator('.rww-event-item')).toHaveCount(3);
  await expect(page.locator('.rww-sel')).toContainText('Order');
  await expect(page.locator('.rww-sel [role="meter"]')).toHaveAttribute('aria-valuenow');
  await expect(page.locator('.rww-btn s').first()).toContainText(/ready|locked|insufficient|active/i);

  const focused = page.locator('.rww-btn[data-command-key]').first();
  await focused.focus();
  const commandKey = await focused.getAttribute('data-command-key');
  await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    rww.game.world.players[0].salvage += 11;
    rww.testDriver.presentFrame(0, 2.1);
  });
  expect(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.commandKey)).toBe(commandKey);
  await page.evaluate(() => (window as unknown as { RWW: any }).RWW.game.hud.resetTransientState());
  await expect(page.locator('.rww-event-item')).toHaveCount(0);
});

test('controls reference is hidden by default and toggles with F1', async ({ page }) => {
  await page.goto('/?scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));
  const toggle = page.getByRole('button', { name: 'F1 Controls' });
  const reference = page.getByRole('dialog', { name: 'Game controls' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(reference).toBeHidden();
  await page.keyboard.press('F1');
  await expect(reference).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(reference).toContainText('Command Reference');
  await page.keyboard.press('F1');
  await expect(reference).toBeHidden();
  await expect(toggle).toBeFocused();
  await page.setViewportSize({ width: 320, height: 180 });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(reference).toBeVisible();
  const close = page.getByRole('button', { name: 'Close' });
  await expect(close).toBeInViewport();
  await close.click();
  await expect(reference).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('optional unit dossiers retain HUD copy and disappear cleanly on image failure', async ({ page }) => {
  await page.route('**/missing-unit-dossier.webp', (route) => route.abort());
  await page.goto('/?scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));
  await page.evaluate(async () => {
    const mediaPath = '/src/presentation/media.ts';
    const { PRESENTATION_MEDIA } = await import(/* @vite-ignore */ mediaPath);
    PRESENTATION_MEDIA.unitDossiers = {
      0: {
        vanguard: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4" height="5"/%3E',
      },
      1: { needle: '/missing-unit-dossier.webp' },
    };
    const rww = (window as unknown as { RWW: any }).RWW;
    const unit = rww.game.world.units.find((candidate: any) => candidate.faction === 0 && candidate.kind === 'vanguard') ??
      rww.game.world.spawnUnit(0, 'vanguard', 120, 0);
    rww.game.selection.clear();
    rww.game.selection.add(unit.id);
    rww.game.hud.invalidate();
    rww.testDriver.presentFrame(0, 1);
  });

  const dossier = page.locator('.rww-sel .rww-dossier');
  await expect(dossier).toBeVisible();
  await expect(dossier).toHaveAttribute('alt', '');
  await expect(dossier).toHaveAttribute('loading', 'lazy');
  await expect(dossier).toHaveAttribute('decoding', 'async');
  await expect(page.locator('.rww-sel')).toContainText('Vanguard');

  await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const unit = rww.game.world.spawnUnit(1, 'needle', 180, 0);
    rww.game.selection.clear();
    rww.game.selection.add(unit.id);
    rww.game.hud.invalidate();
    rww.testDriver.presentFrame(0, 2);
  });
  await expect(page.locator('.rww-sel .rww-dossier')).toHaveCount(0);
  await expect(page.locator('.rww-sel')).toContainText('Needle');
});

test('Settings makes gameplay inert and compact HUD remains contained', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 600 });
  await page.goto('/?scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('.rww-root')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.locator('.rww-root').evaluate((node) => (node as HTMLElement).inert)).toBe(true);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('.rww-root')).toHaveAttribute('aria-hidden', 'false');

  const boxes = await page.evaluate(() => ({
    map: document.querySelector('.rww-map')!.getBoundingClientRect().toJSON(),
    commands: document.querySelector('.rww-cmds')!.getBoundingClientRect().toJSON(),
  }));
  expect(boxes.map.y).toBeGreaterThanOrEqual(boxes.commands.y + boxes.commands.height - 1);
  expect(boxes.map.y + boxes.map.height).toBeLessThanOrEqual(600);

  await page.setViewportSize({ width: 500, height: 480 });
  const compact = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    rww.game.hud.command('Move accepted');
    rww.game.hud.consumePresentation([
      { kind: 'unitComplete', id: 910, s: 0, z: 0, h: 0, faction: 0, scale: 1, entityKind: 'vanguard' },
      { kind: 'structureComplete', id: 911, s: 0, z: 0, h: 0, faction: 0, scale: 1, entityKind: 'fabricator' },
      { kind: 'intercepted', id: 912, s: 0, z: 0, h: 0, faction: 0, scale: 1 },
    ]);
    const help = document.querySelector('.rww-help-toggle')!.getBoundingClientRect();
    const alert = document.querySelector('.rww-alert')!.getBoundingClientRect();
    const ack = document.querySelector('.rww-command-ack')!.getBoundingClientRect();
    const rail = document.querySelector('.rww-event-rail')!.getBoundingClientRect();
    const bottom = document.querySelector('.rww-bottom')!.getBoundingClientRect();
    return { helpBottom: help.bottom, alertTop: alert.top, ackBottom: ack.bottom, railTop: rail.top, railBottom: rail.bottom, bottomTop: bottom.top };
  });
  await expect(page.locator('.rww-event-item')).toHaveCount(3);
  expect(compact.helpBottom).toBeLessThanOrEqual(compact.alertTop);
  expect(compact.ackBottom).toBeLessThanOrEqual(compact.railTop);
  expect(compact.railBottom).toBeLessThanOrEqual(compact.bottomTop);

  await page.setViewportSize({ width: 700, height: 400 });
  const short = await page.evaluate(() => {
    const mission = document.querySelector<HTMLElement>('.rww-mission')!;
    mission.hidden = false;
    mission.textContent = 'Mission objective';
    const rail = document.querySelector('.rww-event-rail')!.getBoundingClientRect();
    const bottom = document.querySelector('.rww-bottom')!.getBoundingClientRect();
    return { missionBottom: mission.getBoundingClientRect().bottom, railBottom: rail.bottom, bottomTop: bottom.top };
  });
  expect(short.missionBottom).toBeLessThanOrEqual(short.bottomTop);
  expect(short.railBottom).toBeLessThanOrEqual(short.bottomTop);
});

test('blocking narrative traps focus and suppresses gameplay authority', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto(`/?seed=${signalScenario.worldSeed}&quality=${signalScenario.quality}&scenarioDriver=1`);
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));
  await page.keyboard.press('F1');
  await expect(page.getByRole('dialog', { name: 'Game controls' })).toBeVisible();
  await page.evaluate(async (scenario) => {
    const mediaPath = '/src/presentation/media.ts';
    const { PRESENTATION_MEDIA } = await import(/* @vite-ignore */ mediaPath);
    PRESENTATION_MEDIA.narrativePortraits = {
      'signal-briefing': 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="4" height="5"/%3E',
    };
    const modulePath = '/e2e/support/scenario-driver.ts';
    const driver = await import(/* @vite-ignore */ modulePath);
    driver.applyBrowserScenario(scenario);
  }, signalScenario);
  await expect(page.getByRole('dialog', { name: 'Game controls' })).toBeHidden();
  const compactLayout = await page.evaluate(() => ({
    helpBottom: document.querySelector('.rww-help-toggle')!.getBoundingClientRect().bottom,
    missionTop: document.querySelector('.rww-mission')!.getBoundingClientRect().top,
  }));
  expect(compactLayout.helpBottom).toBeLessThanOrEqual(compactLayout.missionTop);
  const begin = page.getByRole('button', { name: 'Begin' });
  await expect(begin).toBeInViewport();
  await expect(begin).toBeFocused();
  const portrait = page.locator('[data-narrative-id="signal-briefing"] .rww-narrative-portrait');
  await expect(portrait).toBeVisible();
  await expect(portrait).toHaveAttribute('alt', '');
  await expect(portrait).toHaveAttribute('loading', 'lazy');
  await expect(portrait).toHaveAttribute('decoding', 'async');
  await page.keyboard.press('Shift+Tab');
  await expect(begin).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { RWW: any }).RWW.game.hud.blocksGameplayInput)).toBe(true);
  expect(await page.locator('.rww-map').evaluate((node) => (node as HTMLElement).inert)).toBe(true);
  expect(await page.locator('canvas').first().evaluate((node) => (node as HTMLElement).inert)).toBe(true);
  await begin.click();
  await page.evaluate(() => (window as unknown as { RWW: any }).RWW.testDriver.presentFrame(0, 1));
  expect(await page.evaluate(() => (window as unknown as { RWW: any }).RWW.game.hud.blocksGameplayInput)).toBe(false);
  await expect(page.getByRole('button', { name: 'F1 Controls' })).toBeFocused();
});

test('direct-control mode rejects tactical minimap/order authority', async ({ page }) => {
  await page.goto('/?scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));
  const result = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const mech = rww.game.world.units.find((unit: any) => unit.faction === 0 && unit.kind !== 'engineer') ??
      rww.game.world.spawnUnit(0, 'vanguard', 120, 0);
    rww.game.selection.clear();
    rww.game.selection.add(mech.id);
    rww.game.enterDirectControl();
    const before = { ...mech.order };
    rww.game.issueOrder(mech.s + 500, mech.z, false);
    rww.testDriver.presentFrame(0, 3);
    return { before, after: { ...mech.order } };
  });
  expect(result.after).toEqual(result.before);
  await expect(page.locator('.rww-mode')).toHaveText('Direct control');
});
