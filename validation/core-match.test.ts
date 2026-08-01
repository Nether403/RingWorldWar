import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  createCoreMatchReport,
  formatCoreMatchJson,
  formatCoreMatchMarkdown,
  parseCoreMatchManifest,
  runCoreMatchCohort,
} from '@headless/coreMatch';
import { expect, it } from 'vitest';

const manifestPath = resolve(
  process.env.CORE_MATCH_MANIFEST ?? 'validation/manifests/veteran-mirror.json',
);

it(`validates core matches from ${basename(manifestPath)}`, () => {
  const manifest = parseCoreMatchManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const records = runCoreMatchCohort(manifest, {
    measureWallClock: process.env.CORE_MATCH_WALL_CLOCK === '1',
  });
  const report = createCoreMatchReport(manifest, records);
  const outputDirectory = resolve('output/core-match');
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, `${manifest.id}.json`), formatCoreMatchJson(report));
  writeFileSync(resolve(outputDirectory, `${manifest.id}.md`), formatCoreMatchMarkdown(report));

  const failures = report.gates.checks
    .filter((check) => !check.passed)
    .map((check) => `${check.id}: ${check.actual} ${check.expectation}`);
  expect(failures, `Core-match gates failed:\n${failures.join('\n')}`).toEqual([]);
}, 3_600_000);
