import { describe, expect, it } from 'vitest';
import { AiOpponent } from '@ai/opponent';
import type { Terrain } from '@gen/terrain';
import { Faction, UNITS } from '@sim/data';
import { World } from '@sim/world';

function createWorld(seed = 20260731): World {
  const terrain = {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  const world = new World(terrain, seed);
  world.setup();
  return world;
}

describe('World production invariants', () => {
  it('reserves command points for queued units', () => {
    const world = createWorld(11);
    const foundry = world.spawnStructure(Faction.Compact, 'mechFoundry', 340, 0, 1);
    world.players[Faction.Compact].salvage = 10_000;

    expect(world.tryQueueUnit(foundry.id, 'vanguard')).toBe(true);
    expect(world.tryQueueUnit(foundry.id, 'vanguard')).toBe(true);
    expect(world.tryQueueUnit(foundry.id, 'wisp')).toBe(false);
  });

  it('enforces technology prerequisites in the simulation API', () => {
    const world = createWorld(12);
    world.players[Faction.Compact].salvage = 10_000;
    const site = findBuildableSite(world, 'mechFoundry');

    expect(world.canPlace(Faction.Compact, 'mechFoundry', site.s, site.z)).toBe(false);
    world.spawnStructure(Faction.Compact, 'fabricator', 300, 220, 1);
    expect(world.canPlace(Faction.Compact, 'mechFoundry', site.s, site.z)).toBe(true);
  });

  it('does not let unfinished sites extend build range', () => {
    const world = createWorld(13);
    world.players[Faction.Compact].salvage = 10_000;
    world.spawnStructure(Faction.Compact, 'solarArray', 400, 0, 0);

    expect(world.canPlace(Faction.Compact, 'solarArray', 780, 0)).toBe(false);
  });

  it('pauses queued production if the command cap drops', () => {
    const world = createWorld(14);
    const foundry = world.spawnStructure(Faction.Compact, 'mechFoundry', 340, 0, 1);
    const player = world.players[Faction.Compact];
    player.salvage = 10_000;
    player.commandCap = 7;
    expect(world.tryQueueUnit(foundry.id, 'vanguard')).toBe(true);
    expect(world.tryQueueUnit(foundry.id, 'vanguard')).toBe(true);
    expect(world.tryQueueUnit(foundry.id, 'vanguard')).toBe(true);
    player.commandCap = 4;

    foundry.queueTimer = UNITS.vanguard.buildTime;
    world.step();
    foundry.queueTimer = UNITS.vanguard.buildTime;
    world.step();
    foundry.queueTimer = UNITS.vanguard.buildTime;
    world.step();

    expect(player.commandUsed).toBe(4);
    expect(foundry.queue).toHaveLength(1);
  });

  it('separates units that start at the exact same position', () => {
    const world = createWorld(15);
    const a = world.spawnUnit(Faction.Compact, 'engineer', 500, 0);
    const b = world.spawnUnit(Faction.Compact, 'engineer', 500, 0);

    world.step();

    expect(Math.hypot(a.s - b.s, a.z - b.z)).toBeGreaterThan(0);
  });
});

describe('World determinism', () => {
  it('produces identical hash streams for a seeded match', () => {
    const a = createWorld(44);
    const b = createWorld(44);
    const aiA = [
      new AiOpponent(Faction.Compact, 'veteran', 44),
      new AiOpponent(Faction.Choir, 'veteran', 44),
    ];
    const aiB = [
      new AiOpponent(Faction.Compact, 'veteran', 44),
      new AiOpponent(Faction.Choir, 'veteran', 44),
    ];
    const hashesA: string[] = [];
    const hashesB: string[] = [];

    for (let tick = 0; tick < 1_800; tick++) {
      a.step();
      b.step();
      for (const ai of aiA) ai.update(a, 1 / 30);
      for (const ai of aiB) ai.update(b, 1 / 30);
      if (tick % 30 === 0) {
        hashesA.push(a.stateHash());
        hashesB.push(b.stateHash());
      }
    }

    expect(hashesA).toEqual(hashesB);
    expect(new Set(hashesA).size).toBeGreaterThan(20);
  });
});

function findBuildableSite(world: World, kind: 'mechFoundry'): { s: number; z: number } {
  for (let s = 100; s <= 400; s += 25) {
    for (let z = -350; z <= 350; z += 25) {
      if (!world.terrain.isBuildable(s, z)) continue;
      let overlaps = false;
      for (const structure of world.structures) {
        const ds = Math.abs(structure.s - s);
        const dz = structure.z - z;
        if (Math.hypot(ds, dz) < 70) overlaps = true;
      }
      if (!overlaps) return { s, z };
    }
  }
  throw new Error(`No buildable ${kind} site found`);
}
