import { expect, test } from 'playwright/test';
import type { Game } from '../src/game';
import type { Renderer } from '../src/render/renderer';

interface StartupMetrics {
  startedAt: number;
  firstPlayableAt: number | null;
  durationMilliseconds: number | null;
  shaderPrewarmMilliseconds: number | null;
}

interface LifecycleApi {
  game: Game;
  renderer: Renderer;
  testDriver: {
    stopLoop(): void;
    setAiEnabled(enabled: boolean): void;
    presentFrame(dt: number, visualTime: number): void;
  };
  startup(): StartupMetrics;
  dispose(): void;
}

test('records startup through the first playable frame', async ({ page }, testInfo) => {
  await page.goto('/?seed=611&quality=low');
  await page.waitForFunction(() => {
    const session = (window as unknown as { RWW?: LifecycleApi }).RWW;
    return Boolean(session && session.startup().firstPlayableAt !== null);
  });

  const startup = await page.evaluate(() =>
    (window as unknown as { RWW: LifecycleApi }).RWW.startup());
  await testInfo.attach('startup-metrics', {
    body: Buffer.from(JSON.stringify(startup, null, 2)),
    contentType: 'application/json',
  });
  console.log('phase4d startup evidence', JSON.stringify(startup));

  expect(startup.startedAt).toBeGreaterThanOrEqual(0);
  expect(startup.firstPlayableAt).not.toBeNull();
  expect(startup.durationMilliseconds).toBeGreaterThan(0);
  expect(startup.durationMilliseconds).toBeLessThan(15_000);
  expect(startup.shaderPrewarmMilliseconds).toBeGreaterThan(0);
});

test('tears down the complete browser session without leaving listeners or DOM owners', async ({ page }) => {
  await page.goto('/?seed=612&quality=low');
  await page.waitForFunction(() => {
    const session = (window as unknown as { RWW?: LifecycleApi }).RWW;
    return Boolean(session && session.startup().firstPlayableAt !== null);
  });

  const result = await page.evaluate(() => {
    const target = window as unknown as { RWW?: LifecycleApi };
    const session = target.RWW!;
    const canvas = session.renderer.gl.domElement;
    let resizeCalls = 0;
    const originalResize = session.renderer.resize.bind(session.renderer);
    session.renderer.resize = (...args) => {
      resizeCalls++;
      originalResize(...args);
    };

    session.dispose();
    window.dispatchEvent(new Event('resize'));

    return {
      canvasConnected: canvas.isConnected,
      sceneChildren: session.renderer.scene.children.length,
      resizeCalls,
      rwwPresent: target.RWW !== undefined,
      hudCount: document.querySelectorAll('.rww-root').length,
      settingsCount: document.querySelectorAll('.rww-settings').length,
      debugCount: document.querySelectorAll('[data-rww-debug-overlay]').length,
    };
  });

  expect(result).toEqual({
    canvasConnected: false,
    sceneChildren: 0,
    resizeCalls: 0,
    rwwPresent: false,
    hudCount: 0,
    settingsCount: 0,
    debugCount: 0,
  });
});

test('does not retain the disposed session graph', async ({ page }) => {
  await page.goto('/?seed=616&quality=low');
  await page.waitForFunction(() => {
    const session = (window as unknown as { RWW?: LifecycleApi }).RWW;
    return Boolean(session && session.startup().firstPlayableAt !== null);
  });

  await page.evaluate(() => {
    const target = window as unknown as {
      RWW?: LifecycleApi;
      rwwDisposedRefs?: Array<WeakRef<object>>;
    };
    const session = target.RWW!;
    target.rwwDisposedRefs = [
      new WeakRef(session.game),
      new WeakRef(session.renderer),
      new WeakRef(session.game.hud.root),
    ];
    session.dispose();
  });
  await page.requestGC();

  const retained = await page.evaluate(() => {
    const refs = (window as unknown as { rwwDisposedRefs: Array<WeakRef<object>> }).rwwDisposedRefs;
    const labels = ['game', 'renderer', 'hud'];
    return refs.flatMap((reference, index) => reference.deref() === undefined ? [] : [labels[index]!]);
  });
  expect(retained).toEqual([]);
});

test('keeps a BFCache-persisted page alive and tears repeated sessions down to zero owners', async ({ page }) => {
  for (let iteration = 0; iteration < 3; iteration++) {
    await page.goto(`/?seed=${620 + iteration}&quality=low`);
    await page.waitForFunction(() => {
      const session = (window as unknown as { RWW?: LifecycleApi }).RWW;
      return Boolean(session && session.startup().firstPlayableAt !== null);
    });
    const before = await page.evaluate(() => {
      const session = (window as unknown as { RWW: LifecycleApi }).RWW;
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      return {
        tick: session.game.world.tick,
        canvasCount: document.querySelectorAll('#app canvas').length,
        hudCount: document.querySelectorAll('.rww-root').length,
        settingsCount: document.querySelectorAll('.rww-settings').length,
      };
    });
    await page.waitForFunction((tick) =>
      (window as unknown as { RWW: LifecycleApi }).RWW.game.world.tick > tick, before.tick);
    expect(before).toMatchObject({ canvasCount: 1, hudCount: 1, settingsCount: 1 });

    const after = await page.evaluate(() => {
      (window as unknown as { RWW: LifecycleApi }).RWW.dispose();
      return {
        canvasCount: document.querySelectorAll('#app canvas').length,
        hudCount: document.querySelectorAll('.rww-root').length,
        settingsCount: document.querySelectorAll('.rww-settings').length,
      };
    });
    expect(after).toEqual({ canvasCount: 0, hudCount: 0, settingsCount: 0 });
  }
});

test('pauses on WebGL loss and resumes the same match after restoration', async ({ page }) => {
  await page.goto('/?seed=613&quality=low');
  await page.waitForFunction(() => {
    const session = (window as unknown as { RWW?: LifecycleApi }).RWW;
    return Boolean(session && session.startup().firstPlayableAt !== null);
  });
  const before = await page.evaluate(() => {
    const renderer = (window as unknown as { RWW: LifecycleApi }).RWW.renderer;
    return {
      tick: (window as unknown as { RWW: LifecycleApi }).RWW.game.world.tick,
      environmentUuid: renderer.scene.environment?.uuid ?? null,
    };
  });

  const supported = await page.evaluate(() => {
    const target = window as unknown as { RWW: LifecycleApi; rwwLossExtension?: WEBGL_lose_context };
    const extension = target.RWW.renderer.gl.getContext().getExtension('WEBGL_lose_context');
    if (!extension) return false;
    target.rwwLossExtension = extension;
    extension.loseContext();
    return true;
  });
  expect(supported).toBe(true);
  await expect(page.locator('[data-rww-context-recovery]')).toBeVisible();
  const pausedTick = await page.evaluate(() =>
    (window as unknown as { RWW: LifecycleApi }).RWW.game.world.tick);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() =>
    (window as unknown as { RWW: LifecycleApi }).RWW.game.world.tick)).toBe(pausedTick);

  await page.evaluate(() =>
    (window as unknown as { rwwLossExtension: WEBGL_lose_context }).rwwLossExtension.restoreContext());
  await expect(page.locator('[data-rww-context-recovery]')).toHaveCount(0);
  await page.waitForFunction((tick) =>
    (window as unknown as { RWW: LifecycleApi }).RWW.game.world.tick > tick, before.tick);

  const recovered = await page.evaluate(() => ({
    contextLost: (window as unknown as { RWW: LifecycleApi }).RWW.renderer.gl.getContext().isContextLost(),
    programs: (window as unknown as { RWW: LifecycleApi }).RWW.renderer.gl.info.programs?.length ?? 0,
    environmentUuid: (window as unknown as { RWW: LifecycleApi }).RWW.renderer.scene.environment?.uuid ?? null,
  }));
  expect(recovered.contextLost).toBe(false);
  expect(recovered.programs).toBeGreaterThan(0);
  expect(recovered.environmentUuid).not.toBe(before.environmentUuid);
});

test('keeps the match paused behind an explicit reload fallback when restoration stalls', async ({ page }) => {
  await page.goto('/?seed=624&quality=low');
  await page.waitForFunction(() => {
    const session = (window as unknown as { RWW?: LifecycleApi }).RWW;
    return Boolean(session && session.startup().firstPlayableAt !== null);
  });
  await page.evaluate(() => {
    const target = window as unknown as { RWW: LifecycleApi; rwwLossExtension?: WEBGL_lose_context };
    target.rwwLossExtension = target.RWW.renderer.gl.getContext().getExtension('WEBGL_lose_context')!;
    target.rwwLossExtension.loseContext();
  });
  await expect(page.locator('[data-rww-context-recovery]')).toBeVisible();
  const pausedTick = await page.evaluate(() =>
    (window as unknown as { RWW: LifecycleApi }).RWW.game.world.tick);

  await expect(page.locator('[data-rww-context-recovery] button', { hasText: 'Reload game' }))
    .toBeVisible({ timeout: 12_000 });
  expect(await page.evaluate(() =>
    (window as unknown as { RWW: LifecycleApi }).RWW.game.world.tick)).toBe(pausedTick);

  await page.evaluate(() =>
    (window as unknown as { rwwLossExtension: WEBGL_lose_context }).rwwLossExtension.restoreContext());
  await expect(page.locator('[data-rww-context-recovery]')).toHaveCount(0);
});

test('bounds presentation events while rendering is starved', async ({ page }) => {
  await page.goto('/?seed=614&quality=low&scenarioDriver=1');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { RWW?: LifecycleApi }).RWW?.testDriver));

  const pending = await page.evaluate(() => {
    const session = (window as unknown as { RWW: LifecycleApi }).RWW;
    session.testDriver.setAiEnabled(false);
    for (let index = 0; index < 5_000; index++) {
      session.game.world.events.push({
        kind: 'impact', s: 0, z: 0, h: 0, faction: 0, scale: 1, id: 100_000 + index,
      });
      session.game.stepSimulationExactlyOnce();
    }
    return (session.game as unknown as { presentationEvents: unknown[] }).presentationEvents.length;
  });

  expect(pending).toBeLessThanOrEqual(4_096);
});

test('keeps heap and WebGL resources on a plateau during accelerated soak', async ({ page }) => {
  await page.goto('/?seed=615&quality=low&scenarioDriver=1');
  await page.waitForFunction(() =>
    Boolean((window as unknown as { RWW?: LifecycleApi }).RWW?.testDriver));

  const sample = async (steps: number): Promise<{
    heapBytes: number;
    geometries: number;
    textures: number;
    programs: number;
  }> => {
    await page.evaluate((count) => {
      const session = (window as unknown as { RWW: LifecycleApi }).RWW;
      session.testDriver.setAiEnabled(false);
      for (let index = 0; index < count; index++) {
        session.game.world.events.push({
          kind: 'impact', s: index % 400, z: 0, h: 0, faction: 0, scale: 1, id: 200_000 + session.game.world.tick,
        });
        session.game.stepSimulationExactlyOnce();
        if (index % 30 === 29) {
          session.testDriver.presentFrame(1 / 30, session.game.world.time);
        }
      }
      session.testDriver.presentFrame(1 / 30, session.game.world.time);
    }, steps);
    await page.requestGC();
    return page.evaluate(() => {
      const renderer = (window as unknown as { RWW: LifecycleApi }).RWW.renderer;
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return {
        heapBytes: memory?.usedJSHeapSize ?? 0,
        geometries: renderer.gl.info.memory.geometries,
        textures: renderer.gl.info.memory.textures,
        programs: renderer.gl.info.programs?.length ?? 0,
      };
    });
  };

  const warm = await sample(1_200);
  const later = await sample(2_400);
  const final = await sample(2_400);
  console.log('phase4d soak evidence', JSON.stringify({ warm, later, final, simulatedTicks: 6_000 }));

  expect(warm.heapBytes).toBeGreaterThan(0);
  expect(later.geometries).toBe(warm.geometries);
  expect(final.geometries).toBe(warm.geometries);
  expect(later.textures).toBe(warm.textures);
  expect(final.textures).toBe(warm.textures);
  expect(later.programs).toBe(warm.programs);
  expect(final.programs).toBe(warm.programs);
  expect(final.heapBytes - warm.heapBytes).toBeLessThan(8 * 1024 * 1024);
});
