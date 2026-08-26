import { expect, test } from 'playwright/test';

/**
 * Visual contact sheets.
 *
 * These are the repository's first image baselines. They exist because the
 * procedural graphics overhaul in `docs/procedural-graphics-overhaul.md` changes
 * lighting, materials, and geometry in ways that numeric assertions cannot see:
 * a shader can compile, draw the right number of triangles, stay inside every
 * budget, and still look wrong.
 *
 * Capture is done in the page through `RWWCalibration.captureFrame()`, which
 * draws and reads back in one synchronous turn. Screenshotting the page instead
 * would be at the mercy of whether Chromium still holds the composited WebGL
 * colour buffer, which is not guaranteed without `preserveDrawingBuffer`.
 *
 * The tolerance is deliberately loose. These baselines are here to catch a
 * material going flat, a light going out, or geometry disappearing, not to pin
 * every driver-level rounding difference.
 */

const SHEETS = ['calibration', 'mechs', 'structures', 'terrain', 'authored', 'all'] as const;
const QUALITIES = ['low', 'high'] as const;

type Sheet = (typeof SHEETS)[number];
type Quality = (typeof QUALITIES)[number];

interface FrameStatistics {
  width: number;
  height: number;
  mean: number;
  variance: number;
  litFraction: number;
  highlightFraction: number;
  chromaticFraction: number;
}

interface SheetSnapshot {
  ready: boolean;
  sheet: string;
  manifest: Record<string, unknown>;
  canvasCount: number;
  hasGame: boolean;
  drawingBuffer: { width: number; height: number };
  resources: { calls: number; triangles: number; textures: number; programs: number };
  statistics: FrameStatistics;
}

/**
 * Deterministic lower bounds on what each sheet must put on screen.
 *
 * These carry most of the regression-catching weight. A shader that compiles but
 * renders flat, a key light that stops contributing, or a faction accent that
 * disappears all move these numbers well outside their band, and unlike an image
 * diff the failure message says which property broke.
 *
 * `litFraction` is the share of the frame brighter than the space and fog floor,
 * so it doubles as a check that the subjects are actually in frame.
 */
const STATISTICS_FLOOR: Record<Sheet, { minLit: number; minVariance: number; minChromatic: number }> = {
  calibration: { minLit: 0.20, minVariance: 60, minChromatic: 0.0020 },
  mechs: { minLit: 0.20, minVariance: 40, minChromatic: 0.0005 },
  structures: { minLit: 0.20, minVariance: 60, minChromatic: 0.0010 },
  terrain: { minLit: 0.45, minVariance: 60, minChromatic: 0.0600 },
  authored: { minLit: 0.20, minVariance: 40, minChromatic: 0.0140 },
  all: { minLit: 0.15, minVariance: 40, minChromatic: 0.0100 },
};

/**
 * Upper bounds on what each sheet is allowed to cost, so unnoticed growth shows
 * up as a failure rather than as a slow slide. These are dev-page ceilings and
 * are unrelated to the gameplay 400-call architectural ceiling.
 */
const RESOURCE_CEILINGS: Record<Sheet, { calls: number; triangles: number }> = {
  // Medium and above add ten post-stage passes: bright pass, four reductions,
  // four expansions, and the composite.
  calibration: { calls: 74, triangles: 60_000 },
  mechs: { calls: 220, triangles: 120_000 },
  structures: { calls: 90, triangles: 120_000 },
  terrain: { calls: 40, triangles: 40_000 },
  authored: { calls: 90, triangles: 120_000 },
  all: { calls: 460, triangles: 320_000 },
};

/**
 * Texture ceilings per quality tier.
 *
 * Split by tier because Task 2 of the overhaul introduces an HDR render target
 * and a depth texture on Medium and above, while Low keeps rendering direct to
 * the default framebuffer. Low's value is the frozen one and must not move.
 */
const TEXTURE_CEILINGS: Record<Quality, number> = {
  low: 4,
  // The post stage adds an HDR colour target, its depth texture, five bloom mips,
  // two half-resolution occlusion buffers, and the two generated grade tables on
  // Medium and above. Low's value is the frozen one and must not move.
  high: 16,
};

async function loadSheet(
  page: import('playwright/test').Page,
  sheet: Sheet,
  quality: Quality,
  errors: string[],
): Promise<SheetSnapshot> {
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/dev/calibration?quality=${quality}&sheet=${sheet}`);
  await page.waitForFunction(
    () => Boolean((window as unknown as { RWWCalibration?: { ready?: boolean } }).RWWCalibration?.ready),
  );
  await expect(page.locator('#boot')).toHaveCount(0);

  return page.evaluate(() => {
    const calibration = (window as unknown as { RWWCalibration: any }).RWWCalibration;
    const statistics = calibration.frameStatistics();
    const gl = calibration.renderer.gl.getContext();
    return {
      ready: calibration.ready,
      sheet: calibration.sheet,
      manifest: calibration.manifest,
      canvasCount: document.querySelectorAll('canvas').length,
      hasGame: Boolean((window as unknown as { RWW?: unknown }).RWW),
      drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      resources: {
        calls: calibration.renderer.gl.info.render.calls,
        triangles: calibration.renderer.gl.info.render.triangles,
        textures: calibration.renderer.gl.info.memory.textures,
        programs: calibration.renderer.gl.info.programs?.length ?? 0,
      },
      statistics,
    };
  });
}

async function captureSheet(page: import('playwright/test').Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    () => (window as unknown as { RWWCalibration: { captureFrame: () => string } })
      .RWWCalibration.captureFrame(),
  );
  const encoded = dataUrl.split(',')[1];
  expect(encoded, 'captureFrame must return a PNG data URL').toBeTruthy();
  return Buffer.from(encoded!, 'base64');
}

for (const sheet of SHEETS) {
  for (const quality of QUALITIES) {
    test(`contact sheet ${sheet} renders at ${quality} and matches its baseline`, async ({ page }) => {
      const errors: string[] = [];
      const snapshot = await loadSheet(page, sheet, quality, errors);

      expect(snapshot.ready).toBe(true);
      expect(snapshot.sheet).toBe(sheet);
      expect(snapshot.canvasCount).toBe(1);
      // The dev page must never boot the game alongside itself.
      expect(snapshot.hasGame).toBe(false);
      expect(snapshot.manifest).toMatchObject({
        sheet,
        quality,
        toneMapping: 'ACESFilmic',
        outputColorSpace: 'srgb',
        exposure: 1.15,
      });

      const ceiling = RESOURCE_CEILINGS[sheet];
      expect(snapshot.resources.calls).toBeLessThanOrEqual(ceiling.calls);
      expect(snapshot.resources.triangles).toBeLessThanOrEqual(ceiling.triangles);
      expect(snapshot.resources.textures).toBeLessThanOrEqual(TEXTURE_CEILINGS[quality]);
      // Something must actually be on screen.
      expect(snapshot.resources.calls).toBeGreaterThan(0);
      expect(snapshot.resources.triangles).toBeGreaterThan(0);

      // The drawing buffer must be the CSS size at every tier, because the
      // quality pixel-ratio caps are all at or above the harness scale factor.
      // Baselines would silently differ in size otherwise.
      expect(snapshot.statistics.width).toBe(1100);
      expect(snapshot.statistics.height).toBe(640);

      const floor = STATISTICS_FLOOR[sheet];
      expect(snapshot.statistics.litFraction).toBeGreaterThan(floor.minLit);
      expect(snapshot.statistics.variance).toBeGreaterThan(floor.minVariance);
      expect(snapshot.statistics.chromaticFraction).toBeGreaterThan(floor.minChromatic);
      // Nothing should be a blown-out white field.
      expect(snapshot.statistics.highlightFraction).toBeLessThan(0.25);

      const image = await captureSheet(page);
      // Tight on purpose. An earlier pass used a 3 percent ratio and a large
      // camera move still registered as a match, which would have made these
      // baselines worthless. The per-pixel threshold absorbs driver-level
      // rounding while the ratio stays sensitive to real change.
      expect(image).toMatchSnapshot(`${sheet}-${quality}.png`, {
        threshold: 0.15,
        maxDiffPixelRatio: 0.004,
      });

      expect(errors).toEqual([]);
    });
  }
}

test('every sheet stages the content its manifest advertises', async ({ page }) => {
  const errors: string[] = [];

  const mechs = await loadSheet(page, 'mechs', 'high', errors);
  // Six classes in two faction styles.
  expect(mechs.manifest).toMatchObject({ sheetMechs: 12, referenceMechs: 0 });

  const structures = await loadSheet(page, 'structures', 'high', errors);
  // Twelve kinds plus three repeated in Choir style.
  expect(structures.manifest).toMatchObject({ sheetStructures: 15 });

  const terrain = await loadSheet(page, 'terrain', 'high', errors);
  // Seven material patches plus the large ground plane.
  expect(terrain.manifest).toMatchObject({ sheetTerrainPatches: 8 });

  const authored = await loadSheet(page, 'authored', 'high', errors);
  // The ten placements in the shipped authored-building pilot.
  expect(authored.manifest).toMatchObject({ sheetAuthoredBuildings: 10 });

  const all = await loadSheet(page, 'all', 'high', errors);
  expect(all.manifest).toMatchObject({
    sheetMechs: 12,
    sheetStructures: 15,
    // The combined sheet omits the large ground plane.
    sheetTerrainPatches: 7,
    sheetAuthoredBuildings: 10,
    referenceMechs: 1,
    macbethPatches: 24,
  });

  expect(errors).toEqual([]);
});

/**
 * Durable measurement receipt.
 *
 * Writes the frame statistics for every sheet and tier so the Phase 1 tone work
 * has a recorded "before" to improve against. `chromaticFraction` on the mech
 * sheet is the number to watch: faction accent is meant to be the instant
 * threat-assessment read per `docs/art-direction.md` section 2, and it currently
 * occupies well under one percent of the frame.
 */
test('records frame statistics for every sheet and tier', async ({ page }) => {
  const errors: string[] = [];
  const rows: Array<Record<string, unknown>> = [];

  for (const sheet of SHEETS) {
    for (const quality of QUALITIES) {
      const snapshot = await loadSheet(page, sheet, quality, errors);
      rows.push({
        sheet,
        quality,
        drawCalls: snapshot.resources.calls,
        triangles: snapshot.resources.triangles,
        textures: snapshot.resources.textures,
        programs: snapshot.resources.programs,
        mean: Number(snapshot.statistics.mean.toFixed(3)),
        variance: Number(snapshot.statistics.variance.toFixed(2)),
        litFraction: Number(snapshot.statistics.litFraction.toFixed(5)),
        highlightFraction: Number(snapshot.statistics.highlightFraction.toFixed(5)),
        chromaticFraction: Number(snapshot.statistics.chromaticFraction.toFixed(5)),
      });
    }
  }

  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync('validation/evidence/procedural-graphics', { recursive: true });
  writeFileSync(
    'validation/evidence/procedural-graphics/contact-sheet-statistics.json',
    `${JSON.stringify({ capturedBy: 'e2e/calibration-sheets.spec.ts', viewport: '1100x640', rows }, null, 2)}\n`,
  );

  expect(rows).toHaveLength(SHEETS.length * QUALITIES.length);
  expect(errors).toEqual([]);
});

test('sheet selection falls back to the calibration scene for unknown values', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dev/calibration?quality=high&sheet=not-a-sheet');
  await page.waitForFunction(
    () => Boolean((window as unknown as { RWWCalibration?: { ready?: boolean } }).RWWCalibration?.ready),
  );
  const sheet = await page.evaluate(
    () => (window as unknown as { RWWCalibration: { sheet: string } }).RWWCalibration.sheet,
  );
  expect(sheet).toBe('calibration');
  expect(errors).toEqual([]);
});
