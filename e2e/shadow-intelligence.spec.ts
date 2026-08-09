import { expect, test } from 'playwright/test';

test('[shadow-intelligence-hud] exposes timing and reduced strategic contacts at 1280x720 Low', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?quality=low&scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const contacts = await page.evaluate(async () => {
    const shadowPath = '/src/core/shadow.ts';
    const { panelPhaseAt } = await import(/* @vite-ignore */ shadowPath);
    const rww = (window as unknown as { RWW: any }).RWW;
    const world = rww.game.world;
    const hostile = world.structures.filter((structure: any) => structure.faction === 1);
    for (const structure of hostile) structure.alive = false;
    const bastion = world.spawnStructure(1, 'bastion', 5_000, 900, 1);
    const silo = world.spawnStructure(1, 'silo', 6_000, -900, 1);
    world.spawnStructure(1, 'extractor', 7_000, 0, 1);
    const shadowS = panelPhaseAt(world.time) / (Math.PI * 2) * (Math.PI * 2 * 3_600);
    rww.rig.setFocus(shadowS, 0);
    rww.testDriver.presentFrame(0, 4);
    return {
      ids: [bastion.id, silo.id],
      exactVisibility: [
        world.isEntityVisible(0, bastion.id),
        world.isEntityVisible(0, silo.id),
      ],
    };
  });

  const map = page.locator('.rww-map canvas');
  await expect(page.locator('[data-resource="shadow"]')).toContainText(/DEEP SHADOW/i);
  await expect(map).toHaveAttribute('data-strategic-contact-count', '2');
  await expect(map).toHaveAttribute('data-strategic-contact-categories', 'bastion,launch-site');
  await expect(map).toHaveAttribute('aria-label', /Deep shadow/i);
  await expect(map).toHaveAttribute('aria-label', /2 strategic contacts: 1 Bastion, 1 launch site/i);
  await expect(page.locator('.rww-sensor-lbl')).toHaveText('SENSOR · 1 BASTION, 1 LAUNCH SITE');
  await expect(page.locator('.rww-map-legend')).toContainText('strategic signal');
  const layout = await page.evaluate(() => ({
    top: document.querySelector('.rww-top')!.getBoundingClientRect().toJSON(),
    map: document.querySelector('.rww-map')!.getBoundingClientRect().toJSON(),
  }));
  expect(layout.top.x).toBeGreaterThanOrEqual(0);
  expect(layout.top.x + layout.top.width).toBeLessThanOrEqual(1280);
  expect(layout.map.x).toBeGreaterThanOrEqual(0);
  expect(layout.map.y + layout.map.height).toBeLessThanOrEqual(720);
  expect(contacts.exactVisibility).toEqual([false, false]);
  expect(errors).toEqual([]);
});

test('[global-shadow-launch-production] carries a distant night launch through Game and Effects only', async ({ page }) => {
  await page.goto('/?quality=low&scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const result = await page.evaluate(async () => {
    const shadowPath = '/src/core/shadow.ts';
    const { panelPhaseAt } = await import(/* @vite-ignore */ shadowPath);
    const rww = (window as unknown as { RWW: any }).RWW;
    const { game, rig } = rww;
    const circumference = Math.PI * 2 * 3_600;
    const shadowS = panelPhaseAt(game.world.time) / (Math.PI * 2) * circumference;
    const dayS = (shadowS + circumference / 10) % circumference;
    rig.setFocus((shadowS + circumference * 0.5) % circumference, 0);
    const event = (id: number, s: number) => ({
      kind: 'weaponFired', id, s, z: 0, h: 12, faction: 1, scale: 1, weapon: 'batteryGun',
    });
    game.world.events.push(event(90_001, shadowS), event(90_002, dayS));
    game.stepSimulationExactlyOnce();
    const pending = (game as any).presentationEvents.map((item: any) => item.id);
    const before = (game.effects as any).puffHead;
    rww.testDriver.presentFrame(0, 5);
    return {
      pending,
      puffsAdded: (game.effects as any).puffHead - before,
      nightHidden: !game.world.isVisible(0, shadowS, 0),
      dayHidden: !game.world.isVisible(0, dayS, 0),
    };
  });

  expect(result.nightHidden).toBe(true);
  expect(result.dayHidden).toBe(true);
  expect(result.pending).toContain(90_001);
  expect(result.pending).not.toContain(90_002);
  expect(result.puffsAdded).toBeGreaterThan(0);
});
