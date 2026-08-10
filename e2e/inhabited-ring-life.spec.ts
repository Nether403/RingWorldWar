import { expect, test, type Page } from 'playwright/test';
import type { BattlefieldDressingDiagnostics } from '../src/render/battlefieldDressing';
import type { QualityLevel } from '../src/render/renderer';

interface LifeSnapshot {
  bucketNames: string[];
  diagnostics: BattlefieldDressingDiagnostics;
  quality: QualityLevel;
  triangles: number;
  contextLost: boolean;
  canvas: { width: number; height: number };
  resources: { geometries: number; textures: number; programs: number };
  worldHash: string;
}

interface LifeQualification {
  snapshot(): LifeSnapshot;
  setQuality(quality: QualityLevel): LifeSnapshot;
}

async function launch(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error: Error) => errors.push(error.message));
  page.on('console', (message: { type(): string; text(): string }) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?seed=20260814&quality=low&qualification=ls12&menu=0');
  await page.waitForFunction(() => Boolean(
    (window as unknown as { RWWQualification?: LifeQualification }).RWWQualification,
  ));
}

test('keeps habitation, vegetation, transit, and ambient life legible on production Low', async ({ page }) => {
  const errors: string[] = [];
  await launch(page, errors);
  const result = await page.evaluate(() =>
    (window as unknown as { RWWQualification: LifeQualification }).RWWQualification.snapshot());

  expect(result.bucketNames).toEqual([
    'district-overhead-landmarks',
    'district-tactical-shells',
    'district-tactical-trunks',
    'district-bounded-detail',
  ]);
  expect(result.diagnostics.visibleLifeCues).toEqual(['habitation', 'vegetation', 'transit', 'ambient']);
  expect(result.diagnostics.generatedByLifeCue).toMatchObject({
    habitation: expect.any(Number),
    vegetation: expect.any(Number),
    transit: expect.any(Number),
    ambient: expect.any(Number),
  });
  expect(Object.values(result.diagnostics.visibleByLifeCue).every((count) => count > 0)).toBe(true);
  expect(result.diagnostics.visibleTotal).toBeLessThanOrEqual(72);
  expect(result.diagnostics.drawBuckets).toBe(4);
  expect(result.triangles).toBeLessThan(100_000);
  expect(result.canvas).toEqual({ width: 1280, height: 720 });
  expect(result.contextLost).toBe(false);
  expect(errors).toEqual([]);
});

test('advances bounded life activity while preserving renderer resources', async ({ page }) => {
  const errors: string[] = [];
  await launch(page, errors);
  const authority = await page.evaluate(() => {
    const qualification = (window as unknown as { RWWQualification: LifeQualification }).RWWQualification;
    return { before: qualification.snapshot(), after: qualification.setQuality('low') };
  });
  const initial = await page.evaluate(() =>
    (window as unknown as { RWWQualification: LifeQualification }).RWWQualification.snapshot());
  await page.waitForTimeout(300);
  const animated = await page.evaluate(() =>
    (window as unknown as { RWWQualification: LifeQualification }).RWWQualification.snapshot());

  expect(animated.diagnostics.activityFrame).toBeGreaterThan(initial.diagnostics.activityFrame);
  expect(animated.diagnostics.motionEnabled).toBe(true);
  expect(animated.diagnostics.matrixSignature).not.toEqual(initial.diagnostics.matrixSignature);
  expect(animated.diagnostics.colorSignature).not.toEqual(initial.diagnostics.colorSignature);
  expect(authority.after.worldHash).toBe(authority.before.worldHash);
  expect(animated.resources).toEqual(initial.resources);
  expect(animated.contextLost).toBe(false);
  expect(errors).toEqual([]);
});

test('responds to the production reduced-motion media preference', async ({ page }) => {
  const errors: string[] = [];
  await launch(page, errors);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  const initial = await page.evaluate(() =>
    (window as unknown as { RWWQualification: LifeQualification }).RWWQualification.snapshot());
  await page.waitForTimeout(300);
  const later = await page.evaluate(() =>
    (window as unknown as { RWWQualification: LifeQualification }).RWWQualification.snapshot());

  expect(initial.diagnostics.motionEnabled).toBe(false);
  expect(later.diagnostics.activityFrame).toBe(0);
  expect(later.diagnostics.activityFrame).toBe(initial.diagnostics.activityFrame);
  expect(later.diagnostics.matrixSignature).toEqual(initial.diagnostics.matrixSignature);
  expect(later.diagnostics.colorSignature).toEqual(initial.diagnostics.colorSignature);
  expect(errors).toEqual([]);
});

test('keeps sustained activity updates inside the Low frame and resource budget', async ({ page }) => {
  const errors: string[] = [];
  await launch(page, errors);
  const before = await page.evaluate(() =>
    (window as unknown as { RWWQualification: LifeQualification }).RWWQualification.snapshot());
  await page.waitForTimeout(2_000);
  const after = await page.evaluate(() =>
    (window as unknown as { RWWQualification: LifeQualification }).RWWQualification.snapshot());

  expect(after.resources).toEqual(before.resources);
  expect(after.diagnostics.visibleTotal).toBeLessThanOrEqual(72);
  expect(after.contextLost).toBe(false);
  expect(errors).toEqual([]);
});
