import { expect, test, type Page } from 'playwright/test';
import type { QualityLevel } from '../src/render/renderer';

interface PilotSnapshot {
  authoredBuildings: {
    loaded: boolean;
    assetIds: string[];
    placementIds: string[];
    meshCount: number;
    materialColors: string[];
    minRoughness: number;
    maxMetalness: number;
  };
  contextLost: boolean;
  worldHash: string;
}

interface PilotQualification {
  snapshot(): PilotSnapshot;
  setQuality(quality: QualityLevel): PilotSnapshot;
}

async function launch(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error: Error) => errors.push(error.message));
  page.on('console', (message: { type(): string; text(): string }) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?seed=20260811&quality=low&qualification=asset-pilot&menu=0');
  await page.waitForFunction(() => Boolean(
    (window as unknown as { RWWQualification?: PilotQualification }).RWWQualification,
  ));
}

test('loads the bounded authored-building pilot without touching simulation state', async ({ page }) => {
  const errors: string[] = [];
  await launch(page, errors);
  const result = await page.evaluate(() => {
    const qualification = (window as unknown as { RWWQualification: PilotQualification }).RWWQualification;
    const initial = qualification.snapshot();
    const ultra = qualification.setQuality('ultra');
    const restored = qualification.setQuality('low');
    return { initial, ultra, restored };
  });

  // The flat-albedo contract this used to assert is gone. It pinned
  // materialColors to a single '#927456', which was exactly the forced sandstone
  // that made these models read as untextured clay beside the procedural
  // structures. They now wear the shared procedural habitation material, whose
  // base colour is white because the shader supplies the tint, so the meaningful
  // assertions are the catalogue, the placements, and the non-metallic masonry
  // response. See Task 7 in docs/procedural-graphics-overhaul.md.
  expect(result.initial.authoredBuildings).toEqual({
    loaded: true,
    assetIds: [
      'outpost-tower-low-a',
      'settlement-large-a',
      'settlement-large-broad-a',
      'settlement-large-narrow-a',
      'settlement-large-square-a',
      'settlement-small-a',
      'settlement-dual-a',
      'settlement-dual-small-a',
      'settlement-cluster-small-a',
      'settlement-cluster-tower-a',
    ],
    placementIds: [
      'compact-pilot-tower',
      'compact-pilot-square',
      'compact-pilot-broad',
      'compact-pilot-small',
      'compact-pilot-dual',
      'compact-pilot-cluster',
      'choir-pilot-large',
      'choir-pilot-narrow',
      'choir-pilot-dual-small',
      'choir-pilot-cluster-tower',
    ],
    meshCount: expect.any(Number),
    materialColors: ['#ffffff'],
    minRoughness: expect.any(Number),
    maxMetalness: expect.any(Number),
  });
  // Masonry and plaster: rough and non-metallic. Still asserted, because it is a
  // real property of the surface rather than a symptom of the flat treatment.
  expect(result.initial.authoredBuildings.minRoughness).toBeGreaterThanOrEqual(0.8);
  expect(result.initial.authoredBuildings.maxMetalness).toBeLessThanOrEqual(0.08);
  // One mesh per placement at minimum; some catalogue entries are multi-part.
  expect(result.initial.authoredBuildings.meshCount).toBeGreaterThanOrEqual(10);
  expect(result.ultra.authoredBuildings).toEqual(result.initial.authoredBuildings);
  expect(result.restored.authoredBuildings).toEqual(result.initial.authoredBuildings);
  expect(result.restored.worldHash).toBe(result.initial.worldHash);
  expect([result.initial, result.ultra, result.restored].every((sample) => !sample.contextLost)).toBe(true);
  expect(errors).toEqual([]);
});
