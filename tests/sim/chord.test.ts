import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_HEIGHT, RING_CIRCUMFERENCE } from '@core/constants';
import { deltaS } from '@core/ringMath';
import type { Terrain } from '@gen/terrain';
import { Faction, WEAPONS } from '@sim/data';
import { World } from '@sim/world';

describe('chord shots', () => {
  it('is Silo-gated and uses a launch speed that exits the atmosphere', () => {
    const world = emptyWorld(201);
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    const silo = world.spawnStructure(Faction.Compact, 'silo', 300, 0, 1);
    const targetS = RING_CIRCUMFERENCE * 0.5;

    expect(WEAPONS.chordShot.launchSpeed).toBeGreaterThan(280);
    expect(world.previewBallistic(battery.id, targetS, 0, Faction.Compact, 'chordShot')).toBeNull();
    const preview = world.previewBallistic(silo.id, targetS, 0, Faction.Compact, 'chordShot');
    expect(preview).not.toBeNull();
    expect(Math.max(...preview!.map((sample) => sample.h))).toBeGreaterThan(ATMOSPHERE_HEIGHT);
  });

  it('applies deterministic blind-fire spread and becomes globally visible above atmosphere', () => {
    const a = emptyWorld(202);
    const b = emptyWorld(202);
    const siloA = a.spawnStructure(Faction.Compact, 'silo', 0, 0, 1);
    const siloB = b.spawnStructure(Faction.Compact, 'silo', 0, 0, 1);
    const targetS = RING_CIRCUMFERENCE * 0.5;

    expect(a.isVisible(Faction.Compact, targetS, 0)).toBe(false);
    expect(a.fireBallisticAt(siloA.id, targetS, 0, Faction.Compact, 'chordShot')).toBe(true);
    expect(b.fireBallisticAt(siloB.id, targetS, 0, Faction.Compact, 'chordShot')).toBe(true);
    const projectileA = a.projectiles[0]!;
    const projectileB = b.projectiles[0]!;
    expect(projectileA.impactS).toBe(projectileB.impactS);
    expect(projectileA.impactZ).toBe(projectileB.impactZ);
    expect(Math.hypot(deltaS(targetS, projectileA.impactS), projectileA.impactZ)).toBeGreaterThan(0);

    for (let i = 0; i < 3_600 && projectileA.p.h <= ATMOSPHERE_HEIGHT; i++) a.step();
    expect(projectileA.p.h).toBeGreaterThan(ATMOSPHERE_HEIGHT);
    expect(a.isProjectileVisible(Faction.Choir, projectileA)).toBe(true);
  });

  it('allocates one full path while refining chord shots by impact only', () => {
    const world = emptyWorld(205);
    const silo = world.spawnStructure(Faction.Compact, 'silo', 0, 0, 1);

    expect(world.fireBallisticAt(
      silo.id,
      RING_CIRCUMFERENCE * 0.5,
      0,
      Faction.Compact,
      'chordShot',
    )).toBe(true);

    expect(world.ballisticWork.fullTrajectoryBuilds).toBe(1);
    expect(world.ballisticWork.trajectoryEvaluations).toBeGreaterThan(1);
    expect(world.ballisticWork.storedTrajectorySamples).toBeLessThan(
      world.ballisticWork.integrationSteps,
    );
  });

  it('re-enters and applies terminal splash damage at a spotted target', () => {
    const world = emptyWorld(203);
    const silo = world.spawnStructure(Faction.Compact, 'silo', 0, 0, 1);
    const targetS = RING_CIRCUMFERENCE * 0.5;
    world.spawnUnit(Faction.Compact, 'wisp', targetS - 100, 0);
    const target = world.spawnUnit(Faction.Choir, 'vanguard', targetS, 0);
    expect(world.fireBallisticAt(silo.id, targetS, 0, Faction.Compact, 'chordShot')).toBe(true);
    const projectile = world.projectiles[0]!;
    const hp = target.hp;

    for (let i = 0; i < 3_600 && projectile.alive; i++) world.step();
    expect(projectile.alive).toBe(false);
    expect(target.hp).toBeLessThan(hp);
  });

  it('passes terminal point defence so the Silo remains an endgame closer', () => {
    const world = emptyWorld(204);
    const silo = world.spawnStructure(Faction.Compact, 'silo', 0, 0, 1);
    const targetS = RING_CIRCUMFERENCE * 0.5;
    world.spawnStructure(Faction.Choir, 'fusionCore', targetS + 200, 250, 1);
    world.spawnStructure(Faction.Choir, 'pointDefense', targetS + 40, 0, 1);
    world.spawnUnit(Faction.Compact, 'wisp', targetS - 100, 0);
    const target = world.spawnStructure(Faction.Choir, 'bastion', targetS, 0, 1);
    const hp = target.hp;

    expect(world.fireBallisticAt(silo.id, targetS, 0, Faction.Compact, 'chordShot')).toBe(true);
    const projectile = world.projectiles[0]!;
    for (let tick = 0; tick < 3_600 && projectile.alive; tick++) world.step();

    expect(projectile.doomed).toBe(false);
    expect(target.hp).toBeLessThan(hp);
  });
});

function emptyWorld(seed: number): World {
  const terrain = {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  const world = new World(terrain, seed);
  world.spawnStructure(Faction.Compact, 'fusionCore', 200, 300, 1);
  world.spawnStructure(Faction.Compact, 'fusionCore', -200, -300, 1);
  return world;
}
