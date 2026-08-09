import { expect, test } from 'playwright/test';

test('[whole-ring-strategic-view] isolates tactical authority and presents the live annulus at 1280x720 Low', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?quality=low&scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const initial = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const world = rww.game.world;
    for (const structure of world.structures.filter((item: any) => item.faction === 1)) structure.alive = false;
    const bastion = world.spawnStructure(1, 'bastion', 5_000, 900, 1);
    world.spawnStructure(1, 'silo', 6_000, -900, 1);
    world.spawnStructure(1, 'extractor', 7_000, 0, 1);
    world.spawnStructure(0, 'bastion', 8_000, 0, 1);
    const selected = world.units.find((unit: any) => unit.faction === 0)!;
    rww.game.selection.clear();
    rww.game.selection.add(selected.id);
    rww.rig.setView(420, -80, 0.35, 460);
    rww.testDriver.presentFrame(0, 1);
    return {
      selectedId: selected.id,
      order: { ...selected.order },
      camera: { s: rww.rig.s, z: rww.rig.z, yaw: rww.rig.yaw, distance: rww.rig.distance },
      bastionVisible: world.isEntityVisible(0, bastion.id),
      tick: world.tick,
    };
  });

  expect(initial.bastionVisible).toBe(false);
  await page.keyboard.press('KeyM');
  await page.evaluate(() => (window as unknown as { RWW: any }).RWW.testDriver.presentFrame(0, 1.5));
  await expect(page.locator('.rww-mode')).toHaveText('Whole-ring strategic view');
  await expect(page.locator('.rww-strategic-panel')).toBeVisible();
  await expect(page.locator('.rww-strategic-panel')).toContainText(/antispinward/i);
  await expect(page.locator('.rww-strategic-panel')).toContainText(/spinward/i);
  await expect(page.locator('.rww-strategic-panel')).toContainText(/edges join/i);
  await expect(page.locator('.rww-strategic-panel')).toContainText(/2 strategic contacts: 1 Bastion, 1 launch site/i);
  await expect(page.locator('.rww-strategic-panel')).toContainText(/friendly strategic landmarks/i);
  await expect(page.locator('.rww-strategic-legend')).toContainText('Solid = friendly');
  await expect(page.locator('.rww-strategic-legend')).toContainText('Outline = hostile');
  await expect(page.locator('.rww-strategic-legend')).toContainText('Bastion');
  await expect(page.locator('.rww-strategic-legend')).toContainText('launch site');
  await expect(page.locator('.rww-strategic-legend')).toContainText('active Node');
  await expect(page.locator('.rww-strategic-legend')).toContainText('construction');
  await expect(page.locator('.rww-strategic-panel')).toContainText(/simulation live/i);
  await expect(page.locator('.rww-view-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.rww-event-rail')).toBeHidden();
  await expect(page.locator('.rww-event-rail')).toHaveAttribute('aria-hidden', 'true');

  const isolated = await page.evaluate((state) => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const selected = rww.game.world.unitById(state.selectedId)!;
    rww.game.issueOrder(selected.s + 500, selected.z, false);
    rww.game.selectAllCombat();
    rww.game.presentationEvents.push(
      { kind: 'unitComplete', id: 90_101, s: 1_200, z: 0, h: 0, faction: 1, scale: 1, entityKind: 'needle' },
      { kind: 'alignmentStarted', id: 90_102, s: 1_300, z: 0, h: 0, faction: 1, scale: 1 },
    );
    rww.testDriver.renderFrame(1 / 15, 2);
    return {
      mode: rww.cameraController.mode,
      capabilities: rww.cameraController.capabilities,
      selection: [...rww.game.selection],
      order: selected.order,
      tacticalLayer: rww.rig.camera.layers.isEnabled(0),
      strategicLayer: rww.rig.camera.layers.isEnabled(2),
      annulus: rww.strategicAnnulus.snapshot,
      annulusVisible: rww.strategicAnnulus.object.visible,
      annulusChildren: rww.strategicAnnulus.object.children.length,
      drawCalls: rww.renderer.drawCalls,
      tick: rww.game.world.tick,
      eventText: document.querySelector('.rww-event-rail')?.textContent ?? '',
      eventHidden: (document.querySelector('.rww-event-rail') as HTMLElement).hidden,
      camera: { s: rww.rig.s, z: rww.rig.z, yaw: rww.rig.yaw, distance: rww.rig.distance },
    };
  }, initial);
  expect(isolated.mode).toBe('whole-ring');
  expect(isolated.capabilities).toEqual({ pan: false, zoom: false, rotate: false, directMovement: false });
  expect(isolated.selection).toEqual([initial.selectedId]);
  expect(isolated.order).toEqual(initial.order);
  expect(isolated.tacticalLayer).toBe(false);
  expect(isolated.strategicLayer).toBe(true);
  expect(isolated.annulus.shadowPanelCount).toBe(5);
  expect(isolated.annulus.hostileContactCount).toBe(2);
  expect(isolated.annulus.hostileCategories).toEqual(['bastion', 'launch-site']);
  expect(isolated.annulus.friendlyLandmarkCount).toBeGreaterThan(0);
  expect(isolated.annulus.renderables).toBeLessThanOrEqual(12);
  expect(isolated.annulusVisible).toBe(true);
  expect(isolated.annulusChildren).toBeGreaterThan(0);
  expect(isolated.drawCalls).toBeGreaterThan(0);
  expect(isolated.tick).toBeGreaterThan(initial.tick);
  expect(isolated.eventText).not.toContain('HOSTILE NEEDLE READY');
  expect(isolated.eventText).not.toContain('HOSTILE SPINAL ALIGNMENT ESTABLISHED');
  expect(isolated.eventHidden).toBe(true);
  expect(isolated.camera).toEqual(initial.camera);

  const layout = await page.locator('.rww-strategic-panel').evaluate((element) => element.getBoundingClientRect().toJSON());
  expect(layout.x).toBeGreaterThanOrEqual(0);
  expect(layout.y).toBeGreaterThanOrEqual(0);
  expect(layout.x + layout.width).toBeLessThanOrEqual(1280);
  expect(layout.y + layout.height).toBeLessThanOrEqual(720);

  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as { RWW: any }).RWW.testDriver.presentFrame(0, 2.5));
  await expect(page.locator('.rww-mode')).toHaveText('Tactical command');
  await expect(page.locator('.rww-strategic-panel')).toBeHidden();
  const restored = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    return {
      mode: rww.cameraController.mode,
      selection: [...rww.game.selection],
      tacticalLayer: rww.rig.camera.layers.isEnabled(0),
      strategicLayer: rww.rig.camera.layers.isEnabled(2),
      camera: { s: rww.rig.s, z: rww.rig.z, yaw: rww.rig.yaw, distance: rww.rig.distance },
      menuOpen: rww.menu.isOpen,
    };
  });
  expect(restored.mode).toBe('tactical');
  expect(restored.selection).toEqual([initial.selectedId]);
  expect(restored.tacticalLayer).toBe(true);
  expect(restored.strategicLayer).toBe(false);
  expect(restored.camera).toEqual(initial.camera);
  expect(restored.menuOpen).toBe(false);
  expect(errors).toEqual([]);
});
