import { expect, test, type Page } from 'playwright/test';
import type { QualityLevel } from '../src/render/renderer';

interface PilotSnapshot {
  authoredBuildings: {
    loaded: boolean;
    assetIds: string[];
    placementIds: string[];
    meshCount: number;
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

  expect(result.initial.authoredBuildings).toEqual({
    loaded: true,
    assetIds: [
      'outpost-tower-low-a',
      'settlement-large-a',
      'settlement-large-broad-a',
      'settlement-large-narrow-a',
      'settlement-large-square-a',
    ],
    placementIds: [
      'compact-pilot-tower',
      'compact-pilot-square',
      'compact-pilot-broad',
      'choir-pilot-large',
      'choir-pilot-narrow',
    ],
    meshCount: 5,
  });
  expect(result.ultra.authoredBuildings).toEqual(result.initial.authoredBuildings);
  expect(result.restored.authoredBuildings).toEqual(result.initial.authoredBuildings);
  expect(result.restored.worldHash).toBe(result.initial.worldHash);
  expect([result.initial, result.ultra, result.restored].every((sample) => !sample.contextLost)).toBe(true);
  expect(errors).toEqual([]);
});
