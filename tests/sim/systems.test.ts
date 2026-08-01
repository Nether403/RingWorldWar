import { describe, expect, it } from 'vitest';
import { AiOpponent } from '@ai/opponent';
import type { Terrain } from '@gen/terrain';
import { Faction, STRUCTURES, UNITS } from '@sim/data';
import { World } from '@sim/world';

describe('economy', () => {
  it('extracts finite salvage from a claimed deposit', () => {
    const world = emptyWorld();
    world.deposits.push({ s: 100, z: 0, amount: 100, claimedBy: 0 });
    world.spawnStructure(Faction.Compact, 'extractor', 100, 0, 1);
    const before = world.players[Faction.Compact].salvage;

    for (let i = 0; i < 30; i++) world.step();

    expect(world.players[Faction.Compact].salvage).toBeGreaterThan(before + 7);
    expect(world.deposits[0]!.amount).toBeLessThan(93);
  });

  it('degrades systems during a brownout without switching them off', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'mechFoundry', 100, 0, 1);
    world.spawnStructure(Faction.Compact, 'rocketBattery', 180, 0, 1);
    world.step();

    expect(world.players[Faction.Compact].energyDrawn).toBeGreaterThan(
      world.players[Faction.Compact].energyProduced,
    );
    expect(world.powerRatio(Faction.Compact)).toBeGreaterThanOrEqual(0.3);
    expect(world.powerRatio(Faction.Compact)).toBeLessThan(1);
  });
});

describe('combat and interception', () => {
  it('admits weapon pulses without overspending and recovers capacity after one second', () => {
    const world = emptyWorld();
    const first = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    const second = world.spawnStructure(Faction.Compact, 'rocketBattery', 30, 0, 1);
    world.spawnStructure(Faction.Compact, 'radarMast', 500, 0, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 200, 300, 1);
    world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);

    expect(world.fireBallisticAt(first.id, 1_000, 0, Faction.Compact, 'cruiseMissile')).toBe(true);
    expect(world.players[Faction.Compact].weaponEnergyLoad).toBe(10);
    expect(world.players[Faction.Compact].energyDrawn).toBeLessThanOrEqual(
      world.players[Faction.Compact].energyProduced,
    );
    const projectileCount = world.projectiles.length;
    expect(world.fireBallisticAt(second.id, 1_000, 0, Faction.Compact, 'cruiseMissile')).toBe(false);
    expect(world.projectiles).toHaveLength(projectileCount);

    for (let tick = 0; tick < 30; tick++) world.step();

    expect(world.players[Faction.Compact].weaponEnergyLoad).toBe(0);
    expect(world.fireBallisticAt(second.id, 1_000, 0, Faction.Compact, 'cruiseMissile')).toBe(true);
  });

  it('applies armor damage and refunds command on death', () => {
    const world = emptyWorld();
    const unit = world.spawnUnit(Faction.Compact, 'wisp', 0, 0);
    expect(world.players[Faction.Compact].commandUsed).toBe(UNITS.wisp.cost.command);

    world.applyDamage(unit.id, 10_000, 'kinetic', Faction.Choir);

    expect(unit.alive).toBe(false);
    expect(world.players[Faction.Compact].commandUsed).toBe(0);
  });

  it('allows point defence to intercept a commanded rocket', () => {
    const world = emptyWorld();
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 200, 300, 1);
    world.spawnUnit(Faction.Compact, 'wisp', 780, 0);
    world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);
    const preview = world.previewBallistic(battery.id, 1_000, 0, Faction.Compact)!;
    const impact = preview[preview.length - 1]!;
    world.spawnStructure(Faction.Choir, 'fusionCore', impact.s + 200, impact.z + 300, 1);
    world.spawnStructure(Faction.Choir, 'pointDefense', impact.s, impact.z, 1);
    expect(world.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact)).toBe(true);

    let intercepted = false;
    for (let i = 0; i < 2_400 && !intercepted; i++) {
      world.step();
      intercepted = world.drainEvents().some((event) => event.kind === 'intercepted');
    }

    expect(intercepted).toBe(true);
  });

  it('lets a mobile Aegis intercept without a ground target', () => {
    const world = emptyWorld();
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 200, 300, 1);
    world.spawnStructure(Faction.Compact, 'radarMast', 500, 0, 1);
    world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);
    const preview = world.previewBallistic(battery.id, 1_000, 0, Faction.Compact)!;
    const impact = preview[preview.length - 1]!;
    const target = world.units.find((unit) => unit.faction === Faction.Choir)!;
    world.spawnUnit(Faction.Choir, 'aegis', impact.s, impact.z);
    world.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact);
    target.alive = false;

    let intercepted = false;
    for (let i = 0; i < 2_400 && !intercepted; i++) {
      world.step();
      intercepted = world.drainEvents().some((event) => event.kind === 'intercepted');
    }

    expect(intercepted).toBe(true);
  });

  it('ticks an idle Aegis interceptor cooldown once per simulation step', () => {
    const world = emptyWorld();
    const aegis = world.spawnUnit(Faction.Compact, 'aegis', 0, 0);
    aegis.cd[1] = 0.7;

    world.step();

    expect(aegis.cd[1]).toBeCloseTo(0.7 - 1 / 30, 8);
  });
});

describe('victory and match flow', () => {
  it('wins immediately when the enemy Bastion is destroyed', () => {
    const world = emptyWorld();
    const compact = world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const choir = world.spawnStructure(Faction.Choir, 'bastion', 10_000, 0, 1);
    world.applyDamage(choir.id, STRUCTURES.bastion.hp * 10, 'explosive', Faction.Compact);

    world.step();

    expect(compact.alive).toBe(true);
    expect(world.status).toBe('completed');
    expect(world.winner).toBe(Faction.Compact);
    expect(world.endReason).toContain('Bastion');
  });

  it('awards simultaneous Bastion destruction to the last aggressor', () => {
    const world = emptyWorld();
    const compact = world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const choir = world.spawnStructure(Faction.Choir, 'bastion', 10_000, 0, 1);
    const unrelated = world.spawnUnit(Faction.Choir, 'engineer', 5_000, 0);
    world.applyDamage(choir.id, STRUCTURES.bastion.hp * 10, 'explosive', Faction.Compact);
    world.applyDamage(compact.id, STRUCTURES.bastion.hp * 10, 'explosive', Faction.Choir);
    world.applyDamage(unrelated.id, 1, 'kinetic', Faction.Compact);

    world.step();

    expect(world.winner).toBe(Faction.Choir);
  });

  it('stops mutating after victory', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    const foundry = world.spawnStructure(Faction.Compact, 'mechFoundry', 200, 0, 1);
    const choir = world.spawnStructure(Faction.Choir, 'bastion', 10_000, 0, 1);
    world.applyDamage(choir.id, STRUCTURES.bastion.hp * 10, 'explosive', Faction.Compact);
    world.step();
    world.players[Faction.Compact].salvage = 10_000;
    const hash = world.stateHash();

    for (let i = 0; i < 30; i++) world.step();

    expect(world.stateHash()).toBe(hash);
    expect(world.tryQueueUnit(foundry.id, 'wisp')).toBe(false);
    expect(world.tryPlaceStructure(Faction.Compact, 'solarArray', 300, 0)).toBeNull();
    world.applyDamage(foundry.id, 100, 'explosive', Faction.Choir);
    expect(world.stateHash()).toBe(hash);
  });

  it('completes an equal-Dominance time cap as a draw and stops all commands', () => {
    const world = emptyWorld(73, 1 / 30);
    const compact = world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    world.spawnStructure(Faction.Choir, 'bastion', 10_000, 0, 1);
    const foundry = world.spawnStructure(Faction.Compact, 'mechFoundry', 200, 0, 1);
    world.players[Faction.Compact].salvage = 10_000;

    world.step();
    const hash = world.stateHash();

    expect(world.status).toBe('completed');
    expect(world.winner).toBeNull();
    expect(world.endReason).toContain('draw');
    expect(world.tryQueueUnit(foundry.id, 'wisp')).toBe(false);
    expect(world.tryPlaceStructure(Faction.Compact, 'solarArray', 300, 0)).toBeNull();
    world.applyDamage(compact.id, 100, 'explosive', Faction.Choir);
    for (let tick = 0; tick < 30; tick++) world.step();
    expect(world.stateHash()).toBe(hash);
  });

  it('resolves a seeded AI match no later than the time cap', () => {
    const timeLimit = 60;
    const world = emptyWorld(72, timeLimit);
    world.setup();
    const compact = new AiOpponent(Faction.Compact, 'commander', 72);
    const choir = new AiOpponent(Faction.Choir, 'commander', 72);
    const maxTicks = Math.ceil(timeLimit * 30) + 1;

    for (let tick = 0; tick < maxTicks && world.status === 'running'; tick++) {
      world.step();
      compact.update(world, 1 / 30);
      choir.update(world, 1 / 30);
      world.drainEvents();
    }

    expect(world.status).toBe('completed');
    expect(world.time).toBeLessThanOrEqual(timeLimit + 1 / 30);
  });
});

function emptyWorld(seed = 7, timeLimit?: number): World {
  const terrain = {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  return new World(terrain, seed, timeLimit);
}
