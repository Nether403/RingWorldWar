import type { Terrain } from '@gen/terrain';
import { Faction, STRUCTURES, UNITS } from '@sim/data';
import {
  runHeadlessBatch,
  runHeadlessMatch,
  summarizeHeadlessResults,
  type HeadlessMatchConfig,
} from '@headless/runner';
import { describe, expect, it } from 'vitest';

const flatTerrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  segmentSlopePassable: () => true,
  isBuildable: () => true,
} as unknown as Terrain;

const baseConfig: HeadlessMatchConfig = {
  seed: 501,
  factions: [Faction.Compact, Faction.Choir],
  difficulties: ['veteran', 'veteran'],
  tickLimit: 300,
};

describe('headless match runner', () => {
  it('returns a complete result resolved by the World time-cap outcome', () => {
    const result = runHeadlessMatch(baseConfig, flatTerrain);

    expect(result.status).toBe('completed');
    expect(result.winner).toBeNull();
    expect(result.durationTicks).toBe(baseConfig.tickLimit);
    expect(result.durationSeconds).toBeCloseTo(baseConfig.tickLimit / 30, 8);
    expect(result.endReason).toContain('Time limit');
    for (const faction of baseConfig.factions) {
      const stats = result.factions[faction];
      expect(Object.keys(stats.unitsProduced).sort()).toEqual(Object.keys(UNITS).sort());
      expect(Object.keys(stats.unitsLost).sort()).toEqual(Object.keys(UNITS).sort());
      expect(Object.keys(stats.structuresDestroyed).sort()).toEqual(Object.keys(STRUCTURES).sort());
      expect(stats.economy.salvageGathered).toBeGreaterThanOrEqual(0);
      expect(stats.economy.salvageSpent).toBeGreaterThanOrEqual(0);
      expect(stats.economy.endingSalvage).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces exactly the same result for the same seed and configuration', () => {
    const first = runHeadlessMatch(baseConfig, flatTerrain);
    const second = runHeadlessMatch(baseConfig, flatTerrain);

    expect(second).toEqual(first);
  });

  it('runs a deterministic batch and reports the measured balance baseline', () => {
    const configs = [501, 502, 503, 504].map((seed) => ({
      ...baseConfig,
      seed,
      tickLimit: 1_800,
    }));
    const batch = runHeadlessBatch(configs, () => flatTerrain);
    const summary = summarizeHeadlessResults(batch);

    expect(batch).toHaveLength(configs.length);
    expect(summary.matches).toBe(configs.length);
    expect(summary.draws + summary.wins[Faction.Compact] + summary.wins[Faction.Choir]).toBe(configs.length);
    console.info(`headless balance baseline ${JSON.stringify(summary)}`);
  }, 15_000);

  it('measures a performance smoke baseline without imposing a timing threshold', () => {
    const started = Date.now();
    const result = runHeadlessMatch({ ...baseConfig, tickLimit: 900 }, flatTerrain);
    const elapsedMs = Math.max(1, Date.now() - started);
    const ticksPerSecond = Math.round((result.durationTicks / elapsedMs) * 1_000);

    expect(Number.isFinite(ticksPerSecond)).toBe(true);
    expect(result.durationTicks).toBe(900);
    console.info(`headless performance baseline ticks=${result.durationTicks} elapsedMs=${elapsedMs} ticksPerSecond=${ticksPerSecond}`);
  });
});
