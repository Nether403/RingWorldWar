import { expect, test } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?scenarioDriver=1&quality=low');
  await page.waitForFunction(() => Boolean((window as unknown as { RWW?: { testDriver?: unknown } }).RWW?.testDriver));
});

test('[hud-minimap-pair-state] exposes friendly Alignment, pair index, outline, ARIA, and narrow layout state', async ({ page }) => {
  await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const pair = rww.game.world.spinalPairs.find((candidate: any) => candidate.id === 'standard-axis');
    for (const id of pair.members) {
      const node = rww.game.world.structureById(id);
      node.faction = 0;
      node.capture = -1;
    }
    rww.game.world.recomputeCommandCaps();
    rww.game.selection.clear();
    rww.game.selection.add(pair.members[0]);
    rww.game.hud.invalidate();
    rww.testDriver.presentFrame(0, 1);
  });

  const alignment = page.locator('[data-resource="alignment"]');
  await expect(alignment).toContainText('ALIGN 1/2');
  await expect(alignment).toHaveAttribute('aria-label', 'Alignment: 1 of 2 Spinal pairs controlled');
  await expect(page.locator('.rww-sel [data-spinal-pair="standard-axis"]')).toHaveAttribute('data-mate-state', 'COMPACT');
  await expect(page.locator('.rww-sel [data-spinal-pair="standard-axis"]')).toHaveAttribute('data-alignment-state', 'ACTIVE');
  const minimap = page.locator('.rww-map canvas');
  await expect(minimap).toHaveAttribute('data-declared-pair-count', '2');
  await expect(minimap).toHaveAttribute('data-friendly-aligned-pair-count', '1');
  await expect(minimap).toHaveAttribute('data-visible-aligned-pair-count', '1');
  await expect(minimap).toHaveAttribute('data-visible-pair-indices', /(^|,)1(,|$)/);
  await expect(minimap).toHaveAttribute('data-outlined-pair-indices', /(^|,)1(,|$)/);
  await expect(minimap).toHaveAttribute('aria-label', /Friendly Alignment: 1 of 2 Spinal pairs controlled/);

  await page.setViewportSize({ width: 500, height: 480 });
  const bounds = await page.evaluate(() => ({
    top: document.querySelector('.rww-top')!.getBoundingClientRect().toJSON(),
    map: document.querySelector('.rww-map')!.getBoundingClientRect().toJSON(),
  }));
  expect(bounds.top.x).toBeGreaterThanOrEqual(0);
  expect(bounds.top.x + bounds.top.width).toBeLessThanOrEqual(500);
  expect(bounds.map.x).toBeGreaterThanOrEqual(0);
  expect(bounds.map.x + bounds.map.width).toBeLessThanOrEqual(500);
});

test('[alignment-accessible-events] presents neutralization and Alignment changes relative to the player', async ({ page }) => {
  await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    rww.game.hud.consumePresentation([
      { kind: 'nodeNeutralized', id: 901, s: 0, z: 0, h: 0, faction: 0, scale: 1, entityKind: 'spinalNode' },
      { kind: 'alignmentStarted', id: 902, s: 0, z: 0, h: 0, faction: 0, scale: 1, entityKind: 'spinalNode', pairId: 'standard-axis' },
      { kind: 'alignmentBroken', id: 903, s: 0, z: 0, h: 0, faction: 1, scale: 1, entityKind: 'spinalNode', pairId: 'standard-rim' },
    ]);
  });

  const events = page.locator('.rww-event-item');
  await expect(events).toHaveCount(3);
  await expect(events.nth(0)).toHaveText('HOSTILE SPINAL ALIGNMENT BROKEN');
  await expect(events.nth(1)).toHaveText('SPINAL ALIGNMENT ESTABLISHED');
  await expect(events.nth(2)).toHaveText('FRIENDLY SPINAL NODE NEUTRALIZED');
  await expect(page.locator('.rww-event-rail')).toHaveAttribute('aria-label', 'Recent battlefield events');
});

test('[hidden-mate-no-leak] keeps an unseen hostile mate and hostile Alignment out of HUD, minimap, and ARIA', async ({ page }) => {
  await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const pair = rww.game.world.spinalPairs.find((candidate: any) => candidate.id === 'standard-axis');
    for (const id of pair.members) {
      const node = rww.game.world.structureById(id);
      node.faction = 1;
      node.capture = 1;
    }
    const visibleNode = rww.game.world.structureById(pair.members[0]);
    rww.game.world.spawnStructure(0, 'radarMast', visibleNode.s + 40, visibleNode.z, 1);
    rww.game.world.recomputeCommandCaps();
    rww.game.selection.clear();
    rww.game.selection.add(visibleNode.id);
    rww.game.hud.invalidate();
    rww.testDriver.presentFrame(0, 2);
  });

  const detail = page.locator('.rww-sel [data-spinal-pair="standard-axis"]');
  await expect(detail).toHaveAttribute('data-mate-state', 'UNKNOWN');
  await expect(detail).toHaveAttribute('data-alignment-state', 'BROKEN');
  await expect(detail).not.toContainText('MATE CHOIR');
  await expect(detail).not.toContainText('ALIGNMENT ACTIVE');
  const minimap = page.locator('.rww-map canvas');
  await expect(minimap).toHaveAttribute('data-friendly-aligned-pair-count', '0');
  await expect(minimap).toHaveAttribute('data-visible-aligned-pair-count', '0');
  await expect(minimap).toHaveAttribute('data-outlined-pair-indices', '');
  await expect(minimap).toHaveAttribute('aria-label', /Friendly Alignment: 0 of 2 Spinal pairs controlled/);
  await expect(minimap).not.toHaveAttribute('aria-label', /hostile|enemy/i);
});

test('[directional-overlay-canvas-state] restores pair-label drawing after artillery guidance', async ({ page }) => {
  const result = await page.evaluate(() => {
    const rww = (window as unknown as { RWW: any }).RWW;
    const pair = rww.game.world.spinalPairs.find((candidate: any) => candidate.id === 'standard-axis');
    for (const id of pair.members) {
      const node = rww.game.world.structureById(id);
      node.faction = 0;
      node.capture = -1;
    }
    const longbow = rww.game.world.spawnUnit(0, 'longbow', 0, 0);
    longbow.ability.active = true;
    longbow.ability.transitionTimer = 0;
    rww.game.world.recomputeCommandCaps();
    rww.game.selection.clear();
    rww.game.selection.add(longbow.id);
    rww.game.hud.invalidate();
    rww.testDriver.presentFrame(0, 3);
    const map = document.querySelector<HTMLCanvasElement>('.rww-map canvas')!;
    const context = (rww.game.hud as { mapCtx: CanvasRenderingContext2D }).mapCtx;
    const overlayBaseline = context.textBaseline;

    rww.game.selection.clear();
    rww.game.selection.add(pair.members[0]);
    rww.game.hud.invalidate();
    rww.testDriver.presentFrame(0, 3.1);
    return {
      overlay: map.dataset.artilleryOverlay ?? null,
      overlayBaseline,
      pairBaseline: context.textBaseline,
      visiblePairs: map.dataset.visiblePairIndices,
      outlinedPairs: map.dataset.outlinedPairIndices,
      aria: map.getAttribute('aria-label'),
    };
  });

  expect(result.overlay).toBe(null);
  expect(result.overlayBaseline).toBe('alphabetic');
  expect(result.pairBaseline).toBe('alphabetic');
  expect(result.visiblePairs).toMatch(/(^|,)1(,|$)/);
  expect(result.outlinedPairs).toMatch(/(^|,)1(,|$)/);
  expect(result.aria).toMatch(/Friendly Alignment: 1 of 2 Spinal pairs controlled/);
});
