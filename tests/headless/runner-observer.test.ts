import type { Terrain } from '@gen/terrain';
import {
  runHeadlessMatch,
  type HeadlessMatchConfig,
  type HeadlessMatchObservation,
} from '@headless/runner';
import { Faction } from '@sim/data';
import { World } from '@sim/world';
import { describe, expect, it, vi } from 'vitest';

const flatTerrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  segmentSlopePassable: () => true,
  isBuildable: () => true,
} as unknown as Terrain;

const config: HeadlessMatchConfig = {
  seed: 711,
  factions: [Faction.Compact, Faction.Choir],
  difficulties: ['veteran', 'veteran'],
  tickLimit: 120,
};

describe('headless match observer', () => {
  it('observes each completed tick after its event drain without changing the result', () => {
    const observations: HeadlessMatchObservation[] = [];
    const observed = runHeadlessMatch(config, flatTerrain, (observation) => {
      observations.push(observation);
    });
    const unobserved = runHeadlessMatch(config, flatTerrain);

    expect(observed).toEqual(unobserved);
    expect(observations).toHaveLength(observed.durationTicks);
    expect(observations[0]?.tick).toBe(1);
    expect(observations.at(-1)).toMatchObject({
      tick: observed.durationTicks,
      status: observed.status,
      winner: observed.winner,
      endReason: observed.endReason,
    });
  });

  it('delivers drained events once rather than leaving them for a later observation', () => {
    const eventIds = new Set<string>();
    let eventCount = 0;
    const drainEvents = vi.spyOn(World.prototype, 'drainEvents');

    const result = runHeadlessMatch({ ...config, tickLimit: 900 }, flatTerrain, (observation) => {
      for (const event of observation.events) {
        eventCount++;
        const key = `${observation.tick}:${event.kind}:${event.id}:${event.weapon ?? ''}`;
        expect(eventIds.has(key)).toBe(false);
        eventIds.add(key);
      }
    });

    expect(drainEvents).toHaveBeenCalledTimes(result.durationTicks);
    expect(eventCount).toBeGreaterThan(0);
    drainEvents.mockRestore();
  });
});
