import type { Game } from '../../src/game';
import type { RenderAnchor } from '../../src/render/anchor';
import type { CameraRig } from '../../src/render/cameraRig';
import type { Renderer, QualityLevel } from '../../src/render/renderer';
import { createWorldSnapshot } from '../../src/sim/serialize';
import type { Unit } from '../../src/sim/world';
import { Faction, UNITS } from '../../src/sim/data';

interface BrowserScenario {
  worldSeed: number;
  quality: QualityLevel;
  simulation: { fixedTickSeconds: number; targetTick: number; visualTimeSeconds: number; settlingFrames: number };
  camera: { focusS: number; focusZ: number; yawRadians: number; zoom: number };
  mission?:
    | {
      id: 'first-contact'; revision: 1;
      bindings: { tutorialNode: string; artilleryTarget: string };
    }
    | {
      id: 'break-the-line'; revision: 1;
      bindings: {
        forwardNode: string; protectedExtractor: string; enemyArtillery: string;
        strongpointIds: string[]; raiderIds: string[];
      };
    }
    | {
      id: 'counterfire'; revision: 1;
      bindings: {
        protectedAsset: string; defensePower: string; aegis: string; wisp: string;
        playerBattery: string; enemyLauncher: string; enemyGrid: string;
      };
    }
    | {
      id: 'a-signal-in-the-spine'; revision: 1;
      bindings: {
        signalNode: string; engineer: string; bulwark: string; needleIds: string[];
        restorationPower: string; fieldCommand: string;
      };
    };
  setup: {
    disableAi?: boolean;
    player?: { salvage: number; commandCap?: number };
    units: Array<{
      id: string; faction: 'compact' | 'choir'; kind: Parameters<Game['world']['spawnUnit']>[1];
      s: number; z: number; yawRadians?: number; target?: string; targetMode?: 'attack' | 'attackMove'; selected?: boolean;
      abilityActive?: boolean; abilityTransitionTimer?: number; weaponCooldowns?: number[];
      healthFraction?: number;
    }>;
    structures: Array<{ id: string; faction: 'compact' | 'choir' | 'neutral'; kind: Parameters<Game['world']['spawnStructure']>[1]; s: number; z: number; progress: number; yawRadians?: number; healthFraction?: number }>;
  };
  observationRegions: Array<{ id: string; kind: 'sky' | 'ground' | 'unit' | 'ui'; x: number; y: number; width: number; height: number }>;
  actions?: Array<
    | { tick: number; kind: 'apply-damage'; target: string; amount: number; damageType: 'kinetic' | 'explosive' | 'energy'; sourceFaction: 'compact' | 'choir' }
    | { tick: number; kind: 'fire-ballistic'; source: string; weapon: string; targetS: number; targetZ: number }
  >;
}

interface TestDriver {
  stopLoop(): void;
  resumeLoop(): void;
  setAiEnabled(enabled: boolean): void;
  setBenchmarkVariant(variant: string): void;
  stepWorldTo(tick: number): void;
  setCamera(s: number, z: number, yaw: number, zoom: number): void;
  renderFrame(dt: number, visualTime: number): void;
  presentFrame(dt: number, visualTime: number): void;
}

interface TimerQueryExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

interface RwwWindow {
  game: Game;
  rig: CameraRig;
  anchor: RenderAnchor;
  renderer: Renderer;
  testDriver: TestDriver;
}

export function applyBrowserScenario(scenario: BrowserScenario): Record<string, number> {
  const rww = requiredRww();
  rww.testDriver.stopLoop();
  rww.testDriver.setAiEnabled(!(scenario.setup.disableAi ?? false));
  rww.renderer.autoQuality = false;
  rww.renderer.setQuality(scenario.quality);
  const entities = new Map<string, { id: number; s: number; z: number }>();
  for (const structure of scenario.setup.structures) {
    const faction = structure.faction === 'neutral' ? -1 : structure.faction === 'compact' ? 0 : 1;
    const spawned = rww.game.world.spawnStructure(
      faction as Parameters<Game['world']['spawnStructure']>[0], structure.kind, structure.s, structure.z, structure.progress,
    );
    if (structure.yawRadians !== undefined) spawned.yaw = structure.yawRadians;
    if (structure.healthFraction !== undefined) spawned.hp = spawned.maxHp * structure.healthFraction;
    entities.set(structure.id, spawned);
    if (structure.kind === 'extractor') {
      const deposit = rww.game.world.depositAt(structure.s, structure.z);
      if (deposit) deposit.claimedBy = spawned.id;
    }
  }
  for (const unit of scenario.setup.units) {
    const spawned = rww.game.world.spawnUnit(
      (unit.faction === 'compact' ? 0 : 1) as Parameters<Game['world']['spawnUnit']>[0], unit.kind, unit.s, unit.z,
    );
    if (unit.yawRadians !== undefined) {
      spawned.yaw = unit.yawRadians;
      spawned.prevYaw = unit.yawRadians;
    }
    if (unit.healthFraction !== undefined) applyScenarioHealth(spawned, unit.healthFraction);
    entities.set(unit.id, spawned);
    validateScenarioUnitState(unit, spawned);
  }
  for (const unit of scenario.setup.units) {
    const entity = entities.get(unit.id);
    const spawned = entity ? rww.game.world.unitById(entity.id) : undefined;
    if (!spawned) throw new Error(`Scenario unit was not spawned: ${unit.id}`);
    if (spawned.ability && unit.abilityActive !== undefined && spawned.ability.active !== unit.abilityActive) {
      if (!rww.game.world.activateAbility(spawned.id, unit.abilityActive)) {
        throw new Error(`Scenario ability state could not be applied: ${unit.id}`);
      }
    }
    if (spawned.ability && unit.abilityTransitionTimer !== undefined) {
      spawned.ability.transitionTimer = unit.abilityTransitionTimer;
    }
    if (unit.weaponCooldowns) {
      for (let index = 0; index < spawned.cd.length; index++) spawned.cd[index] = unit.weaponCooldowns[index]!;
    }
    if (unit.selected) rww.game.selection.add(spawned.id);
  }
  for (const unit of scenario.setup.units) {
    if (!unit.target) continue;
    const source = entities.get(unit.id);
    const target = entities.get(unit.target);
    if (!source || !target) throw new Error(`Scenario target not found: ${unit.id} -> ${unit.target}`);
    const spawned = rww.game.world.unitById(source.id)!;
    if (unit.targetMode === 'attackMove') {
      spawned.order = { kind: 'attackMove', s: target.s, z: target.z, targetId: 0 };
      spawned.targetId = 0;
    } else {
      spawned.order = { kind: 'attack', s: target.s, z: target.z, targetId: target.id };
      spawned.targetId = target.id;
    }
  }
  rww.testDriver.setCamera(scenario.camera.focusS, scenario.camera.focusZ, scenario.camera.yawRadians, scenario.camera.zoom);
  rww.testDriver.presentFrame(
    0,
    scenario.simulation.visualTimeSeconds - scenario.simulation.targetTick * scenario.simulation.fixedTickSeconds,
  );
  while (rww.game.world.tick < scenario.simulation.targetTick) {
    for (const action of scenario.actions ?? []) {
      if (action.tick !== rww.game.world.tick) continue;
      if (action.kind === 'apply-damage') {
        const target = entities.get(action.target);
        if (!target) throw new Error(`Scenario damage target not found: ${action.target}`);
        rww.game.world.applyDamage(
          target.id,
          action.amount,
          action.damageType,
          action.sourceFaction === 'compact' ? 0 : 1,
        );
      } else {
        const source = entities.get(action.source);
        if (!source) throw new Error(`Scenario ballistic source not found: ${action.source}`);
        const entity = rww.game.world.unitById(source.id) ?? rww.game.world.structureById(source.id);
        if (!entity || entity.faction < 0) throw new Error(`Scenario ballistic source is invalid: ${action.source}`);
        const fired = rww.game.world.fireBallisticAt(
          source.id,
          action.targetS,
          action.targetZ,
          entity.faction as Faction,
          action.weapon,
        );
        if (!fired) throw new Error(`Scenario ballistic action failed: ${action.source}/${action.weapon}`);
      }
    }
    rww.game.stepSimulationExactlyOnce();
    const remaining = scenario.simulation.targetTick - rww.game.world.tick;
    rww.testDriver.presentFrame(
      scenario.simulation.fixedTickSeconds,
      scenario.simulation.visualTimeSeconds - remaining * scenario.simulation.fixedTickSeconds,
    );
  }
  if (scenario.setup.player) {
    rww.game.world.players[0].salvage = scenario.setup.player.salvage;
    if (scenario.setup.player.commandCap !== undefined) {
      rww.game.world.players[0].commandCap = scenario.setup.player.commandCap;
    }
  }
  if (scenario.mission) {
    const entityId = (id: string): number => {
      const value = entities.get(id)?.id;
      if (!value) throw new Error(`Scenario mission binding was not spawned: ${id}`);
      return value;
    };
    if (scenario.mission.id === 'first-contact') {
      rww.game.startMission('first-contact', {
        tutorialNode: entityId(scenario.mission.bindings.tutorialNode),
        artilleryTarget: entityId(scenario.mission.bindings.artilleryTarget),
      });
    } else if (scenario.mission.id === 'break-the-line') {
      rww.game.startMission('break-the-line', {
        forwardNode: entityId(scenario.mission.bindings.forwardNode),
        protectedExtractor: entityId(scenario.mission.bindings.protectedExtractor),
        enemyArtillery: entityId(scenario.mission.bindings.enemyArtillery),
        strongpointIds: scenario.mission.bindings.strongpointIds.map(entityId),
        raiderIds: scenario.mission.bindings.raiderIds.map(entityId),
      });
    } else if (scenario.mission.id === 'counterfire') {
      rww.game.startMission('counterfire', {
        protectedAsset: entityId(scenario.mission.bindings.protectedAsset),
        defensePower: entityId(scenario.mission.bindings.defensePower),
        aegis: entityId(scenario.mission.bindings.aegis),
        wisp: entityId(scenario.mission.bindings.wisp),
        playerBattery: entityId(scenario.mission.bindings.playerBattery),
        enemyLauncher: entityId(scenario.mission.bindings.enemyLauncher),
        enemyGrid: entityId(scenario.mission.bindings.enemyGrid),
      });
    } else {
      rww.game.startMission('a-signal-in-the-spine', {
        signalNode: entityId(scenario.mission.bindings.signalNode),
        engineer: entityId(scenario.mission.bindings.engineer),
        bulwark: entityId(scenario.mission.bindings.bulwark),
        needleIds: scenario.mission.bindings.needleIds.map(entityId),
        restorationPower: entityId(scenario.mission.bindings.restorationPower),
        fieldCommand: entityId(scenario.mission.bindings.fieldCommand),
      });
    }
  }
  for (let index = 0; index < scenario.simulation.settlingFrames; index++) {
    rww.testDriver.presentFrame(0, scenario.simulation.visualTimeSeconds);
  }
  return Object.fromEntries([...entities].map(([id, entity]) => [id, entity.id]));
}

export function resumeBrowserScenario(): void {
  requiredRww().testDriver.resumeLoop();
}

export function captureScenarioState(): Record<string, unknown> {
  const { game, renderer } = requiredRww();
  return {
    tick: game.world.tick,
    worldTime: game.world.time,
    units: game.world.units.filter((unit) => unit.alive).length,
    structures: game.world.structures.filter((structure) => structure.alive).length,
    projectiles: game.world.projectiles.length,
    status: game.world.status,
    aiEnabled: game.isAiEnabled,
    quality: renderer.quality,
    adaptiveQuality: renderer.autoQuality,
    mission: game.missionHudModel,
    missionProgress: game.missionSnapshot,
  };
}

export function captureScenarioStateHash(): string {
  const game = requiredRww().game;
  const state = JSON.stringify({ world: createWorldSnapshot(game.world), mission: game.missionSnapshot });
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < state.length; index++) {
    hash ^= state.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function validateScenarioUnitState(
  unit: BrowserScenario['setup']['units'][number],
  spawned: Pick<Unit, 'kind' | 'ability' | 'cd'>,
): void {
  if (unit.weaponCooldowns !== undefined && unit.weaponCooldowns.length !== spawned.cd.length) {
    throw new Error(`Scenario weapon cooldown count is unsupported for ${unit.id} (${spawned.kind})`);
  }
  if (unit.abilityActive === undefined && unit.abilityTransitionTimer === undefined) return;
  if (spawned.ability?.id === 'cloak') {
    throw new Error(`Scenario cannot set active ability state for passive Wisp cloak: ${unit.id}`);
  }
  if (!spawned.ability) {
    throw new Error(`Scenario cannot set ability state for ${unit.id} (${spawned.kind})`);
  }
}

export function applyScenarioHealth(unit: Unit, healthFraction: number): void {
  unit.hp = unit.maxHp * healthFraction;
  if (!UNITS[unit.kind].isMech) {
    unit.damageState = 0;
    unit.speedMultiplier = 1;
    return;
  }
  unit.damageState = healthFraction < 0.33 ? 2 : healthFraction < 0.66 ? 1 : 0;
  unit.speedMultiplier = unit.damageState === 2 ? 0.8 : 1;
}

export function captureScenarioFrame(scenario: BrowserScenario): {
  pixels: number[]; width: number; height: number; resources: Record<string, unknown>; state: Record<string, unknown>;
} {
  const rww = requiredRww();
  rww.testDriver.renderFrame(0, scenario.simulation.visualTimeSeconds);
  const gl = rww.renderer.gl.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const raw = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  const pixels = new Uint8Array(raw.length);
  for (let y = 0; y < height; y++) {
    pixels.set(raw.subarray(y * width * 4, (y + 1) * width * 4), (height - y - 1) * width * 4);
  }
  const info = rww.renderer.gl.info;
  return {
    pixels: Array.from(pixels), width, height,
    resources: {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      lines: info.render.lines,
      points: info.render.points,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? null,
    },
    state: captureScenarioState(),
  };
}

export async function benchmarkScenario(
  warmupSeconds: number,
  sampleSeconds: number,
  variant = 'default',
): Promise<Record<string, unknown>> {
  const rww = requiredRww();
  const maximumSamples = 50_000;
  // Performance qualification measures active gameplay, not a deliberately
  // paused story briefing. Visual and human-play flows still preserve it.
  if (rww.game.narrativeHudModel?.blocking) rww.game.acknowledgeNarrative();
  const startupPrewarm = rww.renderer.prewarmMetrics;
  rww.testDriver.setBenchmarkVariant(variant);
  const benchmarkPrewarm = await rww.renderer.prewarmActiveQuality();
  const programsAtStart = rww.renderer.gl.info.programs?.length ?? 0;
  let maximumPrograms = programsAtStart;
  const intervals: number[] = [];
  const render: number[] = [];
  const simulation: number[] = [];
  const fullFrame: number[] = [];
  const gpuTimerMilliseconds: number[] = [];
  const cpuPhases = {
    presentation: [] as number[],
    entities: [] as number[],
    effects: [] as number[],
    markers: [] as number[],
    hud: [] as number[],
    hudMinimap: [] as number[],
    hudSelection: [] as number[],
  };
  let collectCpuPhases = false;
  const restoreCpuWrappers: Array<() => void> = [];
  const wrapCpuPhase = (target: object, method: string, samples: number[]): void => {
    const record = target as Record<string, unknown>;
    const descriptor = Object.getOwnPropertyDescriptor(target, method);
    const original = record[method];
    if (typeof original !== 'function') throw new Error(`Missing benchmark phase ${method}`);
    record[method] = function timedPhase(this: unknown, ...args: unknown[]): unknown {
      const phaseStarted = collectCpuPhases ? performance.now() : 0;
      try {
        return (original as (...values: unknown[]) => unknown).apply(this, args);
      } finally {
        if (collectCpuPhases) samples.push(performance.now() - phaseStarted);
      }
    };
    restoreCpuWrappers.push(() => {
      if (descriptor) Object.defineProperty(target, method, descriptor);
      else delete record[method];
    });
  };
  try {
    wrapCpuPhase(rww.game, 'updatePresentation', cpuPhases.presentation);
    wrapCpuPhase(rww.game.entities, 'update', cpuPhases.entities);
    wrapCpuPhase(rww.game.effects, 'update', cpuPhases.effects);
    wrapCpuPhase(rww.game.markers, 'update', cpuPhases.markers);
    wrapCpuPhase(rww.game.hud, 'update', cpuPhases.hud);
    wrapCpuPhase(rww.game.hud, 'drawMinimap', cpuPhases.hudMinimap);
    wrapCpuPhase(rww.game.hud, 'drawSelection', cpuPhases.hudSelection);
  } catch (error) {
    for (const restore of restoreCpuWrappers.reverse()) {
      try { restore(); } catch { /* Continue rollback. */ }
    }
    throw error;
  }
  let contextLosses = 0;
  const onContextLost = (): void => { contextLosses++; };
  let listenerInstalled = false;
  let glSetup: WebGL2RenderingContext | null = null;
  let uploadProfilerSetup: ReturnType<typeof installUploadProfiler> | null = null;
  let timerQuerySetup: TimerQueryExtension | null = null;
  try {
    rww.renderer.gl.domElement.addEventListener('webglcontextlost', onContextLost);
    listenerInstalled = true;
    glSetup = rww.renderer.gl.getContext() as WebGL2RenderingContext;
    uploadProfilerSetup = installUploadProfiler(glSetup);
    timerQuerySetup = glSetup.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExtension | null;
  } catch (error) {
    for (const restore of restoreCpuWrappers.reverse()) {
      try { restore(); } catch { /* Continue rollback. */ }
    }
    try { uploadProfilerSetup?.restore(); } catch { /* Continue rollback. */ }
    if (listenerInstalled) {
      try { rww.renderer.gl.domElement.removeEventListener('webglcontextlost', onContextLost); } catch { /* Ignore. */ }
    }
    throw error;
  }
  const gl = glSetup!;
  const uploadProfiler = uploadProfilerSetup!;
  const timerQuery = timerQuerySetup;
  const timerQuerySupported = timerQuery !== null;
  const pendingQueries: Array<{ query: WebGLQuery; measured: boolean }> = [];
  const gpuQueryStats = {
    started: 0,
    measuredStarted: 0,
    measuredResolved: 0,
    measuredSkipped: 0,
    measuredDisjoint: 0,
    measuredDrainTimeout: 0,
  };
  const pollGpuQueries = (): void => {
    if (!timerQuery) return;
    if (gl.getParameter(timerQuery.GPU_DISJOINT_EXT)) {
      for (const pending of pendingQueries) {
        if (pending.measured) gpuQueryStats.measuredDisjoint++;
        gl.deleteQuery(pending.query);
      }
      pendingQueries.length = 0;
      return;
    }
    while (pendingQueries.length > 0) {
      const pending = pendingQueries[0]!;
      if (!gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE)) break;
      const nanoseconds = gl.getQueryParameter(pending.query, gl.QUERY_RESULT) as number;
      pendingQueries.shift();
      gl.deleteQuery(pending.query);
      if (pending.measured && Number.isFinite(nanoseconds)) {
        gpuTimerMilliseconds.push(nanoseconds / 1_000_000);
        gpuQueryStats.measuredResolved++;
      }
    }
  };
  const started = performance.now();
  const warmupEnd = started + warmupSeconds * 1000;
  const sampleEnd = warmupEnd + sampleSeconds * 1000;
  let previous = started;
  let visualTime = rww.game.world.time;
  let sampleLimitReached = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const frame = (now: number): void => {
        try {
          const interval = now - previous;
          previous = now;
          const dt = Math.min(interval / 1000, 0.1);
          visualTime += dt;
          pollGpuQueries();
          const measured = now >= warmupEnd;
          let query: WebGLQuery | null = null;
          if (timerQuery) {
            if (pendingQueries.length < 8) query = gl.createQuery();
            if (query) {
              gpuQueryStats.started++;
              if (measured) gpuQueryStats.measuredStarted++;
              gl.beginQuery(timerQuery.TIME_ELAPSED_EXT, query);
            } else if (measured) {
              gpuQueryStats.measuredSkipped++;
            }
          }
          const frameStart = performance.now();
          collectCpuPhases = measured;
          if (measured) uploadProfiler.beginFrame();
          try {
            rww.testDriver.renderFrame(dt, visualTime);
          } finally {
            collectCpuPhases = false;
            if (measured) uploadProfiler.endFrame();
            if (query && timerQuery) {
              gl.endQuery(timerQuery.TIME_ELAPSED_EXT);
              pendingQueries.push({ query, measured });
            }
          }
          const elapsed = performance.now() - frameStart;
          maximumPrograms = Math.max(maximumPrograms, rww.renderer.gl.info.programs?.length ?? 0);
          if (measured) {
            intervals.push(interval);
            render.push(rww.renderer.frameMs);
            simulation.push(rww.game.simStepMs);
            fullFrame.push(elapsed);
            if (intervals.length >= maximumSamples) sampleLimitReached = true;
          }
          if (now >= sampleEnd || sampleLimitReached) resolve();
          else requestAnimationFrame(frame);
        } catch (error) {
          reject(error);
        }
      };
      requestAnimationFrame(frame);
    });
    if (timerQuery && pendingQueries.length > 0) {
      const drainDeadline = performance.now() + 2_000;
      await new Promise<void>((resolve, reject) => {
        const drain = (): void => {
          try {
            pollGpuQueries();
            if (pendingQueries.length === 0) resolve();
            else if (performance.now() >= drainDeadline) {
              gpuQueryStats.measuredDrainTimeout += pendingQueries.filter((pending) => pending.measured).length;
              resolve();
            } else requestAnimationFrame(drain);
          } catch (error) {
            reject(error);
          }
        };
        requestAnimationFrame(drain);
      });
    }
  } finally {
    collectCpuPhases = false;
    for (const restore of restoreCpuWrappers.reverse()) {
      try { restore(); } catch { /* Best-effort cleanup must not block later restorations. */ }
    }
    try { uploadProfiler.restore(); } catch { /* Continue cleanup. */ }
    if (listenerInstalled) {
      try { rww.renderer.gl.domElement.removeEventListener('webglcontextlost', onContextLost); } catch { /* Continue. */ }
    }
    for (const pending of pendingQueries) {
      try { gl.deleteQuery(pending.query); } catch { /* Context may already be lost. */ }
    }
    pendingQueries.length = 0;
  }
  const info = rww.renderer.gl.info;
  const programsAtEnd = info.programs?.length ?? 0;
  return {
    intervals, render, simulation, fullFrame, contextLosses, timerQuerySupported, sampleLimitReached,
    gpuTimerMilliseconds,
    gpuQueryStats,
    cpuPhases,
    uploads: uploadProfiler.report(),
    shaderPrograms: {
      startupPrewarm,
      benchmarkPrewarm,
      startupMissedPrograms: startupPrewarm
        ? Math.max(0, benchmarkPrewarm.programsAfterShadowWarm - startupPrewarm.programsAfterShadowWarm)
        : null,
      programsAtStart,
      maximumPrograms,
      programsAtEnd,
      latePrograms: maximumPrograms - programsAtStart,
    },
    resources: {
      drawCalls: info.render.calls, triangles: info.render.triangles,
      lines: info.render.lines, points: info.render.points,
      geometries: info.memory.geometries, textures: info.memory.textures,
      programs: info.programs?.length ?? null,
    },
  };
}

function installUploadProfiler(gl: WebGL2RenderingContext): {
  beginFrame(): void;
  endFrame(): void;
  report(): Record<string, unknown>;
  restore(): void;
} {
  const totals = {
    bufferDataCalls: 0,
    bufferDataBytes: 0,
    bufferSubDataCalls: 0,
    bufferSubDataBytes: 0,
    unknownByteCalls: 0,
  };
  const bytesPerFrame: number[] = [];
  const restores: Array<() => void> = [];
  let collecting = false;
  let frameStartBytes = 0;
  let supported = true;
  const install = (
    name: 'bufferData' | 'bufferSubData',
    sourceIndex: number,
    sourceOffsetIndex: number,
  ): void => {
    const record = gl as unknown as Record<string, unknown>;
    const original = record[name];
    if (typeof original !== 'function') throw new Error(`WebGL2 ${name} is unavailable`);
    const descriptor = Object.getOwnPropertyDescriptor(gl, name);
    const wrapped = function wrappedUpload(this: WebGL2RenderingContext, ...args: unknown[]): unknown {
      if (collecting) {
        const bytes = uploadByteLength(args, sourceIndex, sourceOffsetIndex);
        if (name === 'bufferData') {
          totals.bufferDataCalls++;
          if (bytes === null) totals.unknownByteCalls++;
          else totals.bufferDataBytes += bytes;
        } else {
          totals.bufferSubDataCalls++;
          if (bytes === null) totals.unknownByteCalls++;
          else totals.bufferSubDataBytes += bytes;
        }
      }
      return Reflect.apply(original as (...values: unknown[]) => unknown, this, args);
    };
    Object.defineProperty(gl, name, { configurable: true, writable: true, value: wrapped });
    restores.push(() => {
      if (descriptor) Object.defineProperty(gl, name, descriptor);
      else delete record[name];
    });
  };
  try {
    install('bufferData', 1, 3);
    install('bufferSubData', 2, 3);
  } catch {
    supported = false;
    for (const restore of restores.reverse()) restore();
    restores.length = 0;
  }
  return {
    beginFrame(): void {
      if (!supported) return;
      frameStartBytes = totals.bufferDataBytes + totals.bufferSubDataBytes;
      collecting = true;
    },
    endFrame(): void {
      if (!supported) return;
      collecting = false;
      bytesPerFrame.push(totals.bufferDataBytes + totals.bufferSubDataBytes - frameStartBytes);
    },
    report(): Record<string, unknown> {
      return {
        supported,
        ...totals,
        totalBytes: totals.bufferDataBytes + totals.bufferSubDataBytes,
        measuredFrames: bytesPerFrame.length,
        bytesPerFrame,
      };
    },
    restore(): void {
      collecting = false;
      for (const restore of restores.reverse()) restore();
      restores.length = 0;
    },
  };
}

export function uploadByteLength(args: unknown[], sourceIndex: number, sourceOffsetIndex: number): number | null {
  const source = args[sourceIndex];
  if (typeof source === 'number') return Number.isFinite(source) && source >= 0 ? source : null;
  if (!(source instanceof ArrayBuffer) && !ArrayBuffer.isView(source)) return null;
  const byteLength = source.byteLength;
  const elementSize = ArrayBuffer.isView(source)
    ? (source as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1
    : 1;
  const totalElements = byteLength / elementSize;
  const sourceLengthIndex = sourceOffsetIndex + 1;
  const offset = typeof args[sourceOffsetIndex] === 'number' ? args[sourceOffsetIndex] : 0;
  const requested = typeof args[sourceLengthIndex] === 'number' ? args[sourceLengthIndex] : totalElements - offset;
  if (!Number.isFinite(offset) || !Number.isFinite(requested) || offset < 0 || requested < 0) return null;
  return Math.max(0, Math.min(requested, totalElements - offset)) * elementSize;
}

function requiredRww(): RwwWindow {
  const rww = (window as unknown as { RWW?: RwwWindow }).RWW;
  if (!rww?.testDriver) throw new Error('Scenario driver requires ?scenarioDriver=1');
  return rww;
}
