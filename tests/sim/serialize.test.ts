import {
  AiOpponent,
  MAX_BALLISTIC_PLAN_RETRY_TICKS,
  MAX_FAILED_BALLISTIC_PLANS,
} from '@ai/opponent';
import { SIM_DT } from '@core/constants';
import type { Terrain } from '@gen/terrain';
import { Faction } from '@sim/data';
import {
  createWorldSnapshot,
  deserializeWorld,
  loadWorldSnapshot,
  serializeWorld,
  SnapshotValidationError,
} from '@sim/serialize';
import { World } from '@sim/world';
import {
  createMatchSessionSnapshot,
  deserializeMatchSession,
  matchSessionStateHash,
  parseMatchSessionSnapshot,
  serializeMatchSession,
} from '@headless/session';
import { describe, expect, it } from 'vitest';

const terrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  isBuildable: () => true,
} as unknown as Terrain;

describe('world snapshots', () => {
  it('round-trips every authoritative world field into JSON-safe data', () => {
    const world = createWorld(81);
    world.players[Faction.Compact].unlocked.add('fabricator');
    const vanguard = world.spawnUnit(Faction.Compact, 'vanguard', 120, 0);
    vanguard.ability!.active = true;
    vanguard.stationaryTime = 0.75;
    world.step();
    world.drainEvents();

    const snapshot = createWorldSnapshot(world);
    const json = serializeWorld(world);
    const restored = new World(terrain, 999);
    loadWorldSnapshot(restored, json);

    expect(snapshot.schema).toBe('ring-world-war/world');
    expect(snapshot.version).toBe(1);
    expect(snapshot.world.worldSeed).toBe(81);
    expect(snapshot.world.terrainSeed).toBe(81);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(restored.stateHash()).toBe(world.stateHash());
    expect(restored.worldSeed).toBe(81);
    expect(restored.terrainSeed).toBe(81);
    expect(restored.players[Faction.Compact].unlocked).toBeInstanceOf(Set);
    expect(restored.players[Faction.Compact].unlocked.has('fabricator')).toBe(true);
    expect(restored.events).toEqual([]);
  });

  it('rejects version mismatches and malformed nested state without mutating the target', () => {
    const world = createWorld(82);
    for (let tick = 0; tick < 30; tick++) world.step();
    world.drainEvents();
    const before = world.stateHash();
    const wrongVersion: unknown = { ...createWorldSnapshot(world), version: 2 };
    const malformed = JSON.parse(serializeWorld(world)) as {
      world: { units: Array<{ cd: unknown }> };
    };
    malformed.world.units[0]!.cd = [0, 'not-a-number'];

    expect(() => loadWorldSnapshot(world, wrongVersion)).toThrow(SnapshotValidationError);
    expect(world.stateHash()).toBe(before);
    expect(() => loadWorldSnapshot(world, malformed)).toThrow(SnapshotValidationError);
    expect(world.stateHash()).toBe(before);
  });

  it('rejects oversized authoritative arrays before nested expansion', () => {
    const world = createWorld(821);
    const oversizedUnits = createWorldSnapshot(world) as unknown as { world: { units: unknown[] } };
    oversizedUnits.world.units = Array.from({ length: 513 }, () => oversizedUnits.world.units[0]);
    expect(() => loadWorldSnapshot(world, oversizedUnits)).toThrow(/units.*at most 512/i);

    const oversizedQueue = createWorldSnapshot(world) as unknown as {
      world: { structures: Array<{ queue: unknown[] }> };
    };
    oversizedQueue.world.structures[0]!.queue = Array.from({ length: 129 }, () => 'engineer');
    expect(() => loadWorldSnapshot(world, oversizedQueue)).toThrow(/queue.*at most 128/i);
  });

  it('validates both persisted seeds', () => {
    const world = createWorld(85);
    const invalidWorldSeed = createWorldSnapshot(world) as unknown as {
      world: { worldSeed: unknown };
    };
    invalidWorldSeed.world.worldSeed = 1.5;
    const invalidTerrainSeed = createWorldSnapshot(world) as unknown as {
      world: { terrainSeed: unknown };
    };
    invalidTerrainSeed.world.terrainSeed = '85';

    expect(() => loadWorldSnapshot(world, invalidWorldSeed)).toThrow(SnapshotValidationError);
    expect(() => loadWorldSnapshot(world, invalidTerrainSeed)).toThrow(SnapshotValidationError);
  });

  it('rejects a different supplied terrain seed before mutating a loaded world', () => {
    const savedTerrain = seededTerrain(91);
    const world = new World(savedTerrain, 81);
    world.setup();
    world.step();
    const serialized = serializeWorld(world);
    const mismatchedTerrain = seededTerrain(92);
    const target = new World(mismatchedTerrain, 81);
    target.setup();
    target.players[Faction.Compact].salvage = 17;
    const before = target.stateHash();

    expect(() => deserializeWorld(serialized, mismatchedTerrain)).toThrow(SnapshotValidationError);
    expect(() => loadWorldSnapshot(target, serialized)).toThrow(SnapshotValidationError);
    expect(target.stateHash()).toBe(before);
  });

  it('round-trips a completed Dominance draw without treating it as running', () => {
    const world = new World(terrain, 84, 1 / 30);
    world.spawnStructure(Faction.Compact, 'bastion', 0, 0, 1);
    world.spawnStructure(Faction.Choir, 'bastion', 10_000, 0, 1);
    world.step();

    const restored = deserializeWorld(serializeWorld(world), terrain);

    expect(world.status).toBe('completed');
    expect(world.winner).toBeNull();
    expect(restored.status).toBe('completed');
    expect(restored.winner).toBeNull();
    expect(restored.stateHash()).toBe(world.stateHash());
  });

  it('persists weapon pulse load and its deterministic recovery schedule', () => {
    const world = new World(terrain, 86);
    const battery = world.spawnStructure(Faction.Compact, 'rocketBattery', 0, 0, 1);
    world.spawnStructure(Faction.Compact, 'fusionCore', 250, 300, 1);
    world.spawnStructure(Faction.Compact, 'radarMast', 500, 0, 1);
    world.spawnUnit(Faction.Choir, 'vanguard', 1_000, 0);
    expect(world.fireBallisticAt(battery.id, 1_000, 0, Faction.Compact, 'cruiseMissile')).toBe(true);

    const restored = deserializeWorld(serializeWorld(world), terrain);

    expect(restored.players[Faction.Compact].weaponEnergyLoad).toBe(10);
    expect(restored.stateHash()).toBe(world.stateHash());
    for (let tick = 0; tick < 30; tick++) {
      world.step();
      restored.step();
      expect(restored.stateHash()).toBe(world.stateHash());
    }
    expect(restored.players[Faction.Compact].weaponEnergyLoad).toBe(0);
  });
});

describe('match-session snapshots', () => {
  it('rejects oversized controller squad arrays before nested expansion', () => {
    const world = createWorld(961);
    const controllers = [
      new AiOpponent(Faction.Compact, 'veteran', 1961),
      new AiOpponent(Faction.Choir, 'veteran', 2961),
    ] as const;
    const snapshot = createMatchSessionSnapshot(world, controllers) as unknown as {
      controllers: Array<{ tactician: { squads: unknown[] } }>;
    };
    snapshot.controllers[0]!.tactician.squads = Array.from({ length: 257 }, () => ({
      id: 1, unitIds: [], rallyPoint: { s: 0, z: 0 }, targetId: 0,
    }));
    expect(() => parseMatchSessionSnapshot(snapshot)).toThrow(/squads.*at most 256/i);
  });
  it('rejects alive enemy and non-mech squad unit references', () => {
    const world = new World(terrain, 96);
    const friendlyMech = world.spawnUnit(Faction.Compact, 'vanguard', 100, 0);
    const enemyMech = world.spawnUnit(Faction.Choir, 'vanguard', 140, 0);
    const engineer = world.spawnUnit(Faction.Compact, 'engineer', 180, 0);
    const controllers = [
      new AiOpponent(Faction.Compact, 'veteran', 196),
      new AiOpponent(Faction.Choir, 'veteran', 296),
    ] as const;
    controllers[0].tactician.reformSquads(world);

    const enemyReference = createMatchSessionSnapshot(world, controllers) as unknown as {
      controllers: Array<{ tactician: { squads: Array<{ unitIds: number[] }> } }>;
    };
    enemyReference.controllers[0]!.tactician.squads[0]!.unitIds = [friendlyMech.id, enemyMech.id];
    expect(() => parseMatchSessionSnapshot(enemyReference)).toThrow('existing alive unit must be a friendly mech');

    const engineerReference = createMatchSessionSnapshot(world, controllers) as unknown as {
      controllers: Array<{ tactician: { squads: Array<{ unitIds: number[] }> } }>;
    };
    engineerReference.controllers[0]!.tactician.squads[0]!.unitIds = [friendlyMech.id, engineer.id];
    expect(() => parseMatchSessionSnapshot(engineerReference)).toThrow('existing alive unit must be a friendly mech');

    enemyMech.alive = false;
    const staleReferences = createMatchSessionSnapshot(world, controllers) as unknown as {
      controllers: Array<{ tactician: { squads: Array<{ unitIds: number[] }> } }>;
    };
    staleReferences.controllers[0]!.tactician.squads[0]!.unitIds = [enemyMech.id, 999_999];
    expect(() => parseMatchSessionSnapshot(staleReferences)).not.toThrow();
  });

  it('deeply validates artillery reveal tracking against controller units', () => {
    const world = new World(terrain, 92);
    const longbow = world.spawnUnit(Faction.Compact, 'longbow', 120, 0);
    longbow.revealed = 1;
    const controllers = [
      new AiOpponent(Faction.Compact, 'veteran', 192),
      new AiOpponent(Faction.Choir, 'veteran', 292),
    ] as const;
    controllers[0].update(world, SIM_DT);

    const duplicate = createMatchSessionSnapshot(world, controllers) as unknown as {
      controllers: Array<{ artilleryRevealTracking: unknown }>;
    };
    duplicate.controllers[0]!.artilleryRevealTracking = [
      { unitId: longbow.id },
      { unitId: longbow.id },
    ];
    expect(() => parseMatchSessionSnapshot(duplicate)).toThrow('duplicate unit ids');

    const wrongKind = world.spawnUnit(Faction.Compact, 'vanguard', 150, 0);
    const nonArtillery = createMatchSessionSnapshot(world, controllers) as unknown as {
      controllers: Array<{ artilleryRevealTracking: unknown }>;
    };
    nonArtillery.controllers[0]!.artilleryRevealTracking = [{ unitId: wrongKind.id }];
    expect(() => parseMatchSessionSnapshot(nonArtillery)).toThrow('alive friendly Longbow');

    const wrongFaction = world.spawnUnit(Faction.Choir, 'longbow', 180, 0);
    const enemyArtillery = createMatchSessionSnapshot(world, controllers) as unknown as {
      controllers: Array<{ artilleryRevealTracking: unknown }>;
    };
    enemyArtillery.controllers[0]!.artilleryRevealTracking = [{ unitId: wrongFaction.id }];
    expect(() => parseMatchSessionSnapshot(enemyArtillery)).toThrow('alive friendly Longbow');
  });

  it('deeply validates bounded failed ballistic plan state', () => {
    const world = createWorld(88);
    const controllers = [
      new AiOpponent(Faction.Compact, 'veteran', 188),
      new AiOpponent(Faction.Choir, 'veteran', 288),
    ] as const;
    const plan = {
      sourceId: 1,
      targetId: 2,
      weaponId: 'batteryGun',
      deltaSCell: -3,
      deltaZCell: 4,
      failureCount: 1,
      retryAtTick: 900,
    };
    const malformed = createMatchSessionSnapshot(world, controllers) as unknown as {
      controllers: Array<{ failedBallisticPlans: unknown }>;
    };
    malformed.controllers[0]!.failedBallisticPlans = [{ ...plan, retryAtTick: -1 }];
    expect(() => parseMatchSessionSnapshot(malformed)).toThrow('retryAtTick');

    const permanent = createMatchSessionSnapshot(world, controllers) as unknown as {
      controllers: Array<{ failedBallisticPlans: unknown }>;
    };
    permanent.controllers[0]!.failedBallisticPlans = [{
      ...plan,
      retryAtTick: world.tick + MAX_BALLISTIC_PLAN_RETRY_TICKS + 1,
    }];
    expect(() => parseMatchSessionSnapshot(permanent)).toThrow('retryAtTick');

    const duplicate = createMatchSessionSnapshot(world, controllers) as unknown as {
      controllers: Array<{ failedBallisticPlans: unknown }>;
    };
    duplicate.controllers[0]!.failedBallisticPlans = [{ ...plan }, { ...plan }];
    expect(() => parseMatchSessionSnapshot(duplicate)).toThrow('contains duplicate plan keys');

    const oversized = createMatchSessionSnapshot(world, controllers) as unknown as {
      controllers: Array<{ failedBallisticPlans: unknown }>;
    };
    oversized.controllers[0]!.failedBallisticPlans = Array.from(
      { length: MAX_FAILED_BALLISTIC_PLANS + 1 },
      (_, index) => ({ ...plan, targetId: index + 1 }),
    );
    expect(() => parseMatchSessionSnapshot(oversized)).toThrow(
      `expected at most ${MAX_FAILED_BALLISTIC_PLANS} entries`,
    );
  });

  it('preserves failed ballistic planning decisions on every tick after restore', () => {
    const world = new World(terrain, 87, 60);
    world.spawnStructure(Faction.Choir, 'rocketBattery', 0, 0, 1);
    world.spawnStructure(Faction.Choir, 'radarMast', 0, 0, 1);
    const highValue = world.spawnStructure(Faction.Compact, 'fusionCore', 500, 0, 1);
    const fallback = world.spawnUnit(Faction.Compact, 'engineer', 650, 0);
    const controllers = [
      new AiOpponent(Faction.Compact, 'veteran', 187),
      new AiOpponent(Faction.Choir, 'veteran', 287),
    ] as const;
    const failedAttempts: number[] = [];
    world.fireBallisticAt = (_sourceId, targetS) => {
      failedAttempts.push(targetS);
      return false;
    };

    controllers[1].update(world, 1 / 30);
    expect(failedAttempts).toEqual([highValue.s]);

    const snapshot = createMatchSessionSnapshot(world, controllers);
    expect(snapshot.controllers[1].failedBallisticPlans).toHaveLength(1);
    const restored = deserializeMatchSession(JSON.stringify(snapshot), terrain);

    for (let tick = 0; tick < 4; tick++) {
      const originalDecisions: number[] = [];
      const restoredDecisions: number[] = [];
      world.fireBallisticAt = (_sourceId, targetS) => {
        originalDecisions.push(targetS);
        return targetS === fallback.s;
      };
      restored.world.fireBallisticAt = (_sourceId, targetS) => {
        restoredDecisions.push(targetS);
        return targetS === fallback.s;
      };

      runTicks(world, controllers, 1, 1.5);
      runTicks(restored.world, restored.controllers, 1, 1.5);

      expect(restoredDecisions).toEqual(originalDecisions);
      expect(matchSessionStateHash(restored.world, restored.controllers)).toBe(
        matchSessionStateHash(world, controllers),
      );
    }
  });

  it('preserves pending artillery reveal tracking and reposition decisions through expiry', () => {
    const world = new World(terrain, 93);
    const longbow = world.spawnUnit(Faction.Choir, 'longbow', 1_000, 200);
    longbow.revealed = SIM_DT * 5;
    const controllers = [
      new AiOpponent(Faction.Compact, 'recruit', 193),
      new AiOpponent(Faction.Choir, 'veteran', 293),
    ] as const;
    controllers[1].update(world, SIM_DT);
    longbow.order = { kind: 'idle', s: 0, z: 0, targetId: 0 };

    const snapshot = createMatchSessionSnapshot(world, controllers);
    expect(snapshot.controllers[1].artilleryRevealTracking).toEqual([{ unitId: longbow.id }]);
    const untrackedController = AiOpponent.fromPersistenceState({
      ...controllers[1].exportPersistenceState(),
      artilleryRevealTracking: [],
    });
    expect(matchSessionStateHash(world, [controllers[0], untrackedController])).not.toBe(
      matchSessionStateHash(world, controllers),
    );
    const restored = deserializeMatchSession(JSON.stringify(snapshot), terrain);
    expect(matchSessionStateHash(restored.world, restored.controllers)).toBe(
      matchSessionStateHash(world, controllers),
    );

    let sawReposition = false;
    for (let tick = 0; tick < 12; tick++) {
      runTicks(world, controllers, 1);
      runTicks(restored.world, restored.controllers, 1);
      const restoredLongbow = restored.world.units.find((unit) => unit.id === longbow.id)!;
      expect(restoredLongbow.order).toEqual(longbow.order);
      expect(restored.controllers[1].exportPersistenceState().artilleryRevealTracking).toEqual(
        controllers[1].exportPersistenceState().artilleryRevealTracking,
      );
      expect(matchSessionStateHash(restored.world, restored.controllers)).toBe(
        matchSessionStateHash(world, controllers),
      );
      sawReposition ||= longbow.revealed === 0 && longbow.order.kind === 'move';
    }
    expect(sawReposition).toBe(true);
  });

  it('cleans reveal tracking for dead and non-Longbow units on the next AI tick', () => {
    const deadWorld = new World(terrain, 94);
    const deadLongbow = deadWorld.spawnUnit(Faction.Compact, 'longbow', 100, 0);
    deadLongbow.revealed = 1;
    const deadOpponent = new AiOpponent(Faction.Compact, 'veteran', 194);
    deadOpponent.update(deadWorld, SIM_DT);
    deadLongbow.alive = false;

    deadOpponent.update(deadWorld, SIM_DT);
    expect(deadOpponent.exportPersistenceState().artilleryRevealTracking).toEqual([]);

    const changedWorld = new World(terrain, 95);
    const changedLongbow = changedWorld.spawnUnit(Faction.Compact, 'longbow', 100, 0);
    changedLongbow.revealed = 1;
    const changedOpponent = new AiOpponent(Faction.Compact, 'veteran', 195);
    changedOpponent.update(changedWorld, SIM_DT);
    changedLongbow.kind = 'vanguard';

    changedOpponent.update(changedWorld, SIM_DT);
    expect(changedOpponent.exportPersistenceState().artilleryRevealTracking).toEqual([]);
  });

  it('continues world and AI state deterministically after restore', () => {
    const world = createWorld(83);
    world.spawnUnit(Faction.Compact, 'vanguard', 120, 0);
    world.spawnUnit(Faction.Choir, 'longbow', 190, 0);
    const controllers = [
      new AiOpponent(Faction.Compact, 'veteran', 183),
      new AiOpponent(Faction.Choir, 'commander', 283),
    ] as const;

    runTicks(world, controllers, 240);
    const snapshot = createMatchSessionSnapshot(world, controllers);
    const serialized = serializeMatchSession(world, controllers);
    const restored = deserializeMatchSession(serialized, terrain);

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(matchSessionStateHash(restored.world, restored.controllers)).toBe(
      matchSessionStateHash(world, controllers),
    );

    for (let tick = 0; tick < 900; tick++) {
      runTicks(world, controllers, 1);
      runTicks(restored.world, restored.controllers, 1);
      expect(matchSessionStateHash(restored.world, restored.controllers)).toBe(
        matchSessionStateHash(world, controllers),
      );
    }
  }, 15_000);
});

function createWorld(seed: number): World {
  const world = new World(terrain, seed);
  world.setup();
  return world;
}

function runTicks(
  world: World,
  controllers: readonly [AiOpponent, AiOpponent],
  count: number,
  controllerDt = 1 / 30,
): void {
  for (let tick = 0; tick < count && world.status === 'running'; tick++) {
    world.step();
    for (const controller of controllers) controller.update(world, controllerDt);
    world.drainEvents();
  }
}

function seededTerrain(seed: number): Terrain {
  return {
    seed,
    heightAt: () => 0,
    slopeAt: () => 0,
    isBuildable: () => true,
  } as unknown as Terrain;
}
