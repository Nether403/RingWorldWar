import { describe, expect, it } from 'vitest';
import type { Terrain } from '@gen/terrain';
import { Faction, WRECK_LIFETIME } from '@sim/data';
import { World } from '@sim/world';

describe('damage states and wrecks', () => {
  it('uses maxHp thresholds and applies the heavy-damage speed penalty once', () => {
    const world = emptyWorld();
    const unit = world.spawnUnit(Faction.Compact, 'vanguard', 0, 0);

    unit.hp = unit.maxHp * 0.65;
    world.step();
    expect(unit.damageState).toBe(1);
    expect(unit.speedMultiplier).toBe(1);

    unit.hp = unit.maxHp * 0.32;
    unit.order = { kind: 'move', s: 500, z: 0, targetId: 0 };
    for (let i = 0; i < 30; i++) world.step();
    expect(unit.damageState).toBe(2);
    expect(unit.speedMultiplier).toBe(0.8);
  });

  it('spawns a targetable mech wreck and removes it after deterministic decay', () => {
    const world = emptyWorld();
    const unit = world.spawnUnit(Faction.Compact, 'wisp', 100, 20);
    world.applyDamage(unit.id, 100_000, 'explosive', Faction.Choir);

    expect(world.wreckages).toHaveLength(1);
    const wreck = world.wreckages[0]!;
    expect(wreck.s).toBe(unit.s);
    expect(wreck.z).toBe(unit.z);
    expect(world.positionOf(wreck.id)).not.toBeNull();

    const hashWithWreck = world.stateHash();
    world.step();
    expect(world.stateHash()).not.toBe(hashWithWreck);
    expect(wreck.lifetime).toBeCloseTo(WRECK_LIFETIME - 1 / 30, 8);

    world.applyDamage(wreck.id, 100_000, 'kinetic', Faction.Choir);
    expect(wreck.alive).toBe(false);

    const second = world.spawnUnit(Faction.Compact, 'wisp', 200, 20);
    world.applyDamage(second.id, 100_000, 'explosive', Faction.Choir);
    const decaying = world.wreckages.find((candidate) => candidate.alive)!;
    for (let i = 0; i < WRECK_LIFETIME * 30; i++) world.step();
    expect(decaying.alive).toBe(false);
  });

  it('releases removed entities from the derived lookup index during compaction', () => {
    const world = emptyWorld();
    const unit = world.spawnUnit(Faction.Compact, 'engineer', 0, 0);
    const structure = world.spawnStructure(Faction.Compact, 'solarArray', 100, 0, 1);
    const mech = world.spawnUnit(Faction.Compact, 'wisp', 200, 0);

    world.applyDamage(unit.id, 100_000, 'explosive', Faction.Choir);
    world.applyDamage(structure.id, 100_000, 'explosive', Faction.Choir);
    world.applyDamage(mech.id, 100_000, 'explosive', Faction.Choir);
    const wreck = world.wreckages[0]!;
    world.applyDamage(wreck.id, 100_000, 'kinetic', Faction.Choir);

    for (let tick = 0; tick < 30; tick++) world.step();

    const entitiesById = (world as unknown as {
      entitiesById: Array<unknown | undefined> | Map<number, unknown>;
    }).entitiesById;
    const lookup = (id: number): unknown => Array.isArray(entitiesById)
      ? entitiesById[id]
      : entitiesById.get(id);
    expect(lookup(unit.id)).toBeUndefined();
    expect(lookup(structure.id)).toBeUndefined();
    expect(lookup(mech.id)).toBeUndefined();
    expect(lookup(wreck.id)).toBeUndefined();
    expect(Array.isArray(entitiesById) ? entitiesById.filter(Boolean).length : entitiesById.size).toBe(0);
  });

  it('does not allocate lookup slots for projectile ids that contain no entity', () => {
    const world = emptyWorld();
    (world as unknown as { nextId: number }).nextId = 1_000_000;

    world.spawnUnit(Faction.Compact, 'engineer', 0, 0);

    const index = (world as unknown as {
      entitiesById: Array<unknown | undefined> | Map<number, unknown>;
    }).entitiesById;
    const allocatedEntries = Array.isArray(index) ? index.length : index.size;
    expect(allocatedEntries).toBe(1);
  });
});

function emptyWorld(): World {
  const terrain = {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  return new World(terrain, 103);
}
