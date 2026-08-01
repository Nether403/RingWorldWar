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

  const artillery = await page.evaluate(() => {
    const game = window.RWW!.game;
    const battery = game.world.spawnStructure(0, 'rocketBattery', 120, 0, 1);
    game.world.spawnStructure(0, 'radarMast', 260, 0, 1);
    const target = game.world.spawnUnit(1, 'vanguard', 340, 0);
    const engineer = game.world.spawnUnit(0, 'engineer', 90, 60);
    game.selection.clear();
    window.RWW!.rig.setFocus(battery.s, battery.z);
    game.selection.add(engineer.id);
    game.setControlGroup(2);
    game.selection.clear();
    return { batteryId: battery.id, targetId: target.id };
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
  await page.evaluate((id) => {
    const game = window.RWW!.game;
    game.selection.clear();
    game.selection.add(id);
  }, artillery.batteryId);
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: /Target rocket/i }).click();
  const targetPoint = await screenPoint(page, 340, 0);
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
