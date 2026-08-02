import { performance } from 'node:perf_hooks';
import { cpuUsage, env } from 'node:process';
import { AiOpponent } from '@ai/opponent';
import { RING_HALF_WIDTH, SIM_DT } from '@core/constants';
import { createTerrain, type Terrain } from '@gen/terrain';
import { runHeadlessMatch, type HeadlessMatchConfig } from '@headless/runner';
import { Faction } from '@sim/data';
import { World } from '@sim/world';
import { expect, it } from 'vitest';

const PROFILE_MODE = env.RWW_PROFILE;
const PROFILE_TICKS = Math.max(1, Number.parseInt(env.RWW_PROFILE_TICKS ?? '72000', 10));
const PROFILE_WARMUP_TICKS = 12_000;
const PROFILE_SEED = 501;

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

type TimedMethod = (...args: unknown[]) => unknown;

it.skipIf(PROFILE_MODE === undefined)('profiles a representative 40-minute headless match', () => {
  const terrainStarted = performance.now();
  const terrain = env.RWW_TERRAIN === 'standard' ? createTerrain(PROFILE_SEED) : flatTerrain;
  const terrainMilliseconds = performance.now() - terrainStarted;

  if (PROFILE_MODE === 'wall') {
    const runCount = Math.max(1, Number.parseInt(env.RWW_PROFILE_RUNS ?? '1', 10));
    const simulationMilliseconds: number[] = [];
    const simulationCpuMilliseconds: number[] = [];
    const results = [];
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
    console.info(JSON.stringify({
      mode: PROFILE_MODE,
      terrain: env.RWW_TERRAIN ?? 'flat',
      terrainMilliseconds,
      simulationMilliseconds,
      simulationCpuMilliseconds,
      medianSimulationMilliseconds: sorted[Math.floor(sorted.length / 2)],
      ticks: result.durationTicks,
      result,
    }));
    expect(result.status).toBe('completed');
    expect(result.durationTicks).toBeGreaterThan(0);
    expect(result.durationTicks).toBeLessThanOrEqual(PROFILE_TICKS);
    return;
  }

  const world = new World(terrain, PROFILE_SEED, PROFILE_TICKS * SIM_DT);
  world.setup();
  const controllers = [
    new AiOpponent(Faction.Compact, 'veteran', controllerSeed(PROFILE_SEED, Faction.Compact, 0)),
    new AiOpponent(Faction.Choir, 'veteran', controllerSeed(PROFILE_SEED, Faction.Choir, 1)),
  ] as const;
  const timings = new Map<string, Timing>();
  const periodicHashes: Array<{ tick: number; world: string; controllers: string[] }> = [];
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
      'fireBallisticAt',
      'isVisible',
      'isEntityVisible',
      'hasLineOfSight',
    ];
    for (const method of detailMethods) timeMethod(world, method, method, timings, world);
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
    world.drainEvents();
    if (world.tick % 9_000 === 0) {
      periodicHashes.push({
        tick: world.tick,
        world: world.stateHash(),
        controllers: controllers.map((controller) => hashJson(controller.exportPersistenceState())),
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
      world: world.stateHash(),
      controllers: controllers.map((controller) => hashJson(controller.exportPersistenceState())),
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
  console.info(JSON.stringify({
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
    ballisticWork: world.ballisticWork,
    navFieldBuilds: world.nav.fieldBuildCount,
    navCachedFields: world.nav.cachedFieldCount,
    rows,
  }));

  expect(world.tick).toBeGreaterThan(0);
  expect(world.tick).toBeLessThanOrEqual(PROFILE_TICKS);
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
