import { describe, expect, it } from 'vitest';
import type { Terrain } from '@gen/terrain';
import { FACTION_MODS, Faction, STRUCTURES, UNITS } from '@sim/data';
import { World } from '@sim/world';

describe('faction modifiers', () => {
  it('stores deterministic effective health, vision, and build duration on entities', () => {
    const world = emptyWorld();
    const compact = world.spawnUnit(Faction.Compact, 'vanguard', 0, 0);
    const choir = world.spawnUnit(Faction.Choir, 'vanguard', 500, 0);
    const radar = world.spawnStructure(Faction.Choir, 'radarMast', 800, 0, 1);

    expect(compact.maxHp).toBe(Math.round(UNITS.vanguard.hp * FACTION_MODS[Faction.Compact].mechHpMultiplier));
    expect(choir.maxHp).toBe(Math.round(UNITS.vanguard.hp * FACTION_MODS[Faction.Choir].mechHpMultiplier));
    expect(compact.hp).toBe(compact.maxHp);
    expect(choir.hp).toBe(choir.maxHp);
    expect(choir.vision).toBe(Math.round(UNITS.vanguard.vision * FACTION_MODS[Faction.Choir].visionMultiplier));
    expect(radar.vision).toBe(Math.round(STRUCTURES.radarMast.vision * FACTION_MODS[Faction.Choir].visionMultiplier));
    expect(radar.buildDuration).toBeCloseTo(
      STRUCTURES.radarMast.buildTime * FACTION_MODS[Faction.Choir].buildTimeMultiplier,
    );
  });

  it('charges the effective ballistic roster cost at the queue and placement seams', () => {
    const world = emptyWorld();
    const compact = world.players[Faction.Compact];
    compact.salvage = 10_000;
    const anchor = world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const fabricator = world.spawnStructure(Faction.Compact, 'fabricator', 100, 0, 1);
    const foundry = world.spawnStructure(Faction.Compact, 'mechFoundry', 200, 0, 1);
    expect(anchor.alive && fabricator.alive).toBe(true);

    const beforeUnit = compact.salvage;
    expect(world.tryQueueUnit(foundry.id, 'longbow')).toBe(true);
    expect(beforeUnit - compact.salvage).toBe(
      Math.round((UNITS.longbow.cost.salvage ?? 0) * FACTION_MODS[Faction.Compact].ballisticCostMultiplier),
    );

    const beforeStructure = compact.salvage;
    const battery = world.tryPlaceStructure(Faction.Compact, 'rocketBattery', 300, 0);
    expect(battery).not.toBeNull();
    expect(beforeStructure - compact.salvage).toBe(
      Math.round(
        (STRUCTURES.rocketBattery.cost.salvage ?? 0) *
          FACTION_MODS[Faction.Compact].ballisticCostMultiplier,
      ),
    );
    expect(battery!.salvageCost).toBe(beforeStructure - compact.salvage);
  });
});

function emptyWorld(): World {
  const terrain = {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  return new World(terrain, 101);
}
