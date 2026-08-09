import { expect, test, type Page } from 'playwright/test';
import type { BattlefieldDressingDiagnostics } from '../src/render/battlefieldDressing';
import type { QualityLevel } from '../src/render/renderer';

interface DistrictSnapshot {
  ownerName: string;
  bucketNames: string[];
  bucketCounts: number[];
  diagnostics: BattlefieldDressingDiagnostics;
  quality: QualityLevel;
  drawCalls: number;
  triangles: number;
  contextLost: boolean;
  canvas: { width: number; height: number };
  resources: { geometries: number; textures: number; programs: number };
  worldHash: string;
}

interface DistrictQualification {
  snapshot(): DistrictSnapshot;
  setQuality(quality: QualityLevel): DistrictSnapshot;
}

async function launch(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error: Error) => errors.push(error.message));
  page.on('console', (message: { type(): string; text(): string }) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?seed=20260812&quality=low&qualification=ls12&menu=0');
  await page.waitForFunction(() => Boolean(
    (window as unknown as { RWWQualification?: DistrictQualification }).RWWQualification,
  ));
}

test('renders the authored three-scale district foundation in the production Low build', async ({ page }) => {
  const errors: string[] = [];
  await launch(page, errors);
  await page.waitForTimeout(300);

  const result = await page.evaluate(() =>
    (window as unknown as { RWWQualification: DistrictQualification }).RWWQualification.snapshot());

  expect(result.ownerName).toBe('layered-district-scatter');
  expect(result.bucketNames).toEqual([
    'district-overhead-landmarks',
    'district-tactical-shells',
    'district-tactical-trunks',
    'district-bounded-detail',
  ]);
  expect(result.diagnostics.generatedByScale.overhead).toBeGreaterThan(0);
  expect(result.diagnostics.generatedByScale.tactical).toBeGreaterThan(0);
  expect(result.diagnostics.generatedByScale.micro).toBeGreaterThan(0);
  expect(result.diagnostics.visibleByScale.overhead).toBeGreaterThan(0);
  expect(result.diagnostics.visibleByScale.tactical).toBeGreaterThan(0);
  expect(result.diagnostics.visibleTotal).toBeLessThanOrEqual(72);
  expect(result.diagnostics.drawBuckets).toBe(4);
  expect(result.drawCalls).toBeGreaterThan(0);
  expect(result.triangles).toBeLessThan(100_000);
  expect(result.canvas).toEqual({ width: 1280, height: 720 });
  expect(result.contextLost).toBe(false);
  expect(errors).toEqual([]);
});

test('keeps production quality cycling resource-bounded and simulation-neutral', async ({ page }) => {
  const errors: string[] = [];
  await launch(page, errors);
  const result = await page.evaluate(() => {
    const qualification = (window as unknown as {
      RWWQualification: DistrictQualification;
    }).RWWQualification;
    const initial = qualification.snapshot();
    const qualities = ['low', 'medium', 'high', 'ultra'] as QualityLevel[];
    qualities.forEach((quality) => qualification.setQuality(quality));
    const warm = qualities.map((quality) => qualification.setQuality(quality));
    const samples = qualities.map((quality) => qualification.setQuality(quality));
    samples.push(qualification.setQuality('low'));
    return { initial, warm, samples };
  });

  const ultra = result.samples.find((sample) => sample.quality === 'ultra')!;
  const restored = result.samples.at(-1)!;
  expect(ultra.diagnostics.visibleTotal).toBeGreaterThan(result.initial.diagnostics.visibleTotal);
  expect(ultra.diagnostics.visibleByScale.micro).toBeGreaterThan(result.initial.diagnostics.visibleByScale.micro);
  expect(ultra.diagnostics.visibleTotal).toBeLessThanOrEqual(256);
  expect(restored.diagnostics.visibleTotal).toBe(result.initial.diagnostics.visibleTotal);
  expect(restored.diagnostics.visibleByScale).toEqual(result.initial.diagnostics.visibleByScale);
  expect(restored.worldHash).toBe(result.initial.worldHash);
  expect(result.samples.every((sample) => !sample.contextLost)).toBe(true);
  for (let index = 0; index < result.warm.length; index++) {
    expect(result.samples[index]!.resources).toEqual(result.warm[index]!.resources);
  }
  const geometries = result.samples.map((sample) => sample.resources.geometries);
  const textures = result.samples.map((sample) => sample.resources.textures);
  const programs = result.samples.map((sample) => sample.resources.programs);
  expect(Math.max(...geometries) - Math.min(...geometries)).toBeLessThanOrEqual(1);
  expect(Math.max(...textures) - Math.min(...textures)).toBeLessThanOrEqual(2);
  expect(Math.max(...programs) - Math.min(...programs)).toBeLessThanOrEqual(12);
  expect(errors).toEqual([]);
});
