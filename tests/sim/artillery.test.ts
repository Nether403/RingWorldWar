import { describe, expect, it } from 'vitest';
import { RING_CIRCUMFERENCE, RING_HALF_WIDTH, SIM_DT } from '@core/constants';
import { deltaS, surfaceDist } from '@core/ringMath';
import type { Terrain } from '@gen/terrain';
import { Faction } from '@sim/data';
import { World } from '@sim/world';

describe('commanded artillery', () => {
  it('reports every authoritative fire-command outcome with actionable details', () => {
    const ended = battlefield();
    ended.status = 'completed';
    expect(ended.fireBallisticCommand(999, 1_000, 0, Faction.Compact)).toEqual({
      ok: false,
      reason: 'match-ended',
      targetS: 1_000,
      targetZ: 0,
    });

    const invalid = battlefield();
    expect(invalid.fireBallisticCommand(999, 1_000, 0, Faction.Compact)).toEqual({
      ok: false,
      reason: 'invalid-source',
      targetS: 1_000,
      targetZ: 0,
    });
    const enemyBattery = invalid.spawnStructure(Faction.Choir, 'rocketBattery', 0, 0, 1);
    expect(invalid.fireBallisticCommand(enemyBattery.id, 1_000, 0, Faction.Compact)).toEqual({
      ok: false,
      reason: 'invalid-source',
      targetS: 1_000,
      targetZ: 0,
    });

    const undeployed = battlefield();
    const undeployedLongbow = undeployed.spawnUnit(Faction.Compact, 'longbow', 0, 0);
    expect(undeployed.fireBallisticCommand(
      undeployedLongbow.id,
      1_000,
      0,
      Faction.Compact,
      'siegeMortar',
    ).reason).toBe('longbow-not-deployed');
    expect(undeployed.activateAbility(undeployedLongbow.id)).toBe(true);
    expect(undeployed.fireBallisticCommand(
      undeployedLongbow.id,
      1_000,
      0,
      Faction.Compact,
      'siegeMortar',
    )).toMatchObject({
      ok: false,
      reason: 'longbow-transitioning',
      remainingSeconds: 3,
    });

    const reloading = battlefield();
    const reloadingBattery = reloading.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    reloading.spawnStructure(Faction.Compact, 'radarMast', 500, 0, 1);
    reloadingBattery.cd[0] = 3.2;
    expect(reloading.fireBallisticCommand(reloadingBattery.id, 1_000, 0, Faction.Compact)).toMatchObject({
      ok: false,
      reason: 'reloading',
      remainingSeconds: 3.2,
      sensorCoverage: true,
      exactLineOfSight: true,
    });

    const noPower = new World(flatTerrain(), 31);
    const unpoweredBattery = noPower.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    expect(noPower.fireBallisticCommand(unpoweredBattery.id, 1_000, 0, Faction.Compact)).toMatchObject({
      ok: false,
      reason: 'insufficient-power',
      requiredPower: 6,
      availablePower: 0,
    });

    const noSensor = battlefield();
    const blindBattery = noSensor.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    expect(noSensor.fireBallisticCommand(blindBattery.id, 1_000, 0, Faction.Compact)).toMatchObject({
      ok: false,
      reason: 'outside-sensor-range',
      sensorCoverage: false,
      exactLineOfSight: false,
    });

    const ridgeTerrain = {
      heightAt: (s: number) => (s > 44 && s < 58 ? 100 : 0),
      slopeAt: () => 0,
      isBuildable: () => true,
    } as unknown as Terrain;
    const blocked = new World(ridgeTerrain, 32);
    blocked.spawnStructure(Faction.Compact, 'fusionCore', 0, 300, 1);
    const blockedBattery = blocked.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    blocked.spawnUnit(Faction.Compact, 'wisp', 0, 0);
    expect(blocked.fireBallisticCommand(blockedBattery.id, 100, 0, Faction.Compact)).toMatchObject({
      ok: false,
      reason: 'sensor-los-blocked',
      sensorCoverage: true,
      exactLineOfSight: false,
    });

    const wallTerrain = {
      heightAt: (s: number) => (s > 100 && s < 900 ? 7_000 : 0),
      slopeAt: () => 0,
      isBuildable: () => true,
    } as unknown as Terrain;
    const unreachable = new World(wallTerrain, 33);
    unreachable.spawnStructure(Faction.Compact, 'fusionCore', 0, 300, 1);
    const unreachableBattery = unreachable.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    unreachable.spawnUnit(Faction.Compact, 'wisp', 1_000, 0);
    expect(unreachable.fireBallisticCommand(
      unreachableBattery.id,
      1_000,
      0,
      Faction.Compact,
    )).toMatchObject({
      ok: false,
      reason: 'no-ballistic-solution',
      sensorCoverage: true,
      exactLineOfSight: true,
    });

    const success = battlefield();
    const readyBattery = success.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    success.spawnStructure(Faction.Compact, 'radarMast', 500, 0, 1);
    expect(success.fireBallisticCommand(readyBattery.id, 1_000, 0, Faction.Compact)).toMatchObject({
      ok: true,
      reason: 'success',
      sensorCoverage: true,
      exactLineOfSight: true,
    });
  });

  it('does not consume RNG, power, cooldown, or projectiles for a blocked command', () => {
    const world = new World(flatTerrain(), 34);
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    const rng = world.rng.snapshot();
    const load = world.players[Faction.Compact].weaponEnergyLoad;

    expect(world.fireBallisticCommand(battery.id, 1_000, 0, Faction.Compact).reason)
      .toBe('insufficient-power');

    expect(world.rng.snapshot()).toBe(rng);
    expect(world.players[Faction.Compact].weaponEnergyLoad).toBe(load);
    expect(battery.cd[0]).toBe(0);
    expect(world.projectiles).toHaveLength(0);
  });

  it('normalizes public ballistic targets before assessment, planning, and commit', () => {
    const sampled: Array<{ s: number; z: number }> = [];
    const terrain = {
      heightAt: (s: number, z: number) => {
        sampled.push({ s, z });
        if (s === RING_CIRCUMFERENCE + 1_000 || z === RING_HALF_WIDTH + 999) {
          throw new Error(`unnormalized terrain sample: ${s},${z}`);
        }
        return 0;
      },
      slopeAt: () => 0,
      isBuildable: () => true,
    } as unknown as Terrain;
    const world = new World(terrain, 341);
    const normalizedZ = RING_HALF_WIDTH - 40;
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, normalizedZ, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 0, normalizedZ, 1);
    const sensorTargets: Array<{ s: number; z: number }> = [];
    world.sensorStatusAt = (_faction, s, z) => {
      sensorTargets.push({ s, z });
      return { nominal: true, exactLineOfSight: true };
    };
    const rawS = RING_CIRCUMFERENCE + 1_000;
    const rawZ = RING_HALF_WIDTH + 999;
    const expectedTarget = { targetS: 1_000, targetZ: normalizedZ };

    expect(world.preflightBallisticCommand(battery.id, rawS, rawZ, Faction.Compact))
      .toMatchObject(expectedTarget);
    expect(world.queryBallisticCommand(battery.id, rawS, rawZ, Faction.Compact))
      .toMatchObject(expectedTarget);
    const inspection = world.inspectBallisticCommand(battery.id, rawS, rawZ, Faction.Compact);
    expect(inspection.result).toMatchObject({ ok: true, ...expectedTarget });
    const preview = world.previewBallistic(battery.id, rawS, rawZ, Faction.Compact);
    expect(preview?.length).toBeGreaterThan(2);
    expect(surfaceDist(preview!.at(-1)!.s, preview!.at(-1)!.z, 1_000, normalizedZ)).toBeLessThan(2);
    expect(world.isBallisticTargetWithinReachEnvelope(battery.id, rawS, rawZ, Faction.Compact)).toBe(true);
    expect(world.fireBallisticCommand(battery.id, rawS, rawZ, Faction.Compact))
      .toMatchObject({ ok: true, ...expectedTarget });
    const projectile = world.projectiles.find((candidate) => candidate.ballistic)!;
    expect(surfaceDist(projectile.impactS, projectile.impactZ, 1_000, normalizedZ)).toBeLessThan(2);

    expect(sensorTargets.length).toBeGreaterThan(0);
    expect(sensorTargets.every(({ s, z }) => s === 1_000 && z === normalizedZ)).toBe(true);
    expect(sampled.length).toBeGreaterThan(0);
  });

  it('reports normalized rejected targets without command side effects', () => {
    const world = battlefield();
    const rng = world.rng.snapshot();
    const load = world.players[Faction.Compact].weaponEnergyLoad;
    const rawS = -RING_CIRCUMFERENCE + 75;
    const rawZ = -RING_HALF_WIDTH - 500;

    expect(world.fireBallisticCommand(999_999, rawS, rawZ, Faction.Compact)).toEqual({
      ok: false,
      reason: 'invalid-source',
      targetS: 75,
      targetZ: -RING_HALF_WIDTH + 40,
    });
    expect(world.rng.snapshot()).toBe(rng);
    expect(world.players[Faction.Compact].weaponEnergyLoad).toBe(load);
    expect(world.projectiles).toHaveLength(0);
  });

  it('separates cheap nominal sensor coverage from exact terrain line of sight', () => {
    const terrain = {
      heightAt: (s: number) => (s > 44 && s < 58 ? 100 : 0),
      slopeAt: () => 0,
      isBuildable: () => true,
    } as unknown as Terrain;
    const world = new World(terrain, 35);
    const scout = world.spawnUnit(Faction.Compact, 'wisp', 0, 0);

    expect(world.effectiveSensorRange(scout.id, Faction.Compact)).toBe(520);
    expect(world.sensorStatusAt(Faction.Compact, 100, 0)).toEqual({
      nominal: true,
      exactLineOfSight: false,
    });
    expect(world.sensorStatusAt(Faction.Compact, 1_000, 0)).toEqual({
      nominal: false,
      exactLineOfSight: false,
    });
  });

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

  it('retains only one canonical full path for each drag solve', () => {
    const world = battlefield();
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    world.spawnStructure(Faction.Compact, 'radarMast', 500, 0, 1);
    world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);

    expect(world.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact)).toBe(true);

    expect(world.ballisticWork.fullTrajectoryBuilds).toBe(1);
    expect(world.ballisticWork.trajectoryEvaluations).toBeGreaterThan(1);
    expect(world.ballisticWork.storedTrajectorySamples).toBeGreaterThan(1);
    expect(world.ballisticWork.storedTrajectorySamples).toBeLessThan(
      world.ballisticWork.integrationSteps,
    );
  });

  it('does no additional trajectory work for an identical failed geometry', () => {
    const terrain = {
      heightAt: (s: number) => s > 100 && s < 900 ? 7_000 : 0,
      slopeAt: () => 0,
      isBuildable: () => true,
    } as unknown as Terrain;
    const world = new World(terrain, 29);
    world.spawnStructure(Faction.Compact, 'fusionCore', 0, -200, 1);
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    world.spawnUnit(Faction.Compact, 'wisp', 1_000, 0);
    world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0).revealed = 30;

    expect(world.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact)).toBe(false);
    const evaluations = world.ballisticWork.trajectoryEvaluations;
    expect(evaluations).toBeGreaterThan(0);

    expect(world.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact)).toBe(false);
    expect(world.ballisticWork.trajectoryEvaluations).toBe(evaluations);
    expect(world.ballisticWork.failedPlanCacheHits).toBe(1);
  });

  it('refreshes dynamic fire authority without repeating trajectory work', () => {
    const world = battlefield();
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    const sensor = world.spawnUnit(Faction.Compact, 'wisp', 500, 0);
    const targetS = 1_000;

    const inspection = world.inspectBallisticCommand(battery.id, targetS, 0, Faction.Compact);
    expect(inspection.result).toMatchObject({
      ok: true,
      reason: 'success',
      targetS,
      targetZ: 0,
    });
    expect(inspection.trajectory?.length).toBeGreaterThan(2);
    const evaluations = world.ballisticWork.trajectoryEvaluations;

    battery.cd[0] = 3.2;
    expect(world.preflightBallisticCommand(battery.id, targetS, 0, Faction.Compact)).toMatchObject({
      ok: false,
      reason: 'reloading',
      remainingSeconds: 3.2,
      targetS,
      targetZ: 0,
    });

    battery.cd[0] = 0;
    const core = world.structures.find(
      (structure) => structure.alive && structure.faction === Faction.Compact && structure.kind === 'fusionCore',
    )!;
    core.alive = false;
    expect(world.preflightBallisticCommand(battery.id, targetS, 0, Faction.Compact).reason)
      .toBe('insufficient-power');

    core.alive = true;
    sensor.alive = false;
    expect(world.preflightBallisticCommand(battery.id, targetS, 0, Faction.Compact).reason)
      .toBe('outside-sensor-range');

    sensor.alive = true;
    const cover = world.spawnUnit(Faction.Choir, 'vanguard', 750, 0);
    world.applyDamage(cover.id, 100_000, 'explosive', Faction.Compact);
    expect(world.preflightBallisticCommand(battery.id, targetS, 0, Faction.Compact).reason)
      .toBe('sensor-los-blocked');

    world.wreckages[0]!.alive = false;
    expect(world.preflightBallisticCommand(battery.id, targetS, 0, Faction.Compact)).toMatchObject({
      ok: true,
      reason: 'success',
      targetS,
      targetZ: 0,
    });
    expect(world.ballisticWork.trajectoryEvaluations).toBe(evaluations);
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

  it('exposes a Longbow ground-target command only after siege deployment completes', () => {
    const world = battlefield();
    const longbow = world.spawnUnit(Faction.Compact, 'longbow', 0, 0);

    expect(world.canCommandBallistic(longbow.id, Faction.Compact, 'siegeMortar')).toBe(false);
    expect(world.activateAbility(longbow.id)).toBe(true);
    expect(world.canCommandBallistic(longbow.id, Faction.Compact, 'siegeMortar')).toBe(false);
    for (let tick = 0; tick < 91; tick++) world.step();
    expect(world.canCommandBallistic(longbow.id, Faction.Compact, 'siegeMortar')).toBe(true);

    expect(world.activateAbility(longbow.id, false)).toBe(true);
    expect(world.canCommandBallistic(longbow.id, Faction.Compact, 'siegeMortar')).toBe(false);
  });

  it('enforces Longbow siege deployment in the authoritative ground-command APIs', () => {
    const world = battlefield();
    const longbow = world.spawnUnit(Faction.Compact, 'longbow', 0, 0);
    world.spawnStructure(Faction.Compact, 'radarMast', 500, 0, 1);

    expect(world.previewBallistic(longbow.id, 1_000, 0, Faction.Compact, 'siegeMortar')).not.toBeNull();
    expect(world.fireBallisticAt(longbow.id, 1_000, 0, Faction.Compact, 'siegeMortar')).toBe(false);

    expect(world.activateAbility(longbow.id)).toBe(true);
    expect(world.previewBallistic(longbow.id, 1_000, 0, Faction.Compact, 'siegeMortar')).not.toBeNull();
    expect(world.fireBallisticAt(longbow.id, 1_000, 0, Faction.Compact, 'siegeMortar')).toBe(false);

    for (let tick = 0; tick < 91; tick++) world.step();
    expect(world.previewBallistic(longbow.id, 1_000, 0, Faction.Compact, 'siegeMortar')).not.toBeNull();
    expect(world.fireBallisticAt(longbow.id, 1_000, 0, Faction.Compact, 'siegeMortar')).toBe(true);
  });

  it('rejects a Longbow deactivated after an earlier authority check', () => {
    const world = battlefield();
    const longbow = world.spawnUnit(Faction.Compact, 'longbow', 0, 0);
    world.spawnStructure(Faction.Compact, 'radarMast', 500, 0, 1);
    expect(world.activateAbility(longbow.id)).toBe(true);
    for (let tick = 0; tick < 91; tick++) world.step();

    expect(world.canCommandBallistic(longbow.id, Faction.Compact, 'siegeMortar')).toBe(true);
    expect(world.activateAbility(longbow.id, false)).toBe(true);
    expect(world.fireBallisticAt(longbow.id, 1_000, 0, Faction.Compact, 'siegeMortar')).toBe(false);
  });

  it('keeps structure artillery available through the command boundary', () => {
    const world = battlefield();
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    world.spawnStructure(Faction.Compact, 'radarMast', 500, 0, 1);

    expect(world.previewBallistic(battery.id, 1_000, 0, Faction.Compact)).not.toBeNull();
    expect(world.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact)).toBe(true);
  });
});

function battlefield(): World {
  const world = new World(flatTerrain(), 19);
  world.spawnStructure(Faction.Compact, 'bastion', 20_000, -1_500, 1);
  world.spawnStructure(Faction.Choir, 'bastion', 10_000, 1_500, 1);
  world.spawnStructure(Faction.Compact, 'fusionCore', 19_700, -1_200, 1);
  return world;
}

function flatTerrain(): Terrain {
  return {
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
}
