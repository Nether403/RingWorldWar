import { describe, expect, it } from 'vitest';
import type { Terrain } from '@gen/terrain';
import { Faction, WEAPONS } from '@sim/data';
import { World } from '@sim/world';

describe('cruise missiles and laser grids', () => {
  it('uses explicit cruise selection, follows terrain, and applies splash damage', () => {
    const world = rollingWorld();
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 250, 300, 1);
    world.spawnUnit(Faction.Compact, 'wisp', 780, 0);
    const target = world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);
    const preview = world.previewBallistic(battery.id, target.s, target.z, Faction.Compact, 'cruiseMissile');

    expect(preview).not.toBeNull();
    expect(
      preview!.every((sample) => sample.h - world.terrain.heightAt(sample.s, sample.z) <= 50 + 1e-8),
    ).toBe(true);
    expect(world.fireBallisticAt(battery.id, target.s, target.z, Faction.Compact, 'cruiseMissile')).toBe(true);
    const projectile = world.projectiles.find((candidate) => candidate.weapon === 'cruiseMissile')!;
    expect(projectile.flightMode).toBe('cruise');

    const hp = target.hp;
    for (let i = 0; i < 1_200 && projectile.alive; i++) {
      world.step();
      if (projectile.alive) {
        expect(
          projectile.p.h - world.terrain.heightAt(projectile.p.s, projectile.p.z),
        ).toBeLessThanOrEqual(WEAPONS.cruiseMissile.cruiseAltitude! + 1e-8);
      }
    }
    expect(target.hp).toBeLessThan(hp);
  });

  it('leaves cruise missiles immune to laser grids but vulnerable to point defense', () => {
    const laserWorld = rollingWorld();
    const battery = laserWorld.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    laserWorld.spawnStructure(Faction.Compact, 'fusionCore', 250, 300, 1);
    laserWorld.spawnUnit(Faction.Compact, 'wisp', 780, 0);
    laserWorld.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);
    laserWorld.spawnStructure(Faction.Choir, 'fusionCore', 500, 300, 1);
    laserWorld.spawnStructure(Faction.Choir, 'laserGrid', 500, 0, 1);
    expect(laserWorld.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact, 'cruiseMissile')).toBe(true);
    const cruise = laserWorld.projectiles.find((candidate) => candidate.weapon === 'cruiseMissile')!;

    let gridIntercepted = false;
    for (let i = 0; i < 1_200 && cruise.alive; i++) {
      laserWorld.step();
      gridIntercepted ||= laserWorld.drainEvents().some((event) => event.kind === 'intercepted');
    }
    expect(gridIntercepted).toBe(false);

    const pdWorld = rollingWorld();
    const pdBattery = pdWorld.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    pdWorld.spawnStructure(Faction.Compact, 'fusionCore', 250, 300, 1);
    pdWorld.spawnUnit(Faction.Compact, 'wisp', 780, 0);
    pdWorld.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);
    pdWorld.spawnStructure(Faction.Choir, 'fusionCore', 1_250, 300, 1);
    pdWorld.spawnStructure(Faction.Choir, 'pointDefense', 1_000, 0, 1);
    expect(pdWorld.fireBallisticAt(pdBattery.id, 1_000, 0, Faction.Compact, 'cruiseMissile')).toBe(true);

    let pdIntercepted = false;
    for (let i = 0; i < 1_200 && !pdIntercepted; i++) {
      pdWorld.step();
      pdIntercepted = pdWorld.drainEvents().some((event) => event.kind === 'intercepted');
    }
    expect(pdIntercepted).toBe(true);
  });

  it('intercepts standard ballistic fire in a powered grid arc with cooldown saturation', () => {
    const world = rollingWorld();
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    const secondBattery = world.spawnStructure(Faction.Compact, 'rocketBattery', 30, 0, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 250, 300, 1);
    world.spawnUnit(Faction.Compact, 'wisp', 780, 0);
    world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);
    world.spawnStructure(Faction.Choir, 'fusionCore', 500, 300, 1);
    const grid = world.spawnStructure(Faction.Choir, 'laserGrid', 500, 0, 1);
    expect(world.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact, 'batteryGun')).toBe(true);
    expect(world.fireBallisticAt(secondBattery.id, 1_000, 0, Faction.Compact, 'batteryGun')).toBe(true);

    let intercepted = false;
    for (let i = 0; i < 2_400 && !intercepted; i++) {
      world.step();
      intercepted = world.drainEvents().some((event) => event.kind === 'intercepted');
    }
    expect(intercepted).toBe(true);
    expect(grid.cd[0]).toBeGreaterThan(0);
    expect(world.projectiles.filter((projectile) => projectile.alive && projectile.weapon === 'batteryGun')).toHaveLength(1);
  });

  it('does not let a brownout laser grid intercept', () => {
    const world = rollingWorld();
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 250, 300, 1);
    world.spawnUnit(Faction.Compact, 'wisp', 780, 0);
    world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);
    world.spawnStructure(Faction.Choir, 'laserGrid', 500, 0, 1);
    world.spawnStructure(Faction.Choir, 'mechFoundry', 1_500, 500, 1);
    expect(world.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact, 'batteryGun')).toBe(true);

    let intercepted = false;
    for (let i = 0; i < 2_400 && world.projectiles.some((projectile) => projectile.alive); i++) {
      world.step();
      intercepted ||= world.drainEvents().some((event) => event.kind === 'intercepted');
    }
    expect(world.powerRatio(Faction.Choir)).toBeLessThan(WEAPONS.gridLaser.minPowerRatio!);
    expect(intercepted).toBe(false);
  });
});

function rollingWorld(): World {
  const terrain = {
    heightAt: (s: number) => 12 + Math.sin(s / 90) * 12,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  return new World(terrain, 104);
}
