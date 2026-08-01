import { describe, expect, it } from 'vitest';
import type { Terrain } from '@gen/terrain';
import { Faction } from '@sim/data';
import { World, type Projectile } from '@sim/world';

describe('authoritative vision', () => {
  it('prevents artillery from acquiring an unspotted target', () => {
    const world = battlefield();
    const artillery = world.spawnUnit(Faction.Compact, 'longbow', 0, 0);
    const enemy = world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);

    world.step();

    expect(world.isEntityVisible(Faction.Compact, enemy.id)).toBe(false);
    expect(artillery.targetId).toBe(0);
    expect(world.projectiles.some((projectile) => projectile.ballistic)).toBe(false);
  });

  it('allows artillery to fire when a scout spots the target', () => {
    const world = battlefield();
    const artillery = world.spawnUnit(Faction.Compact, 'longbow', 0, 0);
    const enemy = world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);
    world.spawnUnit(Faction.Compact, 'wisp', 780, 0);

    world.step();

    expect(world.isEntityVisible(Faction.Compact, enemy.id)).toBe(true);
    expect(artillery.targetId).toBe(enemy.id);
    expect(world.projectiles.some((projectile) => projectile.ballistic)).toBe(true);
  });

  it('reveals an artillery unit after it fires and hides it again after the flash', () => {
    const world = battlefield();
    const enemy = world.spawnStructure(Faction.Choir, 'rocketBattery', 1_000, 0, 1);
    world.spawnStructure(Faction.Choir, 'radarMast', 500, 0, 1);
    world.spawnUnit(Faction.Compact, 'vanguard', 0, 0);

    expect(world.isEntityVisible(Faction.Compact, enemy.id)).toBe(false);
    expect(world.fireBallisticAt(enemy.id, 0, 0, Faction.Choir)).toBe(true);
    expect(world.isEntityVisible(Faction.Compact, enemy.id)).toBe(true);
    for (let i = 0; i < 190; i++) world.step();
    expect(world.isEntityVisible(Faction.Compact, enemy.id)).toBe(false);
  });

  it('blocks sight across a narrow terrain ridge', () => {
    const terrain = {
      heightAt: (s: number) => (s > 44 && s < 58 ? 100 : 0),
      slopeAt: () => 0,
      isBuildable: () => true,
    } as unknown as Terrain;
    const world = new World(terrain, 92);
    world.spawnUnit(Faction.Compact, 'wisp', 0, 0);
    const enemy = world.spawnUnit(Faction.Choir, 'vanguard', 100, 0);

    expect(world.isEntityVisible(Faction.Compact, enemy.id)).toBe(false);
  });

  it('does not expose hidden enemy projectiles through presentation', () => {
    const world = battlefield();
    const source = world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);
    const projectile = {
      faction: Faction.Choir,
      targetId: 0,
      ballistic: false,
      p: { s: 1_000, z: 0, h: 10 },
      impactS: 1_050,
      impactZ: 0,
    } as Projectile;

    expect(world.isProjectileVisible(Faction.Compact, projectile)).toBe(false);
    source.revealed = 1;
    projectile.targetId = source.id;
    expect(world.isProjectileVisible(Faction.Compact, projectile)).toBe(true);
  });
});

function battlefield(): World {
  const terrain = {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  const world = new World(terrain, 91);
  world.spawnStructure(Faction.Compact, 'bastion', 20_000, -1_500, 1);
  world.spawnStructure(Faction.Choir, 'bastion', 10_000, 1_500, 1);
  return world;
}
