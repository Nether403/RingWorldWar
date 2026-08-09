import { describe, expect, it } from 'vitest';
import { deltaS, surfaceDist } from '@core/ringMath';
import type { Terrain } from '@gen/terrain';
import { Faction } from '@sim/data';
import type { SimEvent } from '@sim/world';
import { createRuntimeScenarioWorld } from '../../src/scenario/worldFactory';
import {
  GRAVITY_RANGE_SCENARIO,
  resolveGravityRangeBindings,
} from '../../src/arcade/gravityRangeScenario';
import { GravityRangeController } from '../../src/arcade/gravityRange';

const terrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  isBuildable: () => true,
} as unknown as Terrain;

describe('Gravity Range', () => {
  it('[gravity-range-setup] creates a deterministic, AI-free production range with canonical fire authority', () => {
    const created = createRuntimeScenarioWorld(terrain, GRAVITY_RANGE_SCENARIO);
    const bindings = resolveGravityRangeBindings(created.bindings);
    const launcher = created.world.structureById(bindings.launcherId)!;
    const spinward = created.world.structureById(bindings.spinwardTargetId)!;
    const antispinward = created.world.structureById(bindings.antispinwardTargetId)!;

    expect(GRAVITY_RANGE_SCENARIO.id).toBe('gravity-range');
    expect(created.ai.enabled).toBe(false);
    expect(launcher.kind).toBe('rocketBattery');
    expect(deltaS(launcher.s, spinward.s)).toBe(800);
    expect(deltaS(launcher.s, antispinward.s)).toBe(-1_800);
    expect(created.world.preflightBallisticCommand(
      launcher.id,
      spinward.s,
      spinward.z,
      Faction.Compact,
      'batteryGun',
    )).toMatchObject({ ok: true, reason: 'success' });
    expect(created.world.preflightBallisticCommand(
      launcher.id,
      antispinward.s,
      antispinward.z,
      Faction.Compact,
      'batteryGun',
    )).toMatchObject({ ok: true, reason: 'success' });

    const replay = createRuntimeScenarioWorld(terrain, GRAVITY_RANGE_SCENARIO);
    expect(replay.world.exportPersistenceState()).toEqual(created.world.exportPersistenceState());
    expect([...replay.bindings]).toEqual([...created.bindings]);
  });

  it('[gravity-range-loop] advances only on authoritative impacts and completes the directional exercise', () => {
    const created = createRuntimeScenarioWorld(terrain, GRAVITY_RANGE_SCENARIO);
    const bindings = resolveGravityRangeBindings(created.bindings);
    const controller = new GravityRangeController(created.world, Faction.Compact, bindings);
    const launcher = created.world.structureById(bindings.launcherId)!;
    const spinward = created.world.structureById(bindings.spinwardTargetId)!;
    const antispinward = created.world.structureById(bindings.antispinwardTargetId)!;

    expect(controller.model).toMatchObject({
      status: 'active',
      stage: 'spinward',
      completedImpacts: 0,
      totalImpacts: 2,
      directionLabel: 'Spinward',
      distanceMeters: 800,
    });
    controller.observe([impact(spinward.s + 200, spinward.z, Faction.Compact)]);
    expect(controller.model.stage).toBe('spinward');

    expect(created.world.fireBallisticCommand(
      launcher.id,
      spinward.s,
      spinward.z,
      Faction.Compact,
      'batteryGun',
    ).ok).toBe(true);
    runUntilImpact(created.world, controller, spinward.s, spinward.z);
    expect(controller.model).toMatchObject({
      status: 'active',
      stage: 'antispinward',
      completedImpacts: 1,
      directionLabel: 'Antispinward',
      distanceMeters: 1_800,
    });

    runUntilReady(created.world, launcher.id);
    expect(created.world.fireBallisticCommand(
      launcher.id,
      antispinward.s,
      antispinward.z,
      Faction.Compact,
      'batteryGun',
    ).ok).toBe(true);
    runUntilImpact(created.world, controller, antispinward.s, antispinward.z);
    expect(controller.model).toMatchObject({
      status: 'completed',
      stage: 'complete',
      completedImpacts: 2,
      totalImpacts: 2,
    });
  });

  it('[gravity-range-authority] binds scoring to launcher projectiles and survives missing marker entities', () => {
    const created = createRuntimeScenarioWorld(terrain, GRAVITY_RANGE_SCENARIO);
    const bindings = resolveGravityRangeBindings(created.bindings);
    const controller = new GravityRangeController(created.world, Faction.Compact, bindings);
    const spinward = created.world.structureById(bindings.spinwardTargetId)!;
    const antispinward = created.world.structureById(bindings.antispinwardTargetId)!;

    controller.observe([impact(spinward.s, spinward.z, Faction.Compact, 1)]);
    controller.observe([
      fired(bindings.launcherId + 1, 2),
      impact(spinward.s, spinward.z, Faction.Compact, 2),
      fired(bindings.launcherId, 3, Faction.Compact, 'cruiseMissile'),
      impact(spinward.s, spinward.z, Faction.Compact, 3, 'cruiseMissile'),
      fired(bindings.launcherId, 4),
      impact(antispinward.s, antispinward.z, Faction.Compact, 4),
    ]);
    expect(controller.model.stage).toBe('spinward');

    controller.observe([fired(bindings.launcherId, 7)]);
    spinward.alive = false;
    expect(() => controller.observe([
      fired(bindings.launcherId, 5),
      impact(spinward.s, spinward.z, Faction.Compact, 5),
    ])).not.toThrow();
    expect(controller.model.stage).toBe('antispinward');
    expect(controller.currentTarget).toEqual({ s: antispinward.s, z: antispinward.z });

    controller.observe([impact(antispinward.s, antispinward.z, Faction.Compact, 7)]);
    expect(controller.model.stage).toBe('antispinward');

    antispinward.alive = false;
    expect(() => controller.observe([
      fired(bindings.launcherId, 6),
      impact(antispinward.s, antispinward.z, Faction.Compact, 6),
    ])).not.toThrow();
    expect(controller.model.stage).toBe('complete');
    expect(controller.currentTarget).toBeNull();
  });
});

function fired(
  sourceId: number,
  projectileId: number,
  faction = Faction.Compact,
  weapon = 'batteryGun',
): SimEvent {
  return {
    kind: 'weaponFired',
    s: 4_000,
    z: 0,
    h: 0,
    faction,
    scale: 1,
    id: sourceId,
    weapon,
    projectileId,
  };
}

function impact(
  s: number,
  z: number,
  faction: Faction,
  projectileId = 99_001,
  weapon = 'batteryGun',
): SimEvent {
  return {
    kind: 'impact' as const,
    s,
    z,
    h: 0,
    faction,
    scale: 1,
    id: projectileId,
    weapon,
  };
}

function runUntilImpact(
  world: ReturnType<typeof createRuntimeScenarioWorld>['world'],
  controller: GravityRangeController,
  targetS: number,
  targetZ: number,
): void {
  for (let tick = 0; tick < 2_400; tick++) {
    world.step();
    const events = world.drainEvents();
    controller.observe(events);
    if (events.some((event) =>
      event.kind === 'impact' && surfaceDist(event.s, event.z, targetS, targetZ) <= 60)) return;
  }
  throw new Error('Gravity Range projectile did not impact');
}

function runUntilReady(
  world: ReturnType<typeof createRuntimeScenarioWorld>['world'],
  launcherId: number,
): void {
  for (let tick = 0; tick < 600; tick++) {
    if ((world.structureById(launcherId)?.cd[0] ?? Infinity) <= 0) return;
    world.step();
    world.drainEvents();
  }
  throw new Error('Gravity Range launcher did not reload');
}
