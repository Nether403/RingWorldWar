import { expect, test, type Page } from 'playwright/test';

test('launches the authored First Contact runtime scenario through the production route', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1_280, height: 720 });
  await page.goto('/?menu=0&scenario=first-contact&quality=low');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: unknown }).RWW));

  const mission = page.locator('.rww-mission');
  await expect(mission).toBeVisible();
  await expect(mission).toHaveAttribute('data-mission-id', 'first-contact');
  await expect(mission).toHaveAttribute('data-objective-id', 'select-engineer');
  await expect(mission).toContainText('Wake the construction crew');

  const state = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const game = rww.game;
    return {
      hasScenarioDriver: 'testDriver' in rww,
      bindings: [...game.scenarioBindings.entries()],
      units: game.world.units.map((unit: any) => ({ faction: unit.faction, kind: unit.kind })),
      structures: game.world.structures.map((structure: any) => ({
        faction: structure.faction,
        kind: structure.kind,
      })),
      deposits: game.world.deposits.length,
      aiEnabled: game.isAiEnabled,
      mission: game.missionHudModel,
      diagnostics: rww.probe(),
      openingGuidanceCount: Number(game.markers.object.userData.openingGuidanceCount ?? 0),
      openingDepositCount: Number(game.markers.object.userData.openingDepositCount ?? 0),
      selected: game.selection.size,
      playerEngineers: game.world.units
        .filter((unit: any) => unit.faction === 0 && unit.kind === 'engineer')
        .map((unit: any) => ({ id: unit.id, s: unit.s, z: unit.z })),
    };
  });

  expect(state.hasScenarioDriver).toBe(false);
  expect(state.bindings).toHaveLength(2);
  expect(Object.fromEntries(state.bindings)).toMatchObject({
    'tutorial-node': expect.any(Number),
    'artillery-target': expect.any(Number),
  });
  expect(state.units).toHaveLength(8);
  expect(state.units.filter((unit: { kind: string }) => unit.kind === 'engineer')).toHaveLength(6);
  expect(state.units.filter((unit: { kind: string }) => unit.kind === 'vanguard')).toHaveLength(2);
  expect(state.structures).toHaveLength(7);
  expect(state.structures.filter((structure: { kind: string }) => structure.kind === 'bastion')).toHaveLength(2);
  expect(state.structures.filter((structure: { kind: string }) => structure.kind === 'spinalNode')).toHaveLength(4);
  expect(state.deposits).toBe(6);
  expect(state.aiEnabled).toBe(false);
  expect(state.selected).toBe(0);
  expect(state.openingGuidanceCount).toBe(4);
  expect(state.openingDepositCount).toBe(3);
  expect(state.mission).toMatchObject({
    missionId: 'first-contact',
    objectiveId: 'select-engineer',
    status: 'active',
  });
  expect(state.diagnostics).toMatchObject({
    runtimeScenario: 'first-contact',
    scenarioBindings: 2,
    mission: 'first-contact',
    aiEnabled: false,
    units: 8,
    structures: 7,
  });

  const engineerPoints = await Promise.all(state.playerEngineers.map((engineer: { s: number; z: number }) =>
    screenPoint(page, engineer.s, engineer.z)));
  for (const point of engineerPoints) {
    expect(point.x).toBeGreaterThan(150);
    expect(point.x).toBeLessThan(1_130);
    expect(point.y).toBeGreaterThan(180);
    expect(point.y).toBeLessThan(620);
  }
  expect(Math.max(...engineerPoints.map((point) => point.x)) - Math.min(...engineerPoints.map((point) => point.x)))
    .toBeGreaterThan(35);

  await page.mouse.click(engineerPoints[1]!.x, engineerPoints[1]!.y);
  await expect(mission).toHaveAttribute('data-objective-id', 'build-power');
  await expect.poll(() => page.evaluate(() =>
    Number((window as unknown as { RWW: any }).RWW.game.markers.object.userData.openingGuidanceCount ?? 0)))
    .toBe(0);
  expect(consoleErrors).toEqual([]);
});

async function screenPoint(page: Page, s: number, z: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ s, z }) => {
    const { anchor, game, rig, renderer } = (window as unknown as { RWW: any }).RWW;
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
