import { expect, test } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?seed=20260731&quality=low');
  await page.waitForFunction(() => Boolean(window.RWW));
});

test('renders Silo, Laser Grid, wreck, and owner cloak presentation without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const wreckId = await page.evaluate(() => {
    const { game, rig } = window.RWW!;
    game.world.spawnStructure(0, 'silo', 100, -40, 1);
    game.world.spawnStructure(0, 'laserGrid', 130, 40, 1);
    const destroyed = game.world.spawnUnit(0, 'vanguard', 160, 0);
    game.world.applyDamage(destroyed.id, 100_000, 'explosive', 1);
    const cloaked = game.world.spawnUnit(0, 'wisp', 190, 0);
    cloaked.cloaked = true;
    cloaked.ability!.active = true;
    rig.setFocus(145, 0);
    return game.world.wreckages[0]!.id;
  });

  await page.waitForTimeout(300);
  const counts = await page.evaluate(() => {
    const entities = window.RWW!.game.entities.object;
    const count = (name: string): number =>
      (entities.getObjectByName(name) as { count?: number } | undefined)?.count ?? 0;
    return {
      silo: count('structure:silo:0'),
      laserGrid: count('structure:laserGrid:0'),
      wreck: count('wreck:vanguard'),
      cloak: count('cloak:wisp:torso:0'),
    };
  });
  expect(counts).toEqual({ silo: 1, laserGrid: 1, wreck: 1, cloak: 1 });

  await page.evaluate((id) => {
    window.RWW!.game.world.wreckById(id)!.alive = false;
  }, wreckId);
  await expect
    .poll(() => page.evaluate(() => {
      const mesh = window.RWW!.game.entities.object.getObjectByName('wreck:vanguard') as
        | { count?: number }
        | undefined;
      return mesh?.count ?? 0;
    }))
    .toBe(0);
  expect(errors).toEqual([]);
});

test('keeps explicit artillery weapon selection for batteries and silos', async ({ page }) => {
  const ids = await page.evaluate(() => {
    const game = window.RWW!.game;
    return {
      battery: game.world.spawnStructure(0, 'rocketBattery', 100, 0, 1).id,
      silo: game.world.spawnStructure(0, 'silo', 160, 0, 1).id,
    };
  });

  await page.evaluate((id) => {
    const game = window.RWW!.game;
    game.selection.clear();
    game.selection.add(id);
  }, ids.battery);
  await expect(page.getByRole('button', { name: /Standard Rocket/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Cruise Missile/i })).toBeVisible();
  await page.getByRole('button', { name: /Cruise Missile/i }).click();
  expect(await page.evaluate(() => window.RWW!.game.artilleryWeapon)).toBe('cruiseMissile');

  await page.evaluate((id) => {
    const game = window.RWW!.game;
    game.cancelArtilleryTarget();
    game.selection.clear();
    game.selection.add(id);
  }, ids.silo);
  await expect(page.getByRole('button', { name: /Chord Shot/i })).toBeVisible();
  await page.getByRole('button', { name: /Chord Shot/i }).click();
  expect(await page.evaluate(() => window.RWW!.game.artilleryWeapon)).toBe('chordShot');
  await expect(page.locator('.rww-alert')).not.toContainText(/spotted target/i);
});

test('activates a selected mech ability from the HUD and X hotkey', async ({ page }) => {
  const unitId = await page.evaluate(() => {
    const game = window.RWW!.game;
    game.world.spawnStructure(0, 'fusionCore', 300, 0, 1);
    const unit = game.world.spawnUnit(0, 'vanguard', 100, 0);
    game.selection.clear();
    game.selection.add(unit.id);
    return unit.id;
  });

  const ability = page.getByRole('button', { name: /Shield Wall/i });
  await expect(ability).toBeVisible();
  await expect(ability).toContainText('ready');
  await ability.click();
  await expect.poll(() => page.evaluate((id) => window.RWW!.game.world.unitById(id)!.ability!.active, unitId)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => {
      const mesh = window.RWW!.game.entities.object.getObjectByName('ability:shieldWall:0') as
        | { count?: number }
        | undefined;
      return mesh?.count ?? 0;
    }))
    .toBe(1);

  await page.keyboard.press('KeyX');
  await expect.poll(() => page.evaluate((id) => window.RWW!.game.world.unitById(id)!.ability!.active, unitId)).toBe(false);
  await expect(ability).toContainText(/cooldown/i);
});
