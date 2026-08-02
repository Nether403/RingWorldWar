import { expect, test, type Page } from 'playwright/test';

test('boots and supports the Gate 1 command loop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/?seed=20260731&quality=low');
  await page.waitForFunction(() => Boolean(window.RWW));

  const unitId = await page.evaluate(() => {
    const game = window.RWW!.game;
    const unit = game.world.spawnUnit(0, 'vanguard', 60, 0);
    window.RWW!.rig.setFocus(unit.s, unit.z);
    return unit.id;
  });
  await page.waitForTimeout(500);
  const unitPoint = await screenPoint(page, 60, 0);
  await page.mouse.click(unitPoint.x, unitPoint.y);
  await expect.poll(() => page.evaluate((id) => window.RWW!.game.selection.has(id), unitId)).toBe(true);
  const movePoint = await screenPoint(page, 220, 0);
  await page.mouse.click(movePoint.x, movePoint.y, { button: 'right' });
  await page.waitForFunction(
    ({ id }) => window.RWW!.game.world.unitById(id)!.s > 62,
    { id: unitId },
  );
  const orderBeforeRotate = await page.evaluate((id) => ({ ...window.RWW!.game.world.unitById(id)!.order }), unitId);
  const canvas = page.locator('#app canvas');
  const canvasBox = await canvas.boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.move(canvasBox!.width * 0.5, canvasBox!.height * 0.5);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(canvasBox!.width * 0.6, canvasBox!.height * 0.5, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Shift');
  expect(await page.evaluate((id) => window.RWW!.game.world.unitById(id)!.order, unitId)).toEqual(orderBeforeRotate);

  await page.keyboard.down('Alt');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('Alt');
  await page.evaluate(() => window.RWW!.game.selection.clear());
  await page.keyboard.press('Digit1');
  expect(await page.evaluate((id) => window.RWW!.game.selection.has(id), unitId)).toBe(true);

  await page.keyboard.press('KeyV');
  await expect.poll(() => page.evaluate(() => window.RWW!.game.directControlActive)).toBe(true);
  const directStart = await page.evaluate((id) => window.RWW!.game.world.unitById(id)!.s, unitId);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  await expect
    .poll(() => page.evaluate((id) => window.RWW!.game.world.unitById(id)!.s, unitId))
    .not.toBe(directStart);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.RWW!.game.directControlActive)).toBe(false);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');

  const artillery = await page.evaluate(() => {
    const game = window.RWW!.game;
    game.setAiEnabled(false);
    const battery = game.world.spawnStructure(0, 'rocketBattery', 120, 0, 1);
    const core = game.world.spawnStructure(0, 'fusionCore', 180, 300, 1);
    const radar = game.world.spawnStructure(0, 'radarMast', 1_000, 0, 1);
    for (const structure of [battery, core, radar]) structure.hp = structure.maxHp = 1_000_000;
    const target = game.world.spawnUnit(1, 'vanguard', 1_000, 0);
    const engineer = game.world.spawnUnit(0, 'engineer', 90, 60);
    game.selection.clear();
    window.RWW!.rig.setFocus(battery.s, battery.z);
    game.selection.add(engineer.id);
    game.setControlGroup(2);
    game.selection.clear();
    return { batteryId: battery.id, targetId: target.id, targetS: target.s };
  });
  await page.waitForTimeout(500);
  const batteryPoint = await screenPoint(page, 120, 0);
  await page.mouse.click(batteryPoint.x, batteryPoint.y);
  await expect
    .poll(() => page.evaluate((id) => window.RWW!.game.selection.has(id), artillery.batteryId))
    .toBe(true);
  await expect(page.getByRole('button', { name: /Target rocket/i })).toBeVisible();
  await page.getByRole('button', { name: /Target rocket/i }).click();
  await expect.poll(() => page.evaluate(() => window.RWW!.game.artilleryTargeting)).toBe(true);
  await page.keyboard.press('Digit2');
  await page.keyboard.press('KeyS');
  expect(await page.evaluate(() => window.RWW!.game.artilleryTargeting)).toBe(false);
  expect(await page.evaluate(() => window.RWW!.game.hud.placing)).toBe('solarArray');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate((id) => {
    const game = window.RWW!.game;
    game.selection.clear();
    game.selection.add(id);
  }, artillery.batteryId);
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: /Target rocket/i }).click();
  await page.evaluate((targetS) => window.RWW!.rig.setFocus(targetS, 0), artillery.targetS);
  await page.waitForTimeout(200);
  const targetPoint = await screenPoint(page, artillery.targetS, 0);
  await page.mouse.move(targetPoint.x, targetPoint.y);
  await page.waitForTimeout(150);
  await page.mouse.click(targetPoint.x, targetPoint.y);
  expect(
    await page.evaluate(() => window.RWW!.game.world.projectiles.some((projectile) => projectile.ballistic)),
  ).toBe(true);

  await page.setViewportSize({ width: 700, height: 600 });
  const minimap = await page.locator('.rww-map').boundingBox();
  const commands = await page.locator('.rww-cmds').boundingBox();
  expect(minimap).not.toBeNull();
  expect(minimap!.x).toBeGreaterThanOrEqual(0);
  expect(minimap!.x + minimap!.width).toBeLessThanOrEqual(700);
  expect(commands!.y + commands!.height).toBeLessThanOrEqual(minimap!.y);
  expect(errors).toEqual([]);
});

test('minimap issues wrapped move orders and fires a preview-only artillery shot when its blocker clears', async ({ page }) => {
  await page.goto('/?seed=20260731&quality=low&scenarioDriver=1');
  await page.waitForFunction(() => Boolean(window.RWW));
  const ids = await page.evaluate(() => {
    const game = window.RWW!.game;
    game.setAiEnabled(false);
    const unit = game.world.spawnUnit(0, 'vanguard', 80, 0);
    const battery = game.world.spawnStructure(0, 'rocketBattery', 2 * Math.PI * 3600 - 220, 0, 1);
    game.world.spawnStructure(0, 'fusionCore', 200, 300, 1);
    game.world.spawnStructure(0, 'radarMast', 80, 0, 1);
    game.selection.clear();
    game.selection.add(unit.id);
    return { unitId: unit.id, batteryId: battery.id };
  });
  const minimap = page.locator('.rww-map canvas');
  const box = await minimap.boundingBox();
  expect(box).not.toBeNull();

  await page.evaluate(() => {
    window.RWW!.rig.setFocus(0, 0);
    (window.RWW as any).testDriver.renderFrame(0, 0.4);
  });
  await expect(minimap).toHaveAttribute('data-camera-wrap-copies', '2');

  await page.mouse.click(box!.x + box!.width * 0.25, box!.y + box!.height / 2);
  expect(await page.evaluate(() => window.RWW!.rig.s)).toBeCloseTo(Math.PI * 1_800, -1);
  await page.evaluate(() => (window.RWW as any).testDriver.renderFrame(0, 0.5));
  await minimap.focus();
  const keyboardCameraStart = await page.evaluate(() => window.RWW!.rig.s);
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.RWW!.rig.s)).toBeGreaterThan(keyboardCameraStart);

  await page.mouse.click(box!.x + 3, box!.y + box!.height / 2, { button: 'right' });
  await expect.poll(() => page.evaluate((id) => window.RWW!.game.world.unitById(id)!.order.kind, ids.unitId))
    .toBe('move');
  const seamOrder = await page.evaluate((id) => window.RWW!.game.world.unitById(id)!.order.s, ids.unitId);
  expect(seamOrder).toBeLessThan(300);

  await page.keyboard.down('Control');
  await page.mouse.click(box!.x + 8, box!.y + box!.height / 2, { button: 'right' });
  await page.keyboard.up('Control');
  expect(await page.evaluate((id) => window.RWW!.game.world.unitById(id)!.order.kind, ids.unitId))
    .toBe('attackMove');

  await page.evaluate(({ batteryId }) => {
    const game = window.RWW!.game;
    game.selection.clear();
    game.selection.add(batteryId);
    game.world.structureById(batteryId)!.cd[0] = 3.2;
    game.beginArtilleryTarget(batteryId, 'batteryGun');
  }, ids);
  await page.mouse.move(box!.x + 4, box!.y + box!.height / 2);
  await page.evaluate(() => (window.RWW as any).testDriver.renderFrame(0, 1));
  await expect(minimap).toHaveAttribute('data-target-sensor-coverage', 'true');
  await expect(minimap).toHaveAttribute('data-target-exact-los', 'true');
  await expect(page.locator('.rww-target-status')).toContainText('PREVIEW ONLY');
  await expect(page.locator('.rww-target-status')).toContainText('RELOADING — 3.2s');
  await expect.poll(() => page.evaluate(() => window.RWW!.game.trajectoryPreview?.length ?? 0)).toBeGreaterThan(2);

  await page.mouse.click(box!.x + 4, box!.y + box!.height / 2);
  await expect(page.locator('.rww-alert')).toContainText('RELOADING — 3.2s');
  expect(await page.evaluate(() => window.RWW!.game.artilleryTargeting)).toBe(true);

  await page.evaluate(({ batteryId }) => {
    window.RWW!.game.world.structureById(batteryId)!.cd[0] = 0;
  }, ids);
  await page.mouse.move(box!.x + 5, box!.y + box!.height / 2);
  await page.evaluate(() => (window.RWW as any).testDriver.renderFrame(0.11, 1.1));
  await expect(page.locator('.rww-target-status')).toContainText('READY TO FIRE');
  await page.mouse.click(box!.x + 5, box!.y + box!.height / 2);
  await expect.poll(() => page.evaluate(() => window.RWW!.game.world.projectiles.some((item) => item.ballistic)))
    .toBe(true);

  await page.evaluate(({ batteryId }) => window.RWW!.game.beginArtilleryTarget(batteryId, 'batteryGun'), ids);
  await page.mouse.click(box!.x + 5, box!.y + box!.height / 2, { button: 'right' });
  expect(await page.evaluate(() => window.RWW!.game.artilleryTargeting)).toBe(false);
});

test('artillery preview stays target-keyed and refreshes stationary blockers without repeated solves', async ({ page }) => {
  await page.goto('/?seed=20260731&quality=low&scenarioDriver=1');
  await page.waitForFunction(() => Boolean(window.RWW));
  const ids = await page.evaluate(() => {
    const game = window.RWW!.game;
    game.setAiEnabled(false);
    const battery = game.world.spawnStructure(0, 'rocketBattery', 0, 0, 1);
    game.world.spawnStructure(0, 'fusionCore', 0, 300, 1);
    game.world.spawnStructure(0, 'radarMast', 500, 0, 1);
    const authority = { nominal: true, exactLineOfSight: true };
    (window as any).__artilleryAuthority = authority;
    (game.world as any).sensorStatusAt = () => ({ ...authority });
    game.beginArtilleryTarget(battery.id, 'batteryGun');
    game.updateCursor(1_000, 0);
    (window.RWW as any).testDriver.renderFrame(0.11, 1);
    return { batteryId: battery.id };
  });
  const status = page.locator('.rww-target-status');
  await expect(status).toContainText('READY TO FIRE');
  const firstTarget = await page.evaluate(() => ({
    result: window.RWW!.game.artilleryResult,
    previewLength: window.RWW!.game.trajectoryPreview?.length ?? 0,
    evaluations: window.RWW!.game.world.ballisticWork.trajectoryEvaluations,
  }));
  expect(firstTarget.result).toMatchObject({ targetS: 1_000, targetZ: 0 });
  expect(firstTarget.previewLength).toBeGreaterThan(2);

  const pending = await page.evaluate(() => {
    const game = window.RWW!.game;
    game.updateCursor(1_100, 0);
    return { result: game.artilleryResult, preview: game.trajectoryPreview };
  });
  expect(pending).toEqual({ result: null, preview: null });
  await page.evaluate(() => (window.RWW as any).testDriver.renderFrame(0.01, 1.01));
  await expect(status).toContainText('CHECKING TARGET');
  await expect(status).not.toContainText('READY TO FIRE');

  await page.evaluate(() => (window.RWW as any).testDriver.renderFrame(0.1, 1.11));
  await expect(status).toContainText('READY TO FIRE');
  const evaluations = await page.evaluate(() => window.RWW!.game.world.ballisticWork.trajectoryEvaluations);
  expect(evaluations).toBeGreaterThan(firstTarget.evaluations);

  await page.evaluate(({ batteryId }) => {
    window.RWW!.game.world.structureById(batteryId)!.cd[0] = 3.2;
    (window.RWW as any).testDriver.renderFrame(0, 1.12);
  }, ids);
  await expect(status).toContainText('RELOADING — 3.2s');

  await page.evaluate(({ batteryId }) => {
    const game = window.RWW!.game;
    game.world.structureById(batteryId)!.cd[0] = 0;
    game.world.players[0].weaponEnergyLoad = 10_000;
    (window.RWW as any).testDriver.renderFrame(0, 1.13);
  }, ids);
  await expect(status).toContainText('POWER');

  await page.evaluate(() => {
    const game = window.RWW!.game;
    game.world.players[0].weaponEnergyLoad = 0;
    (window as any).__artilleryAuthority.nominal = false;
    (window as any).__artilleryAuthority.exactLineOfSight = false;
    (window.RWW as any).testDriver.renderFrame(0, 1.14);
  });
  await expect(status).toContainText('NO SENSOR COVERAGE');
  await expect(status).toHaveClass(/blocked/);
  await expect(status).not.toHaveClass(/ready/);
  const sensorLoss = await page.evaluate(() => ({
    result: window.RWW!.game.artilleryResult,
    preview: window.RWW!.game.trajectoryPreview,
  }));
  expect(sensorLoss).toEqual({
    result: expect.objectContaining({ ok: false, reason: 'outside-sensor-range' }),
    preview: null,
  });

  await page.evaluate(() => {
    (window as any).__artilleryAuthority.nominal = true;
    (window.RWW as any).testDriver.renderFrame(0.11, 1.15);
  });
  await expect(status).toContainText('SENSOR LOS BLOCKED');
  await expect(status).not.toContainText('TERRAIN');
  await expect.poll(() => page.evaluate(() => window.RWW!.game.trajectoryPreview?.length ?? 0)).toBeGreaterThan(2);
  const restoredEvaluations = await page.evaluate(() => window.RWW!.game.world.ballisticWork.trajectoryEvaluations);
  expect(restoredEvaluations).toBeGreaterThan(evaluations);

  await page.evaluate(() => {
    (window as any).__artilleryAuthority.exactLineOfSight = true;
    (window.RWW as any).testDriver.renderFrame(0, 1.16);
  });
  await expect(status).toContainText('READY TO FIRE');
  expect(await page.evaluate(() => window.RWW!.game.world.ballisticWork.trajectoryEvaluations))
    .toBe(restoredEvaluations);

  const unchangedMutations = await page.evaluate(() => {
    const target = document.querySelector('.rww-target-status')!;
    let mutations = 0;
    const observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(target, { attributes: true, childList: true, characterData: true, subtree: true });
    const driver = (window.RWW as any).testDriver;
    driver.renderFrame(0, 1.17);
    driver.renderFrame(0, 1.18);
    driver.renderFrame(0, 1.19);
    observer.disconnect();
    return mutations;
  });
  expect(unchangedMutations).toBe(0);

  await page.evaluate(({ batteryId }) => {
    window.RWW!.game.world.structureById(batteryId)!.alive = false;
    (window.RWW as any).testDriver.renderFrame(0, 1.2);
  }, ids);
  expect(await page.evaluate(() => window.RWW!.game.artilleryTargeting)).toBe(false);
});

test('minimap semantic keys center, command, fire, and cancel without leaking shortcuts', async ({ page }) => {
  await page.goto('/?seed=20260731&quality=low&scenarioDriver=1');
  await page.waitForFunction(() => Boolean(window.RWW));
  const ids = await page.evaluate(() => {
    const game = window.RWW!.game;
    game.setAiEnabled(false);
    const unit = game.world.spawnUnit(0, 'vanguard', 80, 0);
    const battery = game.world.spawnStructure(0, 'rocketBattery', 0, 0, 1);
    game.world.spawnStructure(0, 'fusionCore', 0, 300, 1);
    game.world.spawnStructure(0, 'radarMast', 500, 0, 1);
    game.selection.add(unit.id);
    window.RWW!.rig.setFocus(1_000, 0);
    (window.RWW as any).testDriver.renderFrame(0, 1);
    return { unitId: unit.id, batteryId: battery.id };
  });
  const map = page.locator('.rww-map canvas');
  await expect(map).toHaveAttribute('role', 'application');
  await expect(map).toHaveAttribute('aria-label', /Enter.*M.*A.*Escape/i);
  await map.focus();

  await page.keyboard.press('KeyM');
  expect(await page.evaluate((id) => window.RWW!.game.world.unitById(id)!.order.kind, ids.unitId)).toBe('move');
  await page.keyboard.press('KeyA');
  expect(await page.evaluate((id) => window.RWW!.game.world.unitById(id)!.order.kind, ids.unitId)).toBe('attackMove');

  await page.evaluate(({ batteryId }) => {
    const game = window.RWW!.game;
    game.selection.clear();
    game.selection.add(batteryId);
    game.beginArtilleryTarget(batteryId, 'batteryGun');
  }, ids);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.RWW!.game.world.projectiles.some((item) => item.ballistic)))
    .toBe(true);

  await page.evaluate(({ batteryId }) => window.RWW!.game.beginArtilleryTarget(batteryId, 'batteryGun'), ids);
  await map.focus();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.RWW!.game.artilleryTargeting)).toBe(false);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
});

test('shows a bounded drag-selection rectangle only while box-selecting', async ({ page }) => {
  await page.goto('/?seed=20260731&quality=low');
  await page.waitForFunction(() => Boolean(window.RWW));
  const ids = await page.evaluate(() => {
    const game = window.RWW!.game;
    game.setAiEnabled(false);
    const first = game.world.spawnUnit(0, 'vanguard', 80, -30);
    const second = game.world.spawnUnit(0, 'wisp', 150, 30);
    window.RWW!.rig.setFocus(115, 0);
    return [first.id, second.id];
  });
  await page.waitForTimeout(250);
  const first = await screenPoint(page, 40, -80);
  const last = await screenPoint(page, 190, 80);
  const rectangle = page.locator('[data-selection-rectangle]');

  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 6 });
  await expect(rectangle).toBeVisible();
  const bounds = await rectangle.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);

  await page.mouse.up();
  await expect(rectangle).toBeHidden();
  expect(await page.evaluate((selectedIds) => selectedIds.every((id) => window.RWW!.game.selection.has(id)), ids))
    .toBe(true);

  await page.mouse.click(first.x, first.y);
  await expect(rectangle).toBeHidden();

  const canvas = page.locator('#app canvas');
  const startDrag = async (): Promise<void> => {
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(last.x, last.y, { steps: 3 });
    await expect(rectangle).toBeVisible();
  };

  await page.evaluate(() => window.RWW!.game.selection.clear());
  await startDrag();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(rectangle).toBeHidden();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await page.evaluate(() => window.RWW!.game.selection.size)).toBe(0);

  await startDrag();
  await canvas.dispatchEvent('lostpointercapture');
  await expect(rectangle).toBeHidden();
  await page.mouse.up();
  expect(await page.evaluate(() => window.RWW!.game.selection.size)).toBe(0);

  await startDrag();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(rectangle).toBeHidden();
  await page.mouse.up();
  expect(await page.evaluate(() => window.RWW!.game.selection.size)).toBe(0);

  await startDrag();
  await canvas.dispatchEvent('contextmenu');
  await expect(rectangle).toBeHidden();
  await page.mouse.up();
  expect(await page.evaluate(() => window.RWW!.game.selection.size)).toBe(0);

  await page.evaluate(() => { window.RWW!.game.hud.placing = 'solarArray'; });
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 3 });
  await expect(rectangle).toBeHidden();
  await page.mouse.up();

  await page.evaluate(() => {
    const game = window.RWW!.game;
    game.hud.placing = null;
    const battery = game.world.spawnStructure(0, 'rocketBattery', 100, 100, 1);
    game.beginArtilleryTarget(battery.id, 'batteryGun');
  });
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 3 });
  await expect(rectangle).toBeHidden();
  await page.mouse.up();

  await page.evaluate((unitId) => {
    const game = window.RWW!.game;
    game.cancelArtilleryTarget();
    game.selection.clear();
    game.selection.add(unitId);
    if (!game.enterDirectControl()) throw new Error('Could not enter direct control for drag suppression test');
  }, ids[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 3 });
  await expect(rectangle).toBeHidden();
  await page.mouse.up();
  await page.evaluate(() => window.RWW!.game.exitDirectControl());
});

async function screenPoint(page: Page, s: number, z: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ s, z }) => {
    const { anchor, game, rig, renderer } = window.RWW!;
    rig.camera.updateMatrixWorld(true);
    const point = { x: 0, y: 0, z: 0 };
    anchor.toRender(s, game.terrain.heightAt(s, z), z, point);
    const multiply = (
      value: { x: number; y: number; z: number; w: number },
      elements: number[],
    ): { x: number; y: number; z: number; w: number } => ({
      x: elements[0]! * value.x + elements[4]! * value.y + elements[8]! * value.z + elements[12]! * value.w,
      y: elements[1]! * value.x + elements[5]! * value.y + elements[9]! * value.z + elements[13]! * value.w,
      z: elements[2]! * value.x + elements[6]! * value.y + elements[10]! * value.z + elements[14]! * value.w,
      w: elements[3]! * value.x + elements[7]! * value.y + elements[11]! * value.z + elements[15]! * value.w,
    });
    const view = multiply({ ...point, w: 1 }, rig.camera.matrixWorldInverse.elements);
    const clip = multiply(view, rig.camera.projectionMatrix.elements);
    const rect = renderer.gl.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((clip.x / clip.w + 1) * 0.5) * rect.width,
      y: rect.top + ((1 - clip.y / clip.w) * 0.5) * rect.height,
    };
  }, { s, z });
}
