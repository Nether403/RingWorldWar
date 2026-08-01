import {
  AiOpponent,
  type AiOpponentPersistenceState,
  type ArtilleryRevealTrackingState,
  type Difficulty,
  type FailedBallisticPlanState,
  type GoalScore,
  MAX_BALLISTIC_PLAN_FAILURE_COUNT,
  MAX_BALLISTIC_PLAN_RETRY_TICKS,
  MAX_FAILED_BALLISTIC_PLANS,
  type StrategicGoal,
} from '@ai/opponent';
import type { TacticianPersistenceState } from '@ai/tactician';
import type { Terrain } from '@gen/terrain';
import { Faction, UNITS } from '@sim/data';
import {
  createWorldSnapshot,
  deserializeWorld,
  parseWorldSnapshot,
  SnapshotValidationError,
  type WorldSnapshot,
} from '@sim/serialize';
import type { Unit, World, WorldPersistenceState } from '@sim/world';

export const MATCH_SESSION_SCHEMA = 'ring-world-war/match-session';
export const MATCH_SESSION_VERSION = 1;

export interface MatchSessionSnapshot {
  schema: typeof MATCH_SESSION_SCHEMA;
  version: typeof MATCH_SESSION_VERSION;
  world: WorldSnapshot;
  controllers: [AiOpponentPersistenceState, AiOpponentPersistenceState];
}

export interface MatchSession {
  world: World;
  controllers: [AiOpponent, AiOpponent];
}

export function createMatchSessionSnapshot(
  world: World,
  controllers: readonly [AiOpponent, AiOpponent],
): MatchSessionSnapshot {
  return {
    schema: MATCH_SESSION_SCHEMA,
    version: MATCH_SESSION_VERSION,
    world: createWorldSnapshot(world),
    controllers: [controllers[0].exportPersistenceState(), controllers[1].exportPersistenceState()],
  };
}

export function serializeMatchSession(
  world: World,
  controllers: readonly [AiOpponent, AiOpponent],
): string {
  return JSON.stringify(createMatchSessionSnapshot(world, controllers));
}

export function parseMatchSessionSnapshot(input: unknown): MatchSessionSnapshot {
  const value = typeof input === 'string' ? parseJson(input) : input;
  const root = readObject(value, '$', ['schema', 'version', 'world', 'controllers']);
  if (root.schema !== MATCH_SESSION_SCHEMA) fail('$.schema', `expected ${MATCH_SESSION_SCHEMA}`);
  if (root.version !== MATCH_SESSION_VERSION) fail('$.version', `expected version ${MATCH_SESSION_VERSION}`);
  const controllerValues = readArray(root.controllers, '$.controllers');
  if (controllerValues.length !== 2) fail('$.controllers', 'expected exactly two controllers');
  const world = parseWorldSnapshot(root.world);
  const controllers: [AiOpponentPersistenceState, AiOpponentPersistenceState] = [
    readController(controllerValues[0], '$.controllers[0]', world.world),
    readController(controllerValues[1], '$.controllers[1]', world.world),
  ];
  if (controllers[0].faction === controllers[1].faction) {
    fail('$.controllers', 'controller factions must be distinct');
  }
  return {
    schema: MATCH_SESSION_SCHEMA,
    version: MATCH_SESSION_VERSION,
    world,
    controllers,
  };
}

export function deserializeMatchSession(input: unknown, terrain: Terrain): MatchSession {
  const snapshot = parseMatchSessionSnapshot(input);
  return {
    world: deserializeWorld(snapshot.world, terrain),
    controllers: [
      AiOpponent.fromPersistenceState(snapshot.controllers[0]),
      AiOpponent.fromPersistenceState(snapshot.controllers[1]),
    ],
  };
}

export function matchSessionStateHash(
  world: World,
  controllers: readonly [AiOpponent, AiOpponent],
): string {
  const state = JSON.stringify(createMatchSessionSnapshot(world, controllers));
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < state.length; index++) {
    hash ^= state.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function readController(value: unknown, path: string, world: WorldPersistenceState): AiOpponentPersistenceState {
  const controller = readObject(value, path, [
    'faction',
    'difficulty',
    'rngState',
    'activeGoal',
    'lastGoalScores',
    'strategyTimer',
    'pushTarget',
    'regroupUntil',
    'artilleryRevealTracking',
    'failedBallisticPlans',
    'tactician',
  ]);
  const controllerFaction = readFaction(controller.faction, `${path}.faction`);
  const controllerDifficulty = readDifficulty(controller.difficulty, `${path}.difficulty`);
  const scores = readArray(controller.lastGoalScores, `${path}.lastGoalScores`).map((score, index) =>
    readGoalScore(score, `${path}.lastGoalScores[${index}]`));
  const pushTarget = controller.pushTarget === null
    ? null
    : readPoint(controller.pushTarget, `${path}.pushTarget`);
  const failedBallisticPlans = readFailedBallisticPlans(
    controller.failedBallisticPlans,
    `${path}.failedBallisticPlans`,
    world.tick,
  );
  const artilleryRevealTracking = readArtilleryRevealTracking(
    controller.artilleryRevealTracking,
    `${path}.artilleryRevealTracking`,
    controllerFaction,
    world.units,
  );
  const tactician = readTactician(
    controller.tactician,
    `${path}.tactician`,
    controllerFaction,
    world.units,
  );
  if (tactician.faction !== controllerFaction || tactician.difficulty !== controllerDifficulty) {
    fail(`${path}.tactician`, 'does not match its controller');
  }
  return {
    faction: controllerFaction,
    difficulty: controllerDifficulty,
    rngState: readInteger(controller.rngState, `${path}.rngState`, 0, 0xffffffff),
    activeGoal: readGoal(controller.activeGoal, `${path}.activeGoal`),
    lastGoalScores: scores,
    strategyTimer: readFinite(controller.strategyTimer, `${path}.strategyTimer`),
    pushTarget,
    regroupUntil: readFinite(controller.regroupUntil, `${path}.regroupUntil`, 0),
    artilleryRevealTracking,
    failedBallisticPlans,
    tactician,
  };
}

function readArtilleryRevealTracking(
  value: unknown,
  path: string,
  faction: Faction,
  units: readonly Unit[],
): ArtilleryRevealTrackingState[] {
  const tracked = readArray(value, path).map((value, index) => {
    const entryPath = `${path}[${index}]`;
    const entry = readObject(value, entryPath, ['unitId']);
    return { unitId: readInteger(entry.unitId, `${entryPath}.unitId`, 1) };
  });
  if (new Set(tracked.map((entry) => entry.unitId)).size !== tracked.length) {
    fail(path, 'contains duplicate unit ids');
  }
  for (let index = 0; index < tracked.length; index++) {
    const entry = tracked[index]!;
    const unit = units.find((candidate) => candidate.id === entry.unitId);
    if (!unit?.alive || unit.faction !== faction || unit.kind !== 'longbow') {
      fail(`${path}[${index}].unitId`, 'must reference an alive friendly Longbow');
    }
  }
  return tracked;
}

function readFailedBallisticPlans(
  value: unknown,
  path: string,
  worldTick: number,
): FailedBallisticPlanState[] {
  const values = readArray(value, path);
  if (values.length > MAX_FAILED_BALLISTIC_PLANS) {
    fail(path, `expected at most ${MAX_FAILED_BALLISTIC_PLANS} entries`);
  }
  const plans = values.map((value, index) => {
    const planPath = `${path}[${index}]`;
    const plan = readObject(value, planPath, [
      'sourceId',
      'targetId',
      'weaponId',
      'deltaSCell',
      'deltaZCell',
      'failureCount',
      'retryAtTick',
    ]);
    if (plan.weaponId !== 'batteryGun') fail(`${planPath}.weaponId`, 'expected batteryGun');
    return {
      sourceId: readInteger(plan.sourceId, `${planPath}.sourceId`, 1),
      targetId: readInteger(plan.targetId, `${planPath}.targetId`, 1),
      weaponId: 'batteryGun' as const,
      deltaSCell: readInteger(plan.deltaSCell, `${planPath}.deltaSCell`, Number.MIN_SAFE_INTEGER),
      deltaZCell: readInteger(plan.deltaZCell, `${planPath}.deltaZCell`, Number.MIN_SAFE_INTEGER),
      failureCount: readInteger(
        plan.failureCount,
        `${planPath}.failureCount`,
        1,
        MAX_BALLISTIC_PLAN_FAILURE_COUNT,
      ),
      retryAtTick: readInteger(
        plan.retryAtTick,
        `${planPath}.retryAtTick`,
        0,
        Math.min(Number.MAX_SAFE_INTEGER, worldTick + MAX_BALLISTIC_PLAN_RETRY_TICKS),
      ),
    };
  });
  const keys = plans.map(
    (plan) => `${plan.sourceId}:${plan.weaponId}:${plan.targetId}:${plan.deltaSCell}:${plan.deltaZCell}`,
  );
  if (new Set(keys).size !== keys.length) fail(path, 'contains duplicate plan keys');
  return plans;
}

function readTactician(
  value: unknown,
  path: string,
  controllerFaction: Faction,
  units: readonly Unit[],
): TacticianPersistenceState {
  const tactician = readObject(value, path, [
    'faction', 'difficulty', 'reactionTimer', 'elapsed', 'squads',
  ]);
  const squads = readArray(tactician.squads, `${path}.squads`).map((value, index) => {
    const squadPath = `${path}.squads[${index}]`;
    const squad = readObject(value, squadPath, ['id', 'unitIds', 'rallyPoint', 'targetId']);
    const unitIds = readArray(squad.unitIds, `${squadPath}.unitIds`).map((id, unitIndex) =>
      readInteger(id, `${squadPath}.unitIds[${unitIndex}]`, 1));
    if (new Set(unitIds).size !== unitIds.length) fail(`${squadPath}.unitIds`, 'contains duplicate unit ids');
    for (let unitIndex = 0; unitIndex < unitIds.length; unitIndex++) {
      const unit = units.find((candidate) => candidate.id === unitIds[unitIndex]);
      if (!unit?.alive) continue;
      if (unit.faction !== controllerFaction || !UNITS[unit.kind].isMech) {
        fail(
          `${squadPath}.unitIds[${unitIndex}]`,
          'existing alive unit must be a friendly mech',
        );
      }
    }
    return {
      id: readInteger(squad.id, `${squadPath}.id`, 1),
      unitIds,
      rallyPoint: readPoint(squad.rallyPoint, `${squadPath}.rallyPoint`),
      targetId: readInteger(squad.targetId, `${squadPath}.targetId`, 0),
    };
  });
  if (new Set(squads.map((squad) => squad.id)).size !== squads.length) {
    fail(`${path}.squads`, 'contains duplicate squad ids');
  }
  const assignedUnitIds = squads.flatMap((squad) => squad.unitIds);
  if (new Set(assignedUnitIds).size !== assignedUnitIds.length) {
    fail(`${path}.squads`, 'assigns a unit to more than one squad');
  }
  return {
    faction: readFaction(tactician.faction, `${path}.faction`),
    difficulty: readDifficulty(tactician.difficulty, `${path}.difficulty`),
    reactionTimer: readFinite(tactician.reactionTimer, `${path}.reactionTimer`),
    elapsed: readFinite(tactician.elapsed, `${path}.elapsed`, 0),
    squads,
  };
}

function readGoalScore(value: unknown, path: string): GoalScore {
  const score = readObject(value, path, ['goal', 'score']);
  return {
    goal: readGoal(score.goal, `${path}.goal`),
    score: readFinite(score.score, `${path}.score`),
  };
}

function readPoint(value: unknown, path: string): { s: number; z: number } {
  const point = readObject(value, path, ['s', 'z']);
  return {
    s: readFinite(point.s, `${path}.s`),
    z: readFinite(point.z, `${path}.z`),
  };
}

function readObject(value: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'expected an object');
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unexpected field');
  for (const key of fields) if (!(key in value)) fail(`${path}.${key}`, 'missing field');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value;
}

function readFinite(value: unknown, path: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `expected a finite number in [${minimum}, ${maximum}]`);
  }
  return value;
}

function readInteger(value: unknown, path: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = readFinite(value, path, minimum, maximum);
  if (!Number.isSafeInteger(result)) fail(path, 'expected a safe integer');
  return result;
}

function readFaction(value: unknown, path: string): Faction {
  if (value === Faction.Compact) return Faction.Compact;
  if (value === Faction.Choir) return Faction.Choir;
  return fail(path, 'expected a faction');
}

function readDifficulty(value: unknown, path: string): Difficulty {
  if (value === 'recruit' || value === 'veteran' || value === 'commander') return value;
  return fail(path, 'expected an AI difficulty');
}

function readGoal(value: unknown, path: string): StrategicGoal {
  if (value === 'expand' || value === 'tech' || value === 'harass' || value === 'defend' || value === 'allIn') {
    return value;
  }
  return fail(path, 'expected a strategic goal');
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return fail('$', 'invalid JSON');
  }
}

function fail(path: string, message: string): never {
  throw new SnapshotValidationError(`${path}: ${message}`);
}
