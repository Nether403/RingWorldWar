import { expect, test } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?seed=20260731&quality=low&scenarioDriver=1');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));
});

test('failed direct entry preserves every tactical owner and HUD interaction', async ({ page }) => {
  const result = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const game = rww.game;
    const unit = game.world.spawnUnit(0, 'vanguard', 80, 20);
    const battery = game.world.spawnStructure(0, 'rocketBattery', 120, 0, 1);
    game.selection.clear();
    game.selection.add(unit.id);
    game.beginArtilleryTarget(battery.id, 'batteryGun');
    game.hud.placing = 'solarArray';
    unit.manualAimYaw = 0.6;
    const before = {
      selection: [...game.selection],
      placing: game.hud.placing,
      artillery: game.artilleryTargeting,
      weapon: game.artilleryWeapon,
      manualAimYaw: unit.manualAimYaw,
      directOwner: game.directUnitId,
      mode: rww.cameraController.mode,
      rigDirect: rww.rig.directMode,
      capabilities: { ...rww.cameraController.capabilities },
      focus: [rww.rig.s, rww.rig.z, rww.rig.yaw],
      alert: document.querySelector('.rww-alert')?.textContent,
    };
    const originalRequest = rww.cameraController.requestMode.bind(rww.cameraController);
    rww.cameraController.requestMode = (mode: string) => mode === 'direct'
      ? { ok: false, mode, reason: 'camera-mode-enter-failed' }
      : originalRequest(mode);
    const entered = game.enterDirectControl();
    const after = {
      selection: [...game.selection],
      placing: game.hud.placing,
      artillery: game.artilleryTargeting,
      weapon: game.artilleryWeapon,
      manualAimYaw: unit.manualAimYaw,
      directOwner: game.directUnitId,
      mode: rww.cameraController.mode,
      rigDirect: rww.rig.directMode,
      capabilities: { ...rww.cameraController.capabilities },
      focus: [rww.rig.s, rww.rig.z, rww.rig.yaw],
      alert: document.querySelector('.rww-alert')?.textContent,
    };
    return { entered, before, after };
  });

  expect(result.entered).toBe(false);
  expect(result.after).toEqual(result.before);
});

test('failed tactical exit retains direct ownership through explicit and dead-unit recovery attempts', async ({ page }) => {
  const result = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const game = rww.game;
    const unit = game.world.spawnUnit(0, 'vanguard', 90, 30);
    game.selection.clear();
    game.selection.add(unit.id);
    if (!game.enterDirectControl()) throw new Error('Direct control setup failed');
    game.updateCursor(140, 80);
    game.updateDirectControl(0, 0);
    game.hud.placing = 'solarArray';
    const before = {
      directOwner: game.directUnitId,
      manualAimYaw: unit.manualAimYaw,
      placing: game.hud.placing,
      focus: [rww.rig.s, rww.rig.z, rww.rig.yaw],
      mode: rww.cameraController.mode,
      rigDirect: rww.rig.directMode,
      capabilities: { ...rww.cameraController.capabilities },
    };
    const originalRequest = rww.cameraController.requestMode.bind(rww.cameraController);
    rww.cameraController.requestMode = (mode: string) => mode === 'tactical'
      ? { ok: false, mode, reason: 'camera-mode-exit-failed' }
      : originalRequest(mode);
    const exited = game.exitDirectControl();
    const afterExplicit = {
      directOwner: game.directUnitId,
      manualAimYaw: unit.manualAimYaw,
      placing: game.hud.placing,
      focus: [rww.rig.s, rww.rig.z, rww.rig.yaw],
      mode: rww.cameraController.mode,
      rigDirect: rww.rig.directMode,
      capabilities: { ...rww.cameraController.capabilities },
    };
    unit.alive = false;
    game.updateDirectControl(0, 0);
    rww.testDriver.presentFrame(0, 1);
    return {
      exited,
      before,
      afterExplicit,
      afterInvalidation: {
        directOwner: game.directUnitId,
        manualAimYaw: unit.manualAimYaw,
        placing: game.hud.placing,
        focus: [rww.rig.s, rww.rig.z, rww.rig.yaw],
        mode: rww.cameraController.mode,
        rigDirect: rww.rig.directMode,
        capabilities: { ...rww.cameraController.capabilities },
        hudMode: document.querySelector('.rww-mode')?.textContent,
        gameDirect: game.directControlActive,
      },
    };
  });

  expect(result.exited).toBe(false);
  expect(result.afterExplicit).toEqual(result.before);
  expect(result.afterInvalidation).toMatchObject({
    ...result.before,
    hudMode: 'Direct control',
    gameDirect: true,
  });
});
