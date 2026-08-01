import { expect, test } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?seed=20260731');
  await page.waitForFunction(() => Boolean(window.RWW));
});

test('settings toggle without pausing and suppress gameplay input', async ({ page }) => {
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Settings' });
  await expect(menu).toBeVisible();

  const before = await page.evaluate(() => ({
    time: window.RWW!.game.world.time,
    focusS: window.RWW!.rig.s,
  }));
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  const after = await page.evaluate(() => ({
    time: window.RWW!.game.world.time,
    focusS: window.RWW!.rig.s,
  }));

  expect(after.time).toBeGreaterThan(before.time);
  expect(after.focusS).toBe(before.focusS);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(menu).toBeHidden();
});

test('one Escape cancels a selected-unit interaction and opens Settings', async ({ page }) => {
  const selectedId = await page.evaluate(() => {
    const game = window.RWW!.game;
    const unit = game.world.spawnUnit(0, 'vanguard', 60, 0);
    game.selection.add(unit.id);
    return unit.id;
  });

  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  expect(await page.evaluate((id) => window.RWW!.game.selection.has(id), selectedId)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
});

test('manual quality and volume persist while URL quality only overrides the session', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.getByLabel('Graphics quality').selectOption('medium');
  await page.getByLabel('Master volume').fill('35');

  await expect.poll(() => page.evaluate(() => window.RWW!.renderer.quality)).toBe('medium');
  expect(await page.evaluate(() => window.RWW!.renderer.autoQuality)).toBe(false);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.RWW));
  expect(await page.evaluate(() => window.RWW!.renderer.quality)).toBe('medium');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Master volume')).toHaveValue('35');

  await page.goto('/?seed=20260731&quality=low');
  await page.waitForFunction(() => Boolean(window.RWW));
  expect(await page.evaluate(() => window.RWW!.renderer.quality)).toBe('low');

  await page.goto('/?seed=20260731');
  await page.waitForFunction(() => Boolean(window.RWW));
  expect(await page.evaluate(() => window.RWW!.renderer.quality)).toBe('medium');
});

test('F3 overlay is hidden by default and exposes required performance labels', async ({ page }) => {
  const overlay = page.locator('[data-rww-debug-overlay]');
  await expect(overlay).toBeHidden();

  await page.keyboard.press('F3');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Frame');
  await expect(overlay).toContainText('FPS');
  await expect(overlay).toContainText('Draw calls');
  await expect(overlay).toContainText('Active entities');
  await expect(overlay).toContainText('Sim step');
  await expect(overlay).toContainText('Memory');
  expect(await overlay.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
});

test('save and load restore the complete session and reject a corrupt slot atomically', async ({ page }) => {
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Save game' }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText('saved');
  const savedHash = await page.evaluate(() => window.RWW!.game.world.stateHash());

  await page.evaluate(() => {
    const game = window.RWW!.game;
    game.world.players[0].salvage = 17;
    game.world.spawnUnit(0, 'wisp', 300, 0);
    for (let i = 0; i < 10; i++) game.world.step();
  });
  expect(await page.evaluate(() => window.RWW!.game.world.stateHash())).not.toBe(savedHash);

  await page.getByRole('button', { name: 'Load game' }).click();
  expect(await page.evaluate(() => window.RWW!.game.world.stateHash())).toBe(savedHash);

  await page.evaluate(() => {
    localStorage.setItem('ring-world-war/save-slot', '{broken');
    window.RWW!.game.world.players[0].salvage = 777;
  });
  const beforeRejectedLoad = await page.evaluate(() => window.RWW!.game.world.stateHash());
  await page.getByRole('button', { name: 'Load game' }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(/could not load/i);
  expect(await page.evaluate(() => window.RWW!.game.world.stateHash())).toBe(beforeRejectedLoad);
});

test('load rejects a save from a different URL terrain seed without mutation', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save game' }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText('saved');

  await page.goto('/?seed=20260732&quality=low');
  await page.waitForFunction(() => Boolean(window.RWW));
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => window.RWW!.game.world.stateHash());

  await page.getByRole('button', { name: 'Load game' }).click();

  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(/terrain seed/i);
  expect(await page.evaluate(() => window.RWW!.game.world.stateHash())).toBe(before);
});
