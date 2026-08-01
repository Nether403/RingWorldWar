import { describe, expect, it } from 'vitest';
import { RING_CIRCUMFERENCE, SIM_DT } from '@core/constants';
import { deltaS, surfaceDist } from '@core/ringMath';
import type { Terrain } from '@gen/terrain';
import { Faction } from '@sim/data';
import { World } from '@sim/world';

describe('commanded artillery', () => {
  it('does not let the player rocket battery auto-fire', () => {
    const world = battlefield();
    world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    world.spawnStructure(Faction.Compact, 'radarMast', 500, 0, 1);
    world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);

    world.step();

    expect(world.projectiles.some((projectile) => projectile.ballistic)).toBe(false);
  });

  it('uses the preview path for the live projectile', () => {
    const world = battlefield();
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    world.spawnStructure(Faction.Compact, 'radarMast', 500, 0, 1);
    const target = world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);
    const preview = world.previewBallistic(battery.id, 1_000, 0, Faction.Compact);

    expect(preview).not.toBeNull();
    const impact = preview![preview!.length - 1]!;
    expect(surfaceDist(impact.s, impact.z, target.s, target.z)).toBeLessThan(2);
    expect(world.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact)).toBe(true);

    const projectile = world.projectiles.find((candidate) => candidate.ballistic)!;
    for (let step = 1; step <= 12; step++) {
      world.step();
      expect(Math.abs(deltaS(projectile.p.s, preview![step]!.s))).toBeLessThan(0.05);
      expect(Math.abs(projectile.p.h - preview![step]!.h)).toBeLessThan(0.05);
      expect(Math.abs(projectile.p.z - preview![step]!.z)).toBeLessThan(0.05);
    }
    expect(preview![1]!.t).toBeCloseTo(SIM_DT, 8);

    const hpBeforeImpact = target.hp;
    for (let step = 0; step < 2_400 && projectile.alive; step++) world.step();
    expect(target.hp).toBeLessThan(hpBeforeImpact);
  });

  it('solves the implemented long-range antispinward direction with drag', () => {
    const world = battlefield();
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    const targetS = RING_CIRCUMFERENCE - 1_800;
    world.spawnStructure(Faction.Compact, 'radarMast', RING_CIRCUMFERENCE - 1_500, 0, 1);
    world.spawnUnit(Faction.Choir, 'vanguard', targetS, 0);

    const preview = world.previewBallistic(battery.id, targetS, 0, Faction.Compact);
    expect(preview).not.toBeNull();
    const impact = preview![preview!.length - 1]!;
    expect(surfaceDist(impact.s, impact.z, targetS, 0)).toBeLessThan(2);
  });

  it('rejects a target that has not been spotted', () => {
    const world = battlefield();
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);

    expect(world.previewBallistic(battery.id, 1_000, 0, Faction.Compact)).toBeNull();
    expect(world.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact)).toBe(false);
  });

  it('keeps mobile artillery advancing until its trajectory is directionally reachable', () => {
    const world = battlefield();
    const longbow = world.spawnUnit(Faction.Compact, 'longbow', 0, 0);
    const targetS = [600, 900, 1_200, 1_500, 1_800, 2_100, 2_400].find(
      (candidate) => !world.isBallisticTargetWithinReachEnvelope(
        longbow.id,
        candidate,
        0,
        Faction.Compact,
        'siegeMortar',
      ),
    );
    expect(targetS).toBeDefined();
    const target = world.spawnUnit(Faction.Choir, 'vanguard', targetS!, 0);
    target.revealed = 30;
    longbow.order = { kind: 'attack', s: target.s, z: target.z, targetId: target.id };

    const start = longbow.s;
    for (let tick = 0; tick < 30; tick++) world.step();

    expect(surfaceDist(start, 0, longbow.s, longbow.z)).toBeGreaterThan(0.5);
    expect(world.projectiles.some((projectile) => projectile.weapon === 'siegeMortar')).toBe(false);
  });
});

function battlefield(): World {
  const terrain = {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
  const world = new World(terrain, 19);
  world.spawnStructure(Faction.Compact, 'bastion', 20_000, -1_500, 1);
  world.spawnStructure(Faction.Choir, 'bastion', 10_000, 1_500, 1);
  world.spawnStructure(Faction.Compact, 'fusionCore', 19_700, -1_200, 1);
  return world;
}
