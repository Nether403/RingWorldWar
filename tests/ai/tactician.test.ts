import { describe, expect, it } from 'vitest';
import { Tactician } from '@ai/tactician';
import type { Terrain } from '@gen/terrain';
import { RING_CIRCUMFERENCE } from '@core/constants';
import { surfaceDist } from '@core/ringMath';
import { Faction, UNITS } from '@sim/data';
import { World, type Projectile } from '@sim/world';

describe('Tactician squad formation', () => {
  it('partitions every alive friendly mech exactly once', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const expected = [
      world.spawnUnit(Faction.Compact, 'vanguard', 100, 0),
      world.spawnUnit(Faction.Compact, 'longbow', 130, 0),
      world.spawnUnit(Faction.Compact, 'wisp', 160, 0),
      world.spawnUnit(Faction.Compact, 'aegis', 190, 0),
      world.spawnUnit(Faction.Compact, 'vanguard', 2_000, 0),
      world.spawnUnit(Faction.Compact, 'longbow', 2_050, 0),
    ];
    world.spawnUnit(Faction.Compact, 'engineer', 120, 20);
    world.spawnUnit(Faction.Choir, 'vanguard', 140, 20);
    const dead = world.spawnUnit(Faction.Compact, 'wisp', 200, 0);
    dead.alive = false;
    const tactician = new Tactician(Faction.Compact, 'veteran');

    const squads = tactician.reformSquads(world);
    const assigned = squads.flatMap((squad) => squad.unitIds);

    expect([...assigned].sort((a, b) => a - b)).toEqual(expected.map((unit) => unit.id));
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(squads.every((squad) => squad.tree !== undefined)).toBe(true);
  });
});

describe('Tactician combat behavior', () => {
  it('assigns one optimized focus-fire target to all healthy squad members', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const own = [
      world.spawnUnit(Faction.Compact, 'vanguard', 100, 0),
      world.spawnUnit(Faction.Compact, 'vanguard', 110, 0),
      world.spawnUnit(Faction.Compact, 'aegis', 120, 0),
    ];
    world.spawnUnit(Faction.Choir, 'wisp', 180, 0);
    const priority = world.spawnUnit(Faction.Choir, 'longbow', 190, 0);
    const tactician = new Tactician(Faction.Compact, 'commander');
    tactician.reformSquads(world);

    tactician.update(world, 1 / 30, 'harass');

    expect(tactician.squads[0]!.targetId).toBe(priority.id);
    expect(own.every((unit) => unit.order.kind === 'attack')).toBe(true);
    expect(own.every((unit) => unit.order.targetId === priority.id)).toBe(true);
  });

  it('does not replace a healthy unit committed to an enemy Bastion attack', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const attacker = world.spawnUnit(Faction.Compact, 'vanguard', 100, 0);
    const bastion = world.spawnStructure(Faction.Choir, 'bastion', 250, 0, 1);
    world.spawnUnit(Faction.Choir, 'longbow', 180, 0);
    attacker.order = { kind: 'attack', s: bastion.s, z: bastion.z, targetId: bastion.id };
    attacker.targetId = bastion.id;
    const tactician = new Tactician(Faction.Compact, 'commander');
    tactician.reformSquads(world);

    tactician.update(world, 1 / 30, 'allIn');

    expect(attacker.order).toMatchObject({ kind: 'attack', targetId: bastion.id });
  });

  it('withdraws low-health members toward a friendly rally without overriding healthy members', () => {
    const world = emptyWorld();
    const home = world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const hurt = world.spawnUnit(Faction.Compact, 'vanguard', 500, 0);
    const healthy = world.spawnUnit(Faction.Compact, 'vanguard', 510, 0);
    hurt.hp = UNITS.vanguard.hp * 0.1;
    const before = surfaceDist(hurt.s, hurt.z, home.s, home.z);
    const tactician = new Tactician(Faction.Compact, 'commander');
    tactician.reformSquads(world);

    tactician.update(world, 1 / 30, 'defend');

    expect(hurt.order.kind).toBe('move');
    expect(surfaceDist(hurt.order.s, hurt.order.z, home.s, home.z)).toBeLessThan(before);
    expect(healthy.order.kind).toBe('idle');
  });

  it('gates incoming-fire dodge behavior to Veteran and Commander', () => {
    const recruitWorld = dodgeWorld();
    const veteranWorld = dodgeWorld();
    const recruitUnit = recruitWorld.units.find((unit) => unit.faction === Faction.Compact)!;
    const veteranUnit = veteranWorld.units.find((unit) => unit.faction === Faction.Compact)!;
    const recruit = new Tactician(Faction.Compact, 'recruit');
    const veteran = new Tactician(Faction.Compact, 'veteran');
    recruit.reformSquads(recruitWorld);
    veteran.reformSquads(veteranWorld);

    recruit.update(recruitWorld, 1 / 30, 'defend');
    veteran.update(veteranWorld, 1 / 30, 'defend');

    expect(recruitUnit.order.kind).toBe('idle');
    expect(veteranUnit.order.kind).toBe('move');
  });

  it('applies the Veteran reaction delay while Commander reacts immediately', () => {
    const veteranWorld = focusWorld();
    const commanderWorld = focusWorld();
    const veteranUnit = veteranWorld.units.find((unit) => unit.faction === Faction.Compact)!;
    const commanderUnit = commanderWorld.units.find((unit) => unit.faction === Faction.Compact)!;
    const veteran = new Tactician(Faction.Compact, 'veteran');
    const commander = new Tactician(Faction.Compact, 'commander');
    veteran.reformSquads(veteranWorld);
    commander.reformSquads(commanderWorld);
    veteran.update(veteranWorld, 0, 'harass');
    commander.update(commanderWorld, 0, 'harass');
    veteranUnit.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };
    commanderUnit.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };

    veteran.update(veteranWorld, 0.79, 'harass');
    commander.update(commanderWorld, 0.01, 'harass');
    expect(veteranUnit.order.kind).toBe('idle');
    expect(commanderUnit.order.kind).toBe('attack');

    veteran.update(veteranWorld, 0.02, 'harass');
    expect(veteranUnit.order.kind).toBe('attack');
  });

  it('gates active-ability coordination to Veteran and Commander', () => {
    const recruitWorld = abilityWorld();
    const veteranWorld = abilityWorld();
    const recruit = new Tactician(Faction.Compact, 'recruit');
    const veteran = new Tactician(Faction.Compact, 'veteran');
    recruit.reformSquads(recruitWorld);
    veteran.reformSquads(veteranWorld);

    recruit.update(recruitWorld, 1 / 30, 'defend');
    veteran.update(veteranWorld, 1 / 30, 'defend');

    expect(recruitWorld.units.find((unit) => unit.kind === 'vanguard')!.ability!.active).toBe(false);
    expect(recruitWorld.units.find((unit) => unit.kind === 'aegis')!.ability!.active).toBe(false);
    expect(veteranWorld.units.find((unit) => unit.kind === 'vanguard')!.ability!.active).toBe(true);
    expect(veteranWorld.units.find((unit) => unit.kind === 'aegis')!.ability!.active).toBe(true);
  });

  it('deploys a Veteran Longbow for a visible target beyond mobile range', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const longbow = world.spawnUnit(Faction.Compact, 'longbow', 0, 0);
    const targetS = Array.from(
      { length: 16 },
      (_, index) => RING_CIRCUMFERENCE - 2_400 - index * 100,
    ).find((s) => world.isBallisticTargetWithinReachEnvelope(
      longbow.id,
      s,
      0,
      Faction.Compact,
      'siegeMortar',
    ));
    expect(targetS).toBeDefined();
    const enemy = world.spawnUnit(Faction.Choir, 'vanguard', targetS!, 0);
    enemy.revealed = 10;
    const tactician = new Tactician(Faction.Compact, 'veteran');
    tactician.reformSquads(world);

    tactician.update(world, 1 / 30, 'harass');

    expect(longbow.ability!.active).toBe(true);
  });

  it('does not deploy, and undeploys, a Longbow when no target is in its ballistic reach envelope', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const longbow = world.spawnUnit(Faction.Compact, 'longbow', 0, 0);
    const enemy = world.spawnUnit(Faction.Choir, 'vanguard', 3_000, 0);
    enemy.revealed = 10;
    world.isBallisticTargetWithinReachEnvelope = () => false;
    const tactician = new Tactician(Faction.Compact, 'veteran');
    tactician.reformSquads(world);

    tactician.update(world, 1 / 30, 'harass');
    expect(longbow.ability!.active).toBe(false);

    longbow.ability!.active = true;
    tactician.update(world, 0.8, 'harass');
    expect(longbow.ability!.active).toBe(false);
  });

  it('positions a Veteran Aegis toward its squad coverage centroid', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    world.spawnUnit(Faction.Compact, 'vanguard', 0, 0);
    const aegis = world.spawnUnit(Faction.Compact, 'aegis', 220, 0);
    const tactician = new Tactician(Faction.Compact, 'veteran');
    tactician.reformSquads(world);

    tactician.update(world, 1 / 30, 'defend');

    expect(aegis.order.kind).toBe('move');
    expect(surfaceDist(aegis.order.s, aegis.order.z, 0, 0)).toBeLessThan(80);
  });
});

function emptyWorld(seed = 31): World {
  const terrain = {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  return new World(terrain, seed);
}

function focusWorld(): World {
  const world = emptyWorld();
  world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
  world.spawnUnit(Faction.Compact, 'vanguard', 100, 0);
  world.spawnUnit(Faction.Choir, 'longbow', 170, 0);
  return world;
}

function dodgeWorld(): World {
  const world = emptyWorld();
  world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
  const unit = world.spawnUnit(Faction.Compact, 'vanguard', 100, 0);
  world.projectiles.push({
    id: 10_000,
    alive: true,
    faction: Faction.Choir,
    st: { X: 0, Y: 0, Z: 0, VX: 0, VY: 0, VZ: 0, t: 0 },
    p: { s: 100, z: 0, h: 100 },
    weapon: 'batteryGun',
    ballistic: true,
    flightMode: 'ballistic',
    targetId: unit.id,
    life: 10,
    impactS: unit.s,
    impactZ: unit.z,
    doomed: false,
    sourceS: 500,
    sourceZ: 0,
  } satisfies Projectile);
  return world;
}

function abilityWorld(): World {
  const world = emptyWorld();
  world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
  world.spawnStructure(Faction.Compact, 'fusionCore', 250, 250, 1);
  const vanguard = world.spawnUnit(Faction.Compact, 'vanguard', 100, 0);
  const aegis = world.spawnUnit(Faction.Compact, 'aegis', 130, 0);
  world.spawnUnit(Faction.Choir, 'vanguard', 180, 0);
  world.projectiles.push({
    id: 10_001,
    alive: true,
    faction: Faction.Choir,
    st: { X: 0, Y: 0, Z: 0, VX: 0, VY: 0, VZ: 0, t: 0 },
    p: { s: 300, z: 0, h: 100 },
    weapon: 'batteryGun',
    ballistic: true,
    flightMode: 'ballistic',
    targetId: vanguard.id,
    life: 10,
    impactS: vanguard.s,
    impactZ: vanguard.z,
    doomed: false,
    sourceS: 500,
    sourceZ: 0,
  } satisfies Projectile);
  void aegis;
  return world;
}
