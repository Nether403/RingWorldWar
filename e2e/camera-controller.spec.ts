import { expect, test } from 'playwright/test';

test('owns direct camera input, restores tactical focus, and resizes projection', async ({ page }) => {
  await page.goto('/?seed=20260731&quality=low&scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));

  const initial = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const unit = rww.game.world.spawnUnit(0, 'vanguard', 2 * Math.PI * 3600 + 12, 25);
    rww.game.selection.clear();
    rww.game.selection.add(unit.id);
    rww.rig.setView(400, -50, 0.35, 420);
    if (!rww.game.enterDirectControl()) throw new Error('Direct camera did not enter');
    return {
      unitId: unit.id,
      mode: rww.cameraController.mode,
      yaw: rww.rig.yaw,
      targetDistance: rww.rig.targetDistance,
    };
  });

  expect(initial.mode).toBe('direct');
  expect(initial.targetDistance).toBe(68);
  await page.mouse.wheel(0, 600);
  await page.keyboard.down('KeyQ');
  await page.evaluate(() => (window as unknown as { RWW: any }).RWW.testDriver.presentFrame(1 / 30, 1));
  await page.keyboard.up('KeyQ');
  expect(await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    return { yaw: rww.rig.yaw, targetDistance: rww.rig.targetDistance };
  })).toEqual({ yaw: initial.yaw, targetDistance: 68 });

  const restored = await page.evaluate((unitId) => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const unit = rww.game.world.unitById(unitId)!;
    rww.game.exitDirectControl();
    return {
      mode: rww.cameraController.mode,
      focusS: rww.rig.s,
      focusZ: rww.rig.z,
      targetDistance: rww.rig.targetDistance,
      unitS: unit.s,
      unitZ: unit.z,
    };
  }, initial.unitId);
  expect(restored.mode).toBe('tactical');
  expect(restored.focusS).toBeCloseTo(restored.unitS);
  expect(restored.focusZ).toBe(restored.unitZ);
  expect(restored.targetDistance).toBe(420);

  await page.setViewportSize({ width: 900, height: 600 });
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { RWW: any }).RWW.rig.camera.aspect)).toBeCloseTo(1.5, 5);
});
