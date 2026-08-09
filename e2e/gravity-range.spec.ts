import { expect, test } from 'playwright/test';
import { RING_CIRCUMFERENCE } from '../src/core/constants';

test('[gravity-range-production] launches and completes the canonical directional exercise at 1280x720 Low', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?menu=1&quality=low');

  const title = page.locator('[data-rww-title-screen]');
  await title.getByRole('button', { name: 'Gravity Range' }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  expect(new URL(page.url()).searchParams.get('mode')).toBe('gravity-range');
  expect(new URL(page.url()).searchParams.has('scenarioDriver')).toBe(false);

  const panel = page.getByRole('region', { name: 'Gravity Range' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('1 / 2 · 800 m');
  await expect(panel).toContainText('Spinward');
  await expect(panel).toContainText(/Antispinward = long shot/i);
  await expect(panel).toContainText(/Ring edges join/i);
  await expect(page.locator('.rww-target-status')).toContainText(/checking target coordinates|ready to fire/i);

  const initial = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    return {
      runtimeScenario: rww.probe().runtimeScenario,
      aiEnabled: rww.game.isAiEnabled,
      gravityRange: rww.game.gravityRangeHudModel,
      selected: [...rww.game.selection],
      artilleryTargeting: rww.game.artilleryTargeting,
      rejectedWeapon: (() => {
        const launcherId = [...rww.game.selection][0];
        rww.game.beginArtilleryTarget(launcherId, 'cruiseMissile');
        const selected = rww.game.artilleryWeapon;
        rww.game.beginArtilleryTarget(launcherId, 'batteryGun');
        return selected;
      })(),
    };
  });
  expect(initial).toMatchObject({
    runtimeScenario: 'gravity-range',
    aiEnabled: false,
    gravityRange: { stage: 'spinward', completedImpacts: 0 },
    artilleryTargeting: true,
    rejectedWeapon: 'batteryGun',
  });
  expect(initial.selected).toHaveLength(1);
  await expect(page.locator('[data-artillery-weapon="cruiseMissile"]')).toBeHidden();
  expect(await countStableInstructionMutations(page)).toBe(0);

  await clickMinimapAt(page, 4_800, 0);
  await advanceUntil(page, 'antispinward');
  await expect(panel).toContainText('2 / 2 · 1,800 m');
  await expect(panel).toContainText('Antispinward');

  await page.keyboard.press('KeyM');
  await expect(page.locator('.rww-mode')).toHaveText('Whole-ring strategic view');
  const isolatedFire = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const launcher = rww.game.world.structureById([...rww.game.selection][0]);
    const before = [...launcher.cd];
    const fired = rww.game.fireArtilleryTarget(2_200, 0);
    return { mode: rww.cameraController.mode, fired, before, after: [...launcher.cd] };
  });
  expect(isolatedFire).toMatchObject({ mode: 'whole-ring', fired: false });
  expect(isolatedFire.after).toEqual(isolatedFire.before);
  await page.keyboard.press('Escape');
  await expect(page.locator('.rww-mode')).toHaveText(/artillery targeting/i);

  await advanceUntilReloaded(page);
  await clickMinimapAt(page, 2_200, 0);
  await advanceUntil(page, 'complete');
  await expect(panel).toHaveAttribute('data-status', 'completed');
  await expect(panel).toContainText('Range complete');
  await expect(panel).toContainText('2 / 2 authoritative impacts confirmed');
  await expect(panel).toContainText(/Antispinward carried the farther shot/i);

  const bounds = await panel.evaluate((element) => element.getBoundingClientRect().toJSON());
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);

  await panel.getByRole('button', { name: 'Main menu' }).click();
  await expect(page.locator('[data-rww-title-screen]')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('menu')).toBe('1');
  expect(new URL(page.url()).searchParams.has('mode')).toBe(false);
  expect(errors).toEqual([]);
});

test('[gravity-range-responsive] keeps the mode panel and actions contained at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?menu=0&mode=gravity-range&quality=low');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  const panel = page.getByRole('region', { name: 'Gravity Range' });
  await expect(panel.getByRole('button', { name: 'Retry range' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Main menu' })).toBeVisible();
  const bounds = await panel.evaluate((element) => element.getBoundingClientRect().toJSON());
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
  const tacticalCollisions = await page.evaluate(() => {
    const panel = document.querySelector('.rww-gravity-range')!.getBoundingClientRect();
    return ['.rww-view-toggle', '.rww-help-toggle', '.rww-map', '.rww-bottom']
      .filter((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        return element && getComputedStyle(element).display !== 'none' && intersects(panel, element.getBoundingClientRect());
      });

    function intersects(a: DOMRect, b: DOMRect): boolean {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }
  });
  expect(tacticalCollisions).toEqual([]);

  await page.keyboard.press('KeyM');
  await expect(page.locator('.rww-strategic-panel')).toBeVisible();
  await expect(panel.locator('.rww-gravity-instruction')).toContainText(/Strike the nearer spinward marker/i);
  await expect(panel.locator('.rww-gravity-physics')).toContainText(/Antispinward = long shot/i);
  await expect(panel.locator('.rww-gravity-reload')).toContainText(/Launcher ready/i);
  await expect(panel.getByRole('button', { name: 'Retry range' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Main menu' })).toBeVisible();
  const strategicCollisions = await page.evaluate(() => {
    const panel = document.querySelector('.rww-gravity-range')!.getBoundingClientRect();
    const strategic = document.querySelector('.rww-strategic-panel')!.getBoundingClientRect();
    return panel.left < strategic.right && panel.right > strategic.left
      && panel.top < strategic.bottom && panel.bottom > strategic.top;
  });
  expect(strategicCollisions).toBe(false);
  const legibility = await panel.evaluate((element) => {
    const instruction = getComputedStyle(element.querySelector('.rww-gravity-instruction')!);
    const physics = getComputedStyle(element.querySelector('.rww-gravity-physics')!);
    const action = element.querySelector('button')!.getBoundingClientRect();
    const actionStyle = getComputedStyle(element.querySelector('button')!);
    return {
      instructionFont: Number.parseFloat(instruction.fontSize),
      physicsFont: Number.parseFloat(physics.fontSize),
      actionFont: Number.parseFloat(actionStyle.fontSize),
      actionHeight: action.height,
    };
  });
  expect(legibility.instructionFont).toBeGreaterThanOrEqual(10);
  expect(legibility.physicsFont).toBeGreaterThanOrEqual(9);
  expect(legibility.actionFont).toBeGreaterThanOrEqual(9);
  expect(legibility.actionHeight).toBeGreaterThanOrEqual(34);
});

test('[gravity-range-keyboard] completes from the keyboard, preserves saves, and retries deterministically', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?menu=1&quality=low');

  const launch = page.getByRole('button', { name: 'Gravity Range' });
  await launch.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));
  await page.evaluate(() => localStorage.setItem('ring-world-war/save-slot', 'range-save-sentinel'));

  const authorityResults = await page.evaluate(() => {
    const game = (window as unknown as { RWW: any }).RWW.game;
    return { save: game.saveGame(), load: game.loadGame() };
  });
  expect(authorityResults.save).toMatchObject({ ok: false });
  expect(authorityResults.load).toMatchObject({ ok: false });
  expect(await page.evaluate(() => localStorage.getItem('ring-world-war/save-slot'))).toBe('range-save-sentinel');

  await page.keyboard.press('Escape');
  const panel = page.getByRole('region', { name: 'Gravity Range', includeHidden: true });
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  expect(await panel.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  const save = page.getByRole('button', { name: 'Save game' });
  await save.focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => localStorage.getItem('ring-world-war/save-slot'))).toBe('range-save-sentinel');
  await page.keyboard.press('Escape');
  await expect(panel).not.toHaveAttribute('aria-hidden');
  expect(await panel.evaluate((element) => (element as HTMLElement).inert)).toBe(false);

  await focusAndFireCurrentMarker(page, panel);
  await advanceUntil(page, 'antispinward');
  await advanceUntilReloaded(page);
  await focusAndFireCurrentMarker(page, panel);
  await advanceUntil(page, 'complete');

  const retry = panel.getByRole('button', { name: 'Retry range' });
  await retry.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const rww = (window as unknown as { RWW?: any }).RWW;
    return rww?.game.gravityRangeHudModel?.stage === 'spinward';
  });
  expect(new URL(page.url()).searchParams.get('mode')).toBe('gravity-range');
  expect(new URL(page.url()).searchParams.get('quality')).toBe('low');
  expect(await page.evaluate(() => localStorage.getItem('ring-world-war/save-slot'))).toBe('range-save-sentinel');
});

test('[gravity-range-lifecycle] disposes the complete range session without DOM or style owners', async ({ page }) => {
  await page.goto('/?menu=0&mode=gravity-range&quality=low');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));

  const result = await page.evaluate(() => {
    const target = window as unknown as { RWW?: { dispose(): void } };
    target.RWW!.dispose();
    return {
      rwwPresent: target.RWW !== undefined,
      panelCount: document.querySelectorAll('.rww-gravity-range').length,
      styleCount: document.querySelectorAll('style[data-rww-gravity-range-style]').length,
      hudCount: document.querySelectorAll('.rww-root').length,
      settingsCount: document.querySelectorAll('.rww-settings').length,
      canvasCount: document.querySelectorAll('#app canvas').length,
    };
  });
  expect(result).toEqual({
    rwwPresent: false,
    panelCount: 0,
    styleCount: 0,
    hudCount: 0,
    settingsCount: 0,
    canvasCount: 0,
  });
});

async function clickMinimapAt(page: import('playwright/test').Page, s: number, z: number): Promise<void> {
  const map = page.locator('.rww-map canvas');
  const box = await map.boundingBox();
  if (!box) throw new Error('Gravity Range minimap is not visible');
  const x = box.x + (s / RING_CIRCUMFERENCE) * box.width;
  const y = box.y + (z / 6_000 + 0.5) * box.height;
  await page.mouse.click(x, y);
}

async function advanceUntil(page: import('playwright/test').Page, stage: string): Promise<void> {
  await page.evaluate((expected) => {
    const rww = (window as unknown as { RWW: any }).RWW;
    for (let tick = 0; tick < 2_400 && rww.game.gravityRangeHudModel.stage !== expected; tick++) {
      rww.game.stepSimulationExactlyOnce();
    }
    if (rww.game.gravityRangeHudModel.stage !== expected) {
      throw new Error(`Gravity Range did not reach ${expected}`);
    }
  }, stage);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { RWW: any }).RWW.game.gravityRangeHudModel.stage)).toBe(stage);
}

async function advanceUntilReloaded(page: import('playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    for (let tick = 0; tick < 600 && rww.game.gravityRangeReloadSeconds > 0; tick++) {
      rww.game.stepSimulationExactlyOnce();
    }
    if (rww.game.gravityRangeReloadSeconds > 0) throw new Error('Gravity Range launcher did not reload');
  });
}

async function focusAndFireCurrentMarker(
  page: import('playwright/test').Page,
  panel: import('playwright/test').Locator,
): Promise<void> {
  const focus = panel.getByRole('button', { name: 'Focus current marker' });
  await focus.focus();
  await page.keyboard.press('Enter');
  const minimap = page.locator('.rww-map canvas');
  await expect(minimap).toBeFocused();
  await page.keyboard.press('Enter');
}

async function countStableInstructionMutations(page: import('playwright/test').Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve) => {
    const instruction = document.querySelector('.rww-gravity-instruction')!;
    let mutations = 0;
    const observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(instruction, { childList: true, characterData: true, subtree: true });
    window.setTimeout(() => {
      observer.disconnect();
      resolve(mutations);
    }, 120);
  }));
}
