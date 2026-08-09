import { describe, expect, it } from 'vitest';
import { panelPhaseAt } from '@core/shadow';
import { RING_CIRCUMFERENCE } from '@core/constants';
import type { Terrain } from '@gen/terrain';
import { BASE_ENERGY, Faction } from '@sim/data';
import { deserializeWorld, serializeWorld } from '@sim/serialize';
import { World, type Projectile } from '@sim/world';

describe('shadow gameplay and overhead intelligence', () => {
  it('[solar-shadow-output] keeps solar generation on the authoritative daylight curve', () => {
    const day = emptyWorld();
    day.spawnStructure(Faction.Compact, 'solarArray', 0, 0, 1);
    day.step();
    const shadow = emptyWorld();
    const shadowS = panelPhaseAt(0) / (Math.PI * 2) * RING_CIRCUMFERENCE;
    shadow.spawnStructure(Faction.Compact, 'solarArray', shadowS, 0, 1);
    shadow.step();

    const daySolar = day.players[Faction.Compact].energyProduced - BASE_ENERGY;
    const shadowSolar = shadow.players[Faction.Compact].energyProduced - BASE_ENERGY;
    expect(daySolar).toBeCloseTo(9, 6);
    expect(shadowSolar).toBeCloseTo(9 * shadow.daylightAt(shadowS), 6);
    expect(shadowSolar).toBeLessThan(daySolar);
  });

  it('[source-local-shadow-sensors] applies local shadow penalties with Choir resilience', () => {
    const world = emptyWorld();
    const shadowS = panelPhaseAt(world.time) / (Math.PI * 2) * RING_CIRCUMFERENCE;
    const compactShadow = world.spawnUnit(Faction.Compact, 'wisp', shadowS, 0);
    const compactDay = world.spawnUnit(Faction.Compact, 'wisp', 0, 0);
    const choirShadow = world.spawnUnit(Faction.Choir, 'wisp', shadowS, 0);

    expect(world.effectiveSensorRange(compactShadow.id, Faction.Compact))
      .toBeCloseTo(compactShadow.vision * 0.65, 6);
    expect(world.effectiveSensorRange(choirShadow.id, Faction.Choir))
      .toBeCloseTo(choirShadow.vision * 0.8, 6);
    expect(world.effectiveSensorRange(compactDay.id, Faction.Compact))
      .toBeCloseTo(compactDay.vision, 6);
  });

  it('[strategic-contact-categories] derives only approved hostile strategic contacts', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const bastion = world.spawnStructure(Faction.Choir, 'bastion', 5_000, 0, 1);
    const silo = world.spawnStructure(Faction.Choir, 'silo', 6_000, 0, 1);
    const node = world.spawnStructure(Faction.Choir, 'spinalNode', 7_000, 0, 1);
    const construction = world.spawnStructure(Faction.Choir, 'mechFoundry', 8_000, 0, 0.4);
    world.spawnStructure(Faction.Choir, 'extractor', 9_000, 0, 1);
    world.spawnUnit(Faction.Choir, 'vanguard', 10_000, 0);

    expect(world.strategicContacts(Faction.Compact)).toEqual([
      expect.objectContaining({ entityId: bastion.id, category: 'bastion' }),
      expect.objectContaining({ entityId: silo.id, category: 'launch-site' }),
      expect.objectContaining({ entityId: node.id, category: 'active-node' }),
      expect.objectContaining({ entityId: construction.id, category: 'major-construction' }),
    ]);
  });

  it('[strategic-contact-authority-boundary] never converts a strategic contact into exact visibility', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const hostile = world.spawnStructure(Faction.Choir, 'silo', 5_000, 0, 1);

    expect(world.strategicContacts(Faction.Compact).map((contact) => contact.entityId)).toContain(hostile.id);
    expect(world.hasStrategicContact(Faction.Compact, hostile.id)).toBe(true);
    expect(world.isEntityVisible(Faction.Compact, hostile.id)).toBe(false);
    expect(world.isVisible(Faction.Compact, hostile.s, hostile.z)).toBe(false);
  });

  it('[strategic-contact-live-state] removes contacts when their qualifying state ends', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const construction = world.spawnStructure(Faction.Choir, 'mechFoundry', 5_000, 0, 0.4);
    expect(world.hasStrategicContact(Faction.Compact, construction.id)).toBe(true);

    construction.progress = 1;
    expect(world.hasStrategicContact(Faction.Compact, construction.id)).toBe(false);
    construction.progress = 0.4;
    construction.alive = false;
    expect(world.hasStrategicContact(Faction.Compact, construction.id)).toBe(false);
  });

  it('[strategic-contact-los-independence] keeps immutable contacts stable across exact visibility changes', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const hostile = world.spawnStructure(Faction.Choir, 'silo', 5_000, 0, 1);
    const hidden = world.strategicContacts(Faction.Compact);

    world.spawnStructure(Faction.Compact, 'radarMast', 4_900, 0, 1);
    const visible = world.strategicContacts(Faction.Compact);

    expect(world.isEntityVisible(Faction.Compact, hostile.id)).toBe(true);
    expect(visible).toEqual(hidden);
    expect(Object.isFrozen(visible)).toBe(true);
    expect(Object.isFrozen(visible[0])).toBe(true);
  });

  it('[deep-shadow-projectile-plume] reveals a ballistic plume in deep shadow without revealing its source', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const source = world.spawnStructure(Faction.Choir, 'rocketBattery', 5_000, 0, 1);
    const shadowS = panelPhaseAt(world.time) / (Math.PI * 2) * RING_CIRCUMFERENCE;
    const projectile = {
      faction: Faction.Choir,
      targetId: 0,
      ballistic: true,
      flightMode: 'ballistic',
      p: { s: shadowS, z: 0, h: 80 },
      impactS: shadowS + 500,
      impactZ: 0,
    } as Projectile;

    expect(world.isProjectileVisible(Faction.Compact, projectile)).toBe(true);
    expect(world.isEntityVisible(Faction.Compact, source.id)).toBe(false);
  });

  it('[shadow-save-continuation] reconstructs timing and contacts exactly after save/load', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    world.spawnStructure(Faction.Choir, 'silo', 5_000, 0, 1);
    for (let tick = 0; tick < 4_321; tick++) world.step();

    const restored = deserializeWorld(serializeWorld(world), flatTerrain());

    expect(restored.shadowTimingAt(1_234)).toEqual(world.shadowTimingAt(1_234));
    expect(restored.strategicContacts(Faction.Compact)).toEqual(world.strategicContacts(Faction.Compact));
    for (let tick = 0; tick < 60; tick++) {
      world.step();
      restored.step();
      expect(restored.shadowTimingAt(1_234)).toEqual(world.shadowTimingAt(1_234));
    }
  });

  it('[ls09-scope-exclusions] derives shadow and contact state without extending persisted world state', () => {
    const world = emptyWorld();
    const state = world.exportPersistenceState() as unknown as Record<string, unknown>;

    expect(state).not.toHaveProperty('shadowPhase');
    expect(state).not.toHaveProperty('strategicContacts');
    expect(world.status).toBe('running');
    expect(world.winner).toBeNull();
  });
});

function emptyWorld(): World {
  return new World(flatTerrain(), 909);
}

function flatTerrain(): Terrain {
  return {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
}
