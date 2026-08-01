import { AiOpponent } from '@ai/opponent';
import { RING_CIRCUMFERENCE, SIM_DT } from '@core/constants';
import type { Terrain } from '@gen/terrain';
import { Faction } from '@sim/data';
import { World } from '@sim/world';
import { describe, expect, it } from 'vitest';

const flatTerrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  isBuildable: () => true,
} as unknown as Terrain;

describe('AI rocket battery targeting', () => {
  it('prioritizes the higher-value reachable target instead of the farthest target', () => {
    const world = artilleryWorld();
    world.spawnUnit(Faction.Compact, 'engineer', 500, 0);
    const highValue = world.spawnStructure(
      Faction.Compact,
      'fusionCore',
      RING_CIRCUMFERENCE - 700,
      0,
      1,
    );
    const battery = world.structures.find((structure) => structure.kind === 'rocketBattery')!;
    expect(world.isEntityVisible(Faction.Choir, highValue.id)).toBe(true);
    expect(
      world.isBallisticTargetWithinReachEnvelope(
        battery.id,
        highValue.s,
        highValue.z,
        Faction.Choir,
        'batteryGun',
      ),
    ).toBe(true);
    const attemptedTargets: Array<{ s: number; z: number }> = [];
    world.fireBallisticAt = (_sourceId, targetS, targetZ) => {
      attemptedTargets.push({ s: targetS, z: targetZ });
      return true;
    };

    new AiOpponent(Faction.Choir, 'veteran', 41).update(world, SIM_DT);

    expect(attemptedTargets[0]).toEqual({ s: highValue.s, z: highValue.z });
  });

  it('caches failed plans until the target enters new quantized geometry', () => {
    const world = artilleryWorld();
    const target = world.spawnUnit(Faction.Compact, 'engineer', 500, 0);
    let attempts = 0;
    world.fireBallisticAt = () => {
      attempts++;
      return false;
    };
    const opponent = new AiOpponent(Faction.Choir, 'veteran', 42);

    opponent.update(world, SIM_DT);
    opponent.update(world, 1.5);
    expect(attempts).toBe(1);

    for (let tick = 0; tick < 150; tick++) world.step();
    opponent.update(world, 1.5);
    expect(attempts).toBe(1);

    target.s += 80;
    opponent.update(world, 1.5);
    expect(attempts).toBe(2);
  });

  it('retries a failed plan when its deterministic backoff expires', () => {
    const world = artilleryWorld();
    world.spawnUnit(Faction.Compact, 'engineer', 500, 0);
    let attempts = 0;
    world.fireBallisticAt = () => {
      attempts++;
      return false;
    };
    const opponent = new AiOpponent(Faction.Choir, 'veteran', 43);

    opponent.update(world, SIM_DT);
    for (let tick = 0; tick < 899; tick++) world.step();
    opponent.update(world, 1.5);
    expect(attempts).toBe(1);

    world.step();
    opponent.update(world, 1.5);
    expect(attempts).toBe(2);
    expect(opponent.exportPersistenceState().failedBallisticPlans[0]).toMatchObject({
      failureCount: 2,
      retryAtTick: 2_700,
    });
  });
});

function artilleryWorld(): World {
  const world = new World(flatTerrain, 19, 60);
  world.spawnStructure(Faction.Choir, 'rocketBattery', 0, 0, 1);
  world.spawnStructure(Faction.Choir, 'radarMast', 0, 0, 1);
  return world;
}
