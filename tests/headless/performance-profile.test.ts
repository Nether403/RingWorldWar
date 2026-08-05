import { performance } from 'node:perf_hooks';
import { cpuUsage, env } from 'node:process';
import { createHash } from 'node:crypto';
import { AiOpponent } from '@ai/opponent';
import { RING_HALF_WIDTH, SIM_DT } from '@core/constants';
import { createTerrain, type Terrain } from '@gen/terrain';
import { runHeadlessMatch, type HeadlessMatchConfig } from '@headless/runner';
import { minimumRequiredLaunchSpeed } from '@sim/ballistics';
import { Faction, STRUCTURES, UNITS, type StructureKind, type UnitKind, type WeaponDef } from '@sim/data';
import { World } from '@sim/world';
import { expect, it } from 'vitest';

const PROFILE_MODE = env.RWW_PROFILE;
const PROFILE_TICKS = Math.max(1, Number.parseInt(env.RWW_PROFILE_TICKS ?? '72000', 10));
const PROFILE_WARMUP_TICKS = 12_000;
const PROFILE_SEED = 501;
const QUALIFICATION_RESULT_HASH = '6cbce1c53391f33b78949037500c429fc1b59b2c74ee051ed9cebce001fac9c0';
const QUALIFICATION_TIMELINE_HASH = '6bbc10ac09b7cb6f21bcdba907d4dc57ef8134d6383cabe9d534d171e061f5db';

const flatTerrain = {
  heightAt: () => 0,
  slopeAt: () => 0,
  segmentSlopePassable: () => true,
  isBuildable: () => true,
} as unknown as Terrain;

const config: HeadlessMatchConfig = {
  seed: PROFILE_SEED,
  factions: [Faction.Compact, Faction.Choir],
  difficulties: ['veteran', 'veteran'],
  tickLimit: PROFILE_TICKS,
};

interface Timing {
  calls: number;
  milliseconds: number;
  maximumMilliseconds: number;
}

interface BallisticWorkSnapshot {
  trajectoryEvaluations: number;
  integrationSteps: number;
  fullTrajectoryBuilds: number;
  storedTrajectorySamples: number;
  failedPlanCacheHits: number;
}

interface BallisticAttempt {
  tick: number;
  caller: 'command' | 'automatic';
  faction: Faction;
  sourceId: number;
  sourceKind: string;
  weapon: string;
  targetS: number;
  targetZ: number;
  success: boolean;
  outcome: 'solved' | 'cached-failure' | 'no-solution';
  envelopeRatio?: number;
  milliseconds: number;
  work: BallisticWorkSnapshot;
}

type TimedMethod = (...args: unknown[]) => unknown;

it.skipIf(PROFILE_MODE === undefined)('profiles a representative 40-minute headless match', () => {
  const terrainStarted = performance.now();
  const terrain = env.RWW_TERRAIN === 'standard' ? createTerrain(PROFILE_SEED) : flatTerrain;
  const terrainMilliseconds = performance.now() - terrainStarted;

  if (PROFILE_MODE === 'wall') {
    const runCount = Math.max(1, Number.parseInt(env.RWW_PROFILE_RUNS ?? '1', 10));
    const warmupRunCount = Math.max(0, Number.parseInt(env.RWW_PROFILE_WARMUP_RUNS ?? '0', 10));
    const maximumMedianMilliseconds = env.RWW_PROFILE_MAX_MEDIAN_MS === undefined
      ? null
      : Math.max(1, Number.parseInt(env.RWW_PROFILE_MAX_MEDIAN_MS, 10));
    const warmupSimulationMilliseconds: number[] = [];
    const warmupCpuMilliseconds: number[] = [];
    const simulationMilliseconds: number[] = [];
    const simulationCpuMilliseconds: number[] = [];
    const results = [];
    for (let run = 0; run < warmupRunCount; run++) {
      const started = performance.now();
      const cpuStarted = cpuUsage();
      const warmupResult = runHeadlessMatch(config, terrain);
      const cpu = cpuUsage(cpuStarted);
      warmupSimulationMilliseconds.push(performance.now() - started);
      warmupCpuMilliseconds.push((cpu.user + cpu.system) / 1_000);
      expect(warmupResult.status).toBe('completed');
    }
    for (let run = 0; run < runCount; run++) {
      const started = performance.now();
      const cpuStarted = cpuUsage();
      results.push(runHeadlessMatch(config, terrain));
      const cpu = cpuUsage(cpuStarted);
      simulationMilliseconds.push(performance.now() - started);
      simulationCpuMilliseconds.push((cpu.user + cpu.system) / 1_000);
    }
    const result = results[results.length - 1]!;
    const sorted = [...simulationMilliseconds].sort((a, b) => a - b);
    const medianSimulationMilliseconds = median(sorted);
    const resultHashes = results.map(sha256JsonValue);
    const measuredResultsMatch = resultHashes.every((hash) => hash === resultHashes[0]);
    const qualificationResultPassed = env.RWW_PROFILE_QUALIFY === '1'
      ? resultHashes.every((hash) => hash === QUALIFICATION_RESULT_HASH)
        && result.durationTicks === 50_890
        && result.winner === Faction.Choir
        && result.endReason === 'Your Bastion was destroyed'
      : null;
    console.info(JSON.stringify({
      schema: 'rww.headless-performance-report',
      version: 1,
      mode: PROFILE_MODE,
      terrain: env.RWW_TERRAIN ?? 'flat',
      terrainMilliseconds,
      warmupSimulationMilliseconds,
      warmupCpuMilliseconds,
      simulationMilliseconds,
      simulationCpuMilliseconds,
      medianSimulationMilliseconds,
      maximumMedianMilliseconds,
      medianBudgetPassed: maximumMedianMilliseconds === null
        ? null
        : medianSimulationMilliseconds <= maximumMedianMilliseconds,
      resultHashes,
      expectedQualificationResultHash: env.RWW_PROFILE_QUALIFY === '1' ? QUALIFICATION_RESULT_HASH : null,
      qualificationResultPassed,
      measuredResultsMatch,
      ticks: result.durationTicks,
      result,
    }));
    expect(result.status).toBe('completed');
    expect(measuredResultsMatch).toBe(true);
    expect(result.durationTicks).toBeGreaterThan(0);
    expect(result.durationTicks).toBeLessThanOrEqual(PROFILE_TICKS);
    if (maximumMedianMilliseconds !== null) {
      expect(medianSimulationMilliseconds).toBeLessThanOrEqual(maximumMedianMilliseconds);
    }
    if (env.RWW_PROFILE_QUALIFY === '1') {
      expect(qualificationResultPassed).toBe(true);
      expect(result.durationTicks).toBe(50_890);
      expect(result.winner).toBe(Faction.Choir);
      expect(result.endReason).toBe('Your Bastion was destroyed');
    }
    return;
  }

  const world = new World(terrain, PROFILE_SEED, PROFILE_TICKS * SIM_DT);
  world.setup();
  const controllers = [
    new AiOpponent(Faction.Compact, 'veteran', controllerSeed(PROFILE_SEED, Faction.Compact, 0)),
    new AiOpponent(Faction.Choir, 'veteran', controllerSeed(PROFILE_SEED, Faction.Choir, 1)),
  ] as const;
  const timings = new Map<string, Timing>();
  const ballisticAttempts: BallisticAttempt[] = [];
  let warmupBallisticWork: BallisticWorkSnapshot | null = null;
  const periodicHashes: Array<{ tick: number; world: string; controllers: string[] }> = [];
  const eventTranscript = createHash('sha256');
  const phaseMethods = [
    'rebuildBuckets',
    'stepEconomy',
    'stepProduction',
    'stepUnits',
    'stepStructures',
    'stepProjectiles',
    'stepWrecks',
    'stepCapture',
    'stepCleanup',
    'stepVictory',
  ];
  for (const method of phaseMethods) timeMethod(world, method, method, timings, world);

  if (PROFILE_MODE === 'detail') {
    const detailMethods = [
      'separateUnits',
      'moveToward',
      'isValidTarget',
      'findTarget',
      'fireWeapons',
      'runInterceptor',
      'instantaneousEnergy',
      'positionOf',
      'isBallisticTargetWithinReachEnvelope',
      'isVisible',
      'isEntityVisible',
      'hasLineOfSight',
    ];
    for (const method of detailMethods) timeMethod(world, method, method, timings, world);
    profileBallisticCommands(world, terrain, timings, ballisticAttempts);
    profileNearbyCache(world, timings);
    timeMethod(world.nav, 'directionAt', 'nav.directionAt', timings, world);
    timeMethod(world.nav, 'segmentPassable', 'nav.segmentPassable', timings, world);
    for (let index = 0; index < controllers.length; index++) {
      const faction = config.factions[index]! === Faction.Compact ? 'Compact' : 'Choir';
      timeMethod(controllers[index]!, 'evaluateStrategy', `ai.${faction}.strategy`, timings, world);
      timeMethod(controllers[index]!, 'runEconomy', `ai.${faction}.economy`, timings, world);
      timeMethod(controllers[index]!, 'runTactics', `ai.${faction}.tactics`, timings, world);
      timeMethod(controllers[index]!.tactician, 'reformSquads', `ai.${faction}.reformSquads`, timings, world);
      timeMethod(controllers[index]!.tactician, 'update', `ai.${faction}.tactician`, timings, world);
    }
  }

  let lateLoopMilliseconds = 0;
  for (let tick = 0; tick < PROFILE_TICKS && world.status === 'running'; tick++) {
    if (world.tick === PROFILE_WARMUP_TICKS) warmupBallisticWork = snapshotBallisticWork(world);
    const measured = world.tick >= PROFILE_WARMUP_TICKS;
    const loopStarted = measured ? performance.now() : 0;
    world.step();
    if (world.status === 'running') {
      for (let index = 0; index < controllers.length; index++) {
        const started = measured ? performance.now() : 0;
        controllers[index]!.update(world, SIM_DT);
        if (measured) {
          const faction = config.factions[index]! === Faction.Compact ? 'Compact' : 'Choir';
          recordTiming(timings, `ai.${faction}`, performance.now() - started);
        }
      }
    }
    const drainStarted = measured ? performance.now() : 0;
    const events = world.drainEvents();
    eventTranscript.update(`${world.tick}:${JSON.stringify(events)}\n`);
    if (world.tick % 9_000 === 0) {
      periodicHashes.push({
        tick: world.tick,
        world: sha256JsonValue(world.exportPersistenceState()),
        controllers: controllers.map((controller) => sha256JsonValue(controller.exportPersistenceState())),
      });
    }
    if (measured) {
      recordTiming(timings, 'events', performance.now() - drainStarted);
      lateLoopMilliseconds += performance.now() - loopStarted;
    }
  }
  if (periodicHashes.at(-1)?.tick !== world.tick) {
    periodicHashes.push({
      tick: world.tick,
      world: sha256JsonValue(world.exportPersistenceState()),
      controllers: controllers.map((controller) => sha256JsonValue(controller.exportPersistenceState())),
    });
  }

  const rows = [...timings.entries()]
    .map(([name, timing]) => ({
      name,
      calls: timing.calls,
      milliseconds: timing.milliseconds,
      percent: lateLoopMilliseconds === 0 ? 0 : timing.milliseconds / lateLoopMilliseconds * 100,
      maximumMilliseconds: timing.maximumMilliseconds,
    }))
    .sort((a, b) => b.milliseconds - a.milliseconds);
  warmupBallisticWork ??= snapshotBallisticWork(world);
  const lateBallisticWork = subtractBallisticWork(snapshotBallisticWork(world), warmupBallisticWork);
  const ballisticAttemptSummary = Object.values(ballisticAttempts.reduce<Record<string, {
    caller: BallisticAttempt['caller']; faction: Faction; weapon: string; calls: number; successes: number;
    cachedFailures: number; noSolutions: number; milliseconds: number; work: BallisticWorkSnapshot;
  }>>((summary, attempt) => {
    const key = `${attempt.caller}:${attempt.faction}:${attempt.weapon}`;
    const row = summary[key] ??= {
      caller: attempt.caller,
      faction: attempt.faction,
      weapon: attempt.weapon,
      calls: 0,
      successes: 0,
      cachedFailures: 0,
      noSolutions: 0,
      milliseconds: 0,
      work: emptyBallisticWork(),
    };
    row.calls++;
    row.successes += Number(attempt.success);
    row.cachedFailures += Number(attempt.outcome === 'cached-failure');
    row.noSolutions += Number(attempt.outcome === 'no-solution');
    row.milliseconds += attempt.milliseconds;
    addBallisticWork(row.work, attempt.work);
    return summary;
  }, {}));
  const attributedBallisticWork = emptyBallisticWork();
  for (const attempt of ballisticAttempts) addBallisticWork(attributedBallisticWork, attempt.work);
  const ballisticEnvelopeSummary = Object.values(ballisticAttempts.reduce<Record<string, {
    caller: BallisticAttempt['caller']; faction: Faction; weapon: string; outcome: BallisticAttempt['outcome'];
    calls: number; ratioMinimum: number; ratioMaximum: number; ratioTotal: number;
  }>>((summary, attempt) => {
    if (attempt.envelopeRatio === undefined) return summary;
    const key = `${attempt.caller}:${attempt.faction}:${attempt.weapon}:${attempt.outcome}`;
    const row = summary[key] ??= {
      caller: attempt.caller,
      faction: attempt.faction,
      weapon: attempt.weapon,
      outcome: attempt.outcome,
      calls: 0,
      ratioMinimum: Infinity,
      ratioMaximum: -Infinity,
      ratioTotal: 0,
    };
    row.calls++;
    row.ratioMinimum = Math.min(row.ratioMinimum, attempt.envelopeRatio);
    row.ratioMaximum = Math.max(row.ratioMaximum, attempt.envelopeRatio);
    row.ratioTotal += attempt.envelopeRatio;
    return summary;
  }, {})).map(({ ratioTotal, ...row }) => ({
    ...row,
    ratioAverage: ratioTotal / row.calls,
  }));
  const ballisticEnvelopeThresholds = [0.75, 0.8, 0.9, 1, 1.1].map((threshold) => {
    const above = ballisticAttempts.filter(
      (attempt) => attempt.envelopeRatio !== undefined && attempt.envelopeRatio > threshold,
    );
    const work = emptyBallisticWork();
    for (const attempt of above) addBallisticWork(work, attempt.work);
    return {
      threshold,
      callsAbove: above.length,
      successesAbove: above.filter((attempt) => attempt.outcome === 'solved').length,
      noSolutionsAbove: above.filter((attempt) => attempt.outcome === 'no-solution').length,
      cachedFailuresAbove: above.filter((attempt) => attempt.outcome === 'cached-failure').length,
      work,
    };
  });
  const eventTranscriptHash = eventTranscript.digest('hex');
  const timelineHash = sha256JsonValue({ periodicHashes, eventTranscriptHash });
  console.info(JSON.stringify({
    schema: 'rww.headless-determinism-report',
    version: 1,
    mode: PROFILE_MODE,
    terrain: env.RWW_TERRAIN ?? 'flat',
    terrainMilliseconds,
    lateLoopMilliseconds,
    measuredTicks: Math.max(0, world.tick - PROFILE_WARMUP_TICKS),
    totalTicks: world.tick,
    status: world.status,
    winner: world.winner,
    endReason: world.endReason,
    finalHash: world.stateHash(),
    controllerHashes: controllers.map((controller) => hashJson(controller.exportPersistenceState())),
    periodicHashes,
    eventTranscriptHash,
    timelineHash,
    expectedQualificationTimelineHash: env.RWW_PROFILE_QUALIFY === '1' ? QUALIFICATION_TIMELINE_HASH : null,
    qualificationTimelinePassed: env.RWW_PROFILE_QUALIFY === '1'
      ? timelineHash === QUALIFICATION_TIMELINE_HASH
      : null,
    ballisticWork: world.ballisticWork,
    warmupBallisticWork,
    lateBallisticWork,
    attributedBallisticWork,
    unattributedBallisticWork: subtractBallisticWork(lateBallisticWork, attributedBallisticWork),
    ballisticAttemptSummary,
    ballisticEnvelopeSummary,
    ballisticEnvelopeThresholds,
    ballisticAttemptTranscriptHash: hashJson(ballisticAttempts.map(({ milliseconds: _milliseconds, ...attempt }) => attempt)),
    ...(env.RWW_PROFILE_TRANSCRIPT === '1' ? { ballisticAttempts } : {}),
    navFieldBuilds: world.nav.fieldBuildCount,
    navCachedFields: world.nav.cachedFieldCount,
    rows,
  }));

  expect(world.tick).toBeGreaterThan(0);
  expect(world.tick).toBeLessThanOrEqual(PROFILE_TICKS);
  if (env.RWW_PROFILE_QUALIFY === '1') expect(timelineHash).toBe(QUALIFICATION_TIMELINE_HASH);
}, 900_000);

function timeMethod(
  target: object,
  method: string,
  label: string,
  timings: Map<string, Timing>,
  world: World,
): void {
  const record = target as Record<string, unknown>;
  const original = record[method];
  if (typeof original !== 'function') throw new Error(`Cannot profile missing method ${method}`);
  record[method] = function timedMethod(this: unknown, ...args: unknown[]): unknown {
    if (world.tick <= PROFILE_WARMUP_TICKS) return (original as TimedMethod).apply(this, args);
    const started = performance.now();
    try {
      return (original as TimedMethod).apply(this, args);
    } finally {
      recordTiming(timings, label, performance.now() - started);
    }
  };
}

function profileNearbyCache(world: World, timings: Map<string, Timing>): void {
  const record = world as unknown as Record<string, unknown>;
  const original = record.nearby;
  if (typeof original !== 'function') throw new Error('Cannot profile missing method nearby');
  const bucketSize = (World as unknown as { BUCKET: number }).BUCKET;
  const bucketCols = record.bucketCols as number;
  const bucketRows = record.bucketRows as number;
  const nearbyCache = record.nearbyCache as Array<number[] | undefined>;
  const nearbyCacheGeneration = record.nearbyCacheGeneration as number[];
  record.nearby = function timedNearby(this: unknown, ...args: unknown[]): unknown {
    if (world.tick <= PROFILE_WARMUP_TICKS) return (original as TimedMethod).apply(this, args);
    const s = args[0] as number;
    const z = args[1] as number;
    const radius = args[2] as number;
    const r = Math.ceil(radius / bucketSize);
    const bs = ((Math.floor(s / bucketSize) % bucketCols) + bucketCols) % bucketCols;
    const bz = Math.floor((z + RING_HALF_WIDTH) / bucketSize);
    const key = r * bucketCols * bucketRows + bs * bucketRows + bz;
    const hit = nearbyCache[key] !== undefined && nearbyCacheGeneration[key] === record.bucketGeneration;
    const started = performance.now();
    try {
      return (original as TimedMethod).apply(this, args);
    } finally {
      recordTiming(timings, hit ? 'nearby.hit' : 'nearby.miss', performance.now() - started);
    }
  };
}

function profileBallisticCommands(
  world: World,
  terrain: Terrain,
  timings: Map<string, Timing>,
  attempts: BallisticAttempt[],
): void {
  const record = world as unknown as Record<string, unknown>;
  const originalCommand = record.fireBallisticAt;
  const originalPlan = record.planBallistic;
  if (typeof originalCommand !== 'function') throw new Error('Cannot profile missing method fireBallisticAt');
  if (typeof originalPlan !== 'function') throw new Error('Cannot profile missing method planBallistic');
  let caller: BallisticAttempt['caller'] = 'automatic';
  record.fireBallisticAt = function timedBallisticCommand(
    this: World,
    sourceId: number,
    targetS: number,
    targetZ: number,
    faction: Faction,
    weapon = '',
  ): boolean {
    if (world.tick <= PROFILE_WARMUP_TICKS) {
      return (originalCommand as (...args: unknown[]) => boolean).call(this, sourceId, targetS, targetZ, faction, weapon);
    }
    const started = performance.now();
    caller = 'command';
    try {
      return (originalCommand as (...args: unknown[]) => boolean).call(
        this, sourceId, targetS, targetZ, faction, weapon,
      );
    } finally {
      caller = 'automatic';
      const milliseconds = performance.now() - started;
      recordTiming(timings, 'fireBallisticAt', milliseconds);
      const factionName = faction === Faction.Compact ? 'Compact' : 'Choir';
      recordTiming(timings, `fireBallisticAt.${factionName}.${weapon || 'default'}`, milliseconds);
    }
  };
  record.planBallistic = function timedBallisticPlan(
    this: World,
    source: {
      ent: { id: number; kind: UnitKind | StructureKind };
      faction: Faction;
      isUnit: boolean;
      s: number;
      z: number;
      weapon: WeaponDef;
    },
    targetS: number,
    targetZ: number,
  ): unknown {
    if (world.tick <= PROFILE_WARMUP_TICKS) {
      return (originalPlan as TimedMethod).call(this, source, targetS, targetZ);
    }
    const before = snapshotBallisticWork(world);
    const started = performance.now();
    const plan = (originalPlan as TimedMethod).call(this, source, targetS, targetZ);
    const milliseconds = performance.now() - started;
    const work = subtractBallisticWork(snapshotBallisticWork(world), before);
    const sourceHeight = source.isUnit
      ? UNITS[source.ent.kind as UnitKind].height
      : STRUCTURES[source.ent.kind as StructureKind].height;
    const launchSpeed = source.weapon.launchSpeed;
    const from = {
      s: source.s,
      h: terrain.heightAt(source.s, source.z) + sourceHeight * (source.isUnit ? 0.62 : 0.7),
      z: source.z,
    };
    const to = { s: targetS, h: terrain.heightAt(targetS, targetZ), z: targetZ };
    const envelopeRatio = (source.weapon.flightMode ?? 'ballistic') === 'ballistic' && launchSpeed !== undefined
      ? minimumRequiredLaunchSpeed(
        from,
        to,
        world.time,
        60,
      ) / launchSpeed
      : undefined;
    attempts.push({
      tick: world.tick,
      caller,
      faction: source.faction,
      sourceId: source.ent.id,
      sourceKind: source.ent.kind,
      weapon: source.weapon.id,
      targetS,
      targetZ,
      success: plan !== null,
      outcome: plan !== null ? 'solved' : work.failedPlanCacheHits > 0 ? 'cached-failure' : 'no-solution',
      envelopeRatio,
      milliseconds,
      work,
    });
    return plan;
  };
}

function snapshotBallisticWork(world: World): BallisticWorkSnapshot {
  const work = world.ballisticWork;
  return {
    trajectoryEvaluations: work.trajectoryEvaluations,
    integrationSteps: work.integrationSteps,
    fullTrajectoryBuilds: work.fullTrajectoryBuilds,
    storedTrajectorySamples: work.storedTrajectorySamples,
    failedPlanCacheHits: work.failedPlanCacheHits,
  };
}

function emptyBallisticWork(): BallisticWorkSnapshot {
  return { trajectoryEvaluations: 0, integrationSteps: 0, fullTrajectoryBuilds: 0, storedTrajectorySamples: 0, failedPlanCacheHits: 0 };
}

function subtractBallisticWork(after: BallisticWorkSnapshot, before: BallisticWorkSnapshot): BallisticWorkSnapshot {
  return {
    trajectoryEvaluations: after.trajectoryEvaluations - before.trajectoryEvaluations,
    integrationSteps: after.integrationSteps - before.integrationSteps,
    fullTrajectoryBuilds: after.fullTrajectoryBuilds - before.fullTrajectoryBuilds,
    storedTrajectorySamples: after.storedTrajectorySamples - before.storedTrajectorySamples,
    failedPlanCacheHits: after.failedPlanCacheHits - before.failedPlanCacheHits,
  };
}

function addBallisticWork(target: BallisticWorkSnapshot, value: BallisticWorkSnapshot): void {
  target.trajectoryEvaluations += value.trajectoryEvaluations;
  target.integrationSteps += value.integrationSteps;
  target.fullTrajectoryBuilds += value.fullTrajectoryBuilds;
  target.storedTrajectorySamples += value.storedTrajectorySamples;
  target.failedPlanCacheHits += value.failedPlanCacheHits;
}

function recordTiming(timings: Map<string, Timing>, label: string, milliseconds: number): void {
  const timing = timings.get(label);
  if (timing) {
    timing.calls++;
    timing.milliseconds += milliseconds;
    timing.maximumMilliseconds = Math.max(timing.maximumMilliseconds, milliseconds);
  } else {
    timings.set(label, { calls: 1, milliseconds, maximumMilliseconds: milliseconds });
  }
}

function controllerSeed(seed: number, faction: Faction, index: number): number {
  return (seed ^ Math.imul(faction + 1, 0x9e3779b9) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
}

function hashJson(value: unknown): string {
  const state = JSON.stringify(value);
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < state.length; index++) {
    hash ^= state.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) * 0.5
    : sorted[middle]!;
}

function sha256JsonValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
