import { describe, expect, it } from 'vitest';
import type { Terrain } from '@gen/terrain';
import { ABILITIES } from '@sim/abilities';
import { DAMAGE_TABLE, Faction } from '@sim/data';
import { World } from '@sim/world';

describe('mech abilities', () => {
  it('reduces shield-wall damage only inside the forward arc without compounding speed', () => {
    const world = emptyWorld();
    world.spawnStructure(Faction.Compact, 'fusionCore', 300, 0, 1);
    const vanguard = world.spawnUnit(Faction.Compact, 'vanguard', 0, 0);

    expect(world.activateAbility(vanguard.id)).toBe(true);
    vanguard.order = { kind: 'move', s: 500, z: 0, targetId: 0 };
    for (let i = 0; i < 30; i++) world.step();
    expect(vanguard.speedMultiplier).toBe(ABILITIES.shieldWall.speedMultiplier);

    const beforeFront = vanguard.hp;
    world.applyDamage(vanguard.id, 100, 'kinetic', Faction.Choir, { s: 50, z: 0 });
    expect(beforeFront - vanguard.hp).toBeCloseTo(
      100 * DAMAGE_TABLE.kinetic.heavy * ABILITIES.shieldWall.damageMultiplier,
    );

    const beforeRear = vanguard.hp;
    world.applyDamage(vanguard.id, 100, 'kinetic', Faction.Choir, { s: -50, z: 0 });
    expect(beforeRear - vanguard.hp).toBeCloseTo(100 * DAMAGE_TABLE.kinetic.heavy);
  });

  it('immobilizes siege mode, changes range and cooldown, and retains the undeploy transition', () => {
    const world = emptyWorld();
    const longbow = world.spawnUnit(Faction.Compact, 'longbow', 0, 0);
    const baseRange = world.effectiveWeaponRange(longbow.id, 'siegeMortar');
    const baseCooldown = world.effectiveWeaponCooldown(longbow.id, 'siegeMortar');

    expect(world.activateAbility(longbow.id)).toBe(true);
    expect(world.effectiveWeaponRange(longbow.id, 'siegeMortar')).toBeCloseTo(
      baseRange * ABILITIES.siegeMode.rangeMultiplier,
    );
    expect(world.effectiveWeaponCooldown(longbow.id, 'siegeMortar')).toBeCloseTo(
      baseCooldown / ABILITIES.siegeMode.fireRateMultiplier,
    );
    longbow.order = { kind: 'move', s: 500, z: 0, targetId: 0 };
    world.step();
    expect(longbow.s).toBe(0);
    expect(longbow.speed).toBe(0);

    expect(world.activateAbility(longbow.id, false)).toBe(true);
    for (let i = 0; i < 89; i++) world.step();
    expect(longbow.s).toBe(0);
    world.step();
    world.step();
    expect(longbow.s).toBeGreaterThan(0);
  });

  it('cloaks a stationary Wisp, reveals it in proximity, and breaks cloak on movement', () => {
    const world = emptyWorld();
    const wisp = world.spawnUnit(Faction.Compact, 'wisp', 0, 0);
    wisp.cd[0] = 999;
    world.spawnStructure(Faction.Choir, 'radarMast', 100, 0, 1);

    for (let i = 0; i < 46; i++) world.step();
    expect(wisp.cloaked).toBe(true);
    expect(world.isEntityVisible(Faction.Choir, wisp.id)).toBe(false);

    const detector = world.spawnUnit(Faction.Choir, 'engineer', 29, 0);
    expect(world.isEntityVisible(Faction.Choir, wisp.id)).toBe(true);
    detector.alive = false;
    wisp.order = { kind: 'move', s: 200, z: 0, targetId: 0 };
    world.step();
    expect(wisp.cloaked).toBe(false);
    expect(wisp.revealed).toBeGreaterThan(0);
  });

  it('breaks Wisp cloak in the same tick that it fires', () => {
    const world = emptyWorld();
    const wisp = world.spawnUnit(Faction.Compact, 'wisp', 0, 0);
    wisp.cd[0] = 999;
    world.spawnUnit(Faction.Choir, 'vanguard', 100, 0);
    for (let i = 0; i < 46; i++) world.step();
    expect(wisp.cloaked).toBe(true);

    wisp.cd[0] = 0;
    world.step();
    expect(wisp.cloaked).toBe(false);
    expect(wisp.revealed).toBeGreaterThan(0);
  });

  it('adds Umbrella as rate draw and deactivates it when production becomes insufficient', () => {
    const world = emptyWorld();
    const core = world.spawnStructure(Faction.Compact, 'fusionCore', 300, 0, 1);
    const aegis = world.spawnUnit(Faction.Compact, 'aegis', 0, 0);

    expect(world.activateAbility(aegis.id)).toBe(true);
    world.step();
    expect(world.players[Faction.Compact].energyDrawn).toBeGreaterThanOrEqual(
      ABILITIES.umbrella.energyPerSecond,
    );

    world.applyDamage(core.id, 100_000, 'explosive', Faction.Choir);
    world.step();
    expect(aegis.ability!.active).toBe(false);
    expect(aegis.ability!.cooldown).toBeGreaterThan(0);
  });

  it('intercepts a projectile aimed at an ally inside the active Umbrella', () => {
    const world = emptyWorld();
    const battery = world.spawnStructure(Faction.Choir, 'rocketBattery', 0, 0, 1);
    world.spawnStructure(Faction.Choir, 'fusionCore', 250, 300, 1);
    world.spawnStructure(Faction.Choir, 'radarMast', 600, 0, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 1_300, 300, 1);
    const aegis = world.spawnUnit(Faction.Compact, 'aegis', 900, 0);
    world.spawnUnit(Faction.Compact, 'vanguard', 1_000, 0);
    expect(world.activateAbility(aegis.id)).toBe(true);
    expect(world.fireBallisticAt(battery.id, 1_000, 0, Faction.Choir)).toBe(true);

    let intercepted = false;
    for (let i = 0; i < 2_400 && !intercepted; i++) {
      world.step();
      intercepted = world.drainEvents().some((event) => event.kind === 'intercepted');
    }
    expect(intercepted).toBe(true);
  });
});

function emptyWorld(): World {
  const terrain = {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  return new World(terrain, 102);
}
