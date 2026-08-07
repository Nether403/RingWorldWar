import type { Terrain } from '@gen/terrain';
import { RING_CIRCUMFERENCE, SIM_DT } from '@core/constants';
import { deltaS } from '@core/ringMath';
import { ABILITIES, type AbilityId, type AbilityState } from './abilities';
import {
  Faction,
  canFactionFieldUnit,
  COMMAND_PER_NODE,
  STARTING_COMMAND,
  STRUCTURES,
  UNITS,
  WEAPONS,
  type StructureKind,
  type UnitKind,
} from './data';
import {
  World,
  resolveTerrainSeed,
  type Deposit,
  type MatchStatus,
  type Order,
  type OrderKind,
  type Projectile,
  type SpinalPair,
  type Structure,
  type Unit,
  type WorldPersistenceState,
  type WorldPlayerPersistenceState,
  type Wreck,
} from './world';

export const WORLD_SNAPSHOT_SCHEMA = 'ring-world-war/world';
export const WORLD_SNAPSHOT_VERSION = 2;

export interface WorldSnapshot {
  schema: typeof WORLD_SNAPSHOT_SCHEMA;
  version: typeof WORLD_SNAPSHOT_VERSION;
  world: WorldPersistenceState;
}

export class SnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotValidationError';
  }
}

export function createWorldSnapshot(world: World): WorldSnapshot {
  return {
    schema: WORLD_SNAPSHOT_SCHEMA,
    version: WORLD_SNAPSHOT_VERSION,
    world: world.exportPersistenceState(),
  };
}

export function serializeWorld(world: World): string {
  return JSON.stringify(createWorldSnapshot(world));
}

export function parseWorldSnapshot(input: unknown): WorldSnapshot {
  const value = typeof input === 'string' ? parseJson(input) : input;
  const root = object(value, '$', ['schema', 'version', 'world']);
  if (root.schema !== WORLD_SNAPSHOT_SCHEMA) {
    fail('$.schema', `expected ${WORLD_SNAPSHOT_SCHEMA}`);
  }
  if (root.version !== 1 && root.version !== WORLD_SNAPSHOT_VERSION) {
    fail('$.version', `expected version 1 or ${WORLD_SNAPSHOT_VERSION}`);
  }
  const version = root.version;
  return {
    schema: WORLD_SNAPSHOT_SCHEMA,
    version: WORLD_SNAPSHOT_VERSION,
    world: readWorld(root.world, '$.world', version),
  };
}

export function deserializeWorld(input: unknown, terrain: Terrain): World {
  const snapshot = parseWorldSnapshot(input);
  assertTerrainCompatible(snapshot.world, terrain);
  const world = new World(terrain, snapshot.world.worldSeed, snapshot.world.timeLimit);
  world.restorePersistenceState(snapshot.world);
  return world;
}

export function loadWorldSnapshot(world: World, input: unknown): void {
  const snapshot = parseWorldSnapshot(input);
  assertTerrainCompatible(snapshot.world, world.terrain);
  world.restorePersistenceState(snapshot.world);
}

function readWorld(value: unknown, path: string, version: 1 | 2): WorldPersistenceState {
  const state = object(value, path, [
    'worldSeed',
    'terrainSeed',
    'tick',
    'time',
    'rngState',
    'nextId',
    'timeLimit',
    'victoryArmed',
    'lastBastionAggressor',
    'result',
    'players',
    'units',
    'structures',
    'projectiles',
    'deposits',
    'wreckages',
    ...(version === 2 ? ['spinalPairs'] : []),
  ]);
  const players = array(state.players, `${path}.players`);
  if (players.length !== 2) fail(`${path}.players`, 'expected exactly two players');
  const units = boundedArray(state.units, `${path}.units`, 512).map((unit, index) => readUnit(unit, `${path}.units[${index}]`));
  const structures = boundedArray(state.structures, `${path}.structures`, 256).map((structure, index) =>
    readStructure(structure, `${path}.structures[${index}]`));
  const projectiles = boundedArray(state.projectiles, `${path}.projectiles`, 2048).map((projectile, index) =>
    readProjectile(projectile, `${path}.projectiles[${index}]`));
  const wreckages = boundedArray(state.wreckages, `${path}.wreckages`, 512).map((wreck, index) =>
    readWreck(wreck, `${path}.wreckages[${index}]`));
  assertUniqueEntityIds(units, structures, projectiles, wreckages, path);
  const nextId = integer(state.nextId, `${path}.nextId`, 1);
  const highestId = Math.max(
    0,
    ...units.map((entity) => entity.id),
    ...structures.map((entity) => entity.id),
    ...projectiles.map((entity) => entity.id),
    ...wreckages.map((entity) => entity.id),
  );
  if (nextId <= highestId) fail(`${path}.nextId`, 'must be greater than every entity id');
  const spinalPairs = version === 2
    ? readSpinalPairs(state.spinalPairs, `${path}.spinalPairs`, structures)
    : migrateLegacySpinalState(structures);
  const parsedPlayers: [WorldPlayerPersistenceState, WorldPlayerPersistenceState] = [
    readPlayer(players[0], `${path}.players[0]`),
    readPlayer(players[1], `${path}.players[1]`),
  ];
  if (version === 1) {
    parsedPlayers[Faction.Compact].commandCap = STARTING_COMMAND;
    parsedPlayers[Faction.Choir].commandCap = STARTING_COMMAND;
    for (const structure of structures) {
      if (structure.alive && structure.progress >= 1 && structure.kind === 'spinalNode' && structure.faction >= 0) {
        parsedPlayers[structure.faction as Faction].commandCap += COMMAND_PER_NODE;
      }
    }
  }

  return {
    worldSeed: integer(state.worldSeed, `${path}.worldSeed`, Number.MIN_SAFE_INTEGER),
    terrainSeed: integer(state.terrainSeed, `${path}.terrainSeed`, Number.MIN_SAFE_INTEGER),
    tick: integer(state.tick, `${path}.tick`, 0),
    time: finite(state.time, `${path}.time`, 0),
    rngState: integer(state.rngState, `${path}.rngState`, 0, 0xffffffff),
    nextId,
    timeLimit: finite(state.timeLimit, `${path}.timeLimit`, Number.MIN_VALUE),
    victoryArmed: boolean(state.victoryArmed, `${path}.victoryArmed`),
    lastBastionAggressor: nullableFaction(state.lastBastionAggressor, `${path}.lastBastionAggressor`),
    result: readResult(state.result, `${path}.result`),
    players: parsedPlayers,
    units,
    structures,
    projectiles,
    deposits: boundedArray(state.deposits, `${path}.deposits`, 256).map((deposit, index) =>
      readDeposit(deposit, `${path}.deposits[${index}]`)),
    wreckages,
    spinalPairs,
  };
}

function readSpinalPairs(value: unknown, path: string, structures: readonly Structure[]): SpinalPair[] {
  const pairIds = new Set<string>();
  const memberIds = new Set<number>();
  const pairs = boundedArray(value, path, 128).map((entry, index) => {
    const pairPath = `${path}[${index}]`;
    const pair = object(entry, pairPath, ['id', 'members']);
    const id = symbolicId(pair.id, `${pairPath}.id`);
    if (pairIds.has(id)) fail(`${pairPath}.id`, `duplicate pair id ${id}`);
    pairIds.add(id);
    const members = array(pair.members, `${pairPath}.members`);
    if (members.length !== 2) fail(`${pairPath}.members`, 'expected exactly two members');
    const resolved = members.map((member, memberIndex) =>
      integer(member, `${pairPath}.members[${memberIndex}]`, 1)) as [number, number];
    if (resolved[0] >= resolved[1]) {
      fail(`${pairPath}.members`, 'members must be distinct and in numeric order');
    }
    for (let memberIndex = 0; memberIndex < resolved.length; memberIndex++) {
      const memberId = resolved[memberIndex]!;
      if (memberIds.has(memberId)) fail(`${pairPath}.members[${memberIndex}]`, 'node belongs to more than one pair');
      const structure = structures.find((candidate) => candidate.id === memberId);
      if (!structure) fail(`${pairPath}.members[${memberIndex}]`, 'references a missing member');
      if (!structure.alive) fail(`${pairPath}.members[${memberIndex}]`, 'references a non-live member');
      if (structure.kind !== 'spinalNode') fail(`${pairPath}.members[${memberIndex}]`, 'references a non-Node member');
      if (structure.progress < 1) fail(`${pairPath}.members[${memberIndex}]`, 'references an unfinished member');
      memberIds.add(memberId);
    }
    return { id, members: resolved };
  });
  return pairs.sort((a, b) => a.id.localeCompare(b.id));
}

function migrateLegacySpinalState(structures: Structure[]): SpinalPair[] {
  const nodes = structures.filter((structure) =>
    structure.alive && structure.kind === 'spinalNode' && structure.progress >= 1);
  for (const node of nodes) {
    if (node.faction === Faction.Compact) {
      if (node.capture > 0) {
        node.faction = -1;
        node.capture = 0;
      } else if (node.capture === 0) node.capture = -1;
    } else if (node.faction === Faction.Choir) {
      if (node.capture < 0) {
        node.faction = -1;
        node.capture = 0;
      } else if (node.capture === 0) node.capture = 1;
    }
  }
  const candidates: Array<{ error: number; lower: number; higher: number }> = [];
  for (let firstIndex = 0; firstIndex < nodes.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex++) {
      const first = nodes[firstIndex]!;
      const second = nodes[secondIndex]!;
      const arcError = Math.abs(Math.abs(deltaS(first.s, second.s)) - RING_CIRCUMFERENCE * 0.5);
      const axialError = Math.abs(first.z + second.z);
      const error = Math.hypot(arcError, axialError);
      if (error <= 1) {
        candidates.push({ error, lower: Math.min(first.id, second.id), higher: Math.max(first.id, second.id) });
      }
    }
  }
  candidates.sort((a, b) => a.error - b.error || a.lower - b.lower || a.higher - b.higher);
  const paired = new Set<number>();
  const result: SpinalPair[] = [];
  for (const candidate of candidates) {
    if (paired.has(candidate.lower) || paired.has(candidate.higher)) continue;
    paired.add(candidate.lower);
    paired.add(candidate.higher);
    result.push({
      id: `legacy-${candidate.lower}-${candidate.higher}`,
      members: [candidate.lower, candidate.higher],
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

function readResult(value: unknown, path: string): WorldPersistenceState['result'] {
  const result = object(value, path, ['status', 'winner', 'endReason']);
  const status = matchStatus(result.status, `${path}.status`);
  const winner = nullableFaction(result.winner, `${path}.winner`);
  const endReason = string(result.endReason, `${path}.endReason`);
  if (status === 'running' && (winner !== null || endReason !== '')) {
    fail(path, 'running result must have no winner or end reason');
  }
  if (status === 'completed' && endReason.length === 0) {
    fail(path, 'completed result must have an end reason');
  }
  return { status, winner, endReason };
}

function readPlayer(value: unknown, path: string): WorldPlayerPersistenceState {
  const player = object(value, path, [
    'salvage',
    'commandUsed',
    'commandCap',
    'energyProduced',
    'energyDrawn',
    'weaponEnergyLoad',
    'weaponEnergySchedule',
    'dominance',
    'unlocked',
  ]);
  const unlocked = array(player.unlocked, `${path}.unlocked`).map((kind, index) =>
    structureKind(kind, `${path}.unlocked[${index}]`));
  if (new Set(unlocked).size !== unlocked.length) fail(`${path}.unlocked`, 'contains duplicate entries');
  const weaponEnergyLoad = finite(player.weaponEnergyLoad, `${path}.weaponEnergyLoad`, 0);
  const weaponEnergySchedule = numberArray(
    player.weaponEnergySchedule,
    `${path}.weaponEnergySchedule`,
    Math.round(1 / SIM_DT),
    0,
  );
  const scheduledLoad = weaponEnergySchedule.reduce((total, load) => total + load, 0);
  if (Math.abs(scheduledLoad - weaponEnergyLoad) > 1e-9) {
    fail(`${path}.weaponEnergySchedule`, 'must sum to weaponEnergyLoad');
  }
  return {
    salvage: finite(player.salvage, `${path}.salvage`, 0),
    commandUsed: finite(player.commandUsed, `${path}.commandUsed`, 0),
    commandCap: finite(player.commandCap, `${path}.commandCap`, 0),
    energyProduced: finite(player.energyProduced, `${path}.energyProduced`, 0),
    energyDrawn: finite(player.energyDrawn, `${path}.energyDrawn`, 0),
    weaponEnergyLoad,
    weaponEnergySchedule,
    dominance: finite(player.dominance, `${path}.dominance`, 0),
    unlocked,
  };
}

function readUnit(value: unknown, path: string): Unit {
  const unit = object(value, path, [
    'id', 'alive', 'faction', 'kind', 's', 'z', 'prevS', 'prevZ', 'yaw', 'prevYaw',
    'aimYaw', 'prevAimYaw', 'speed', 'hp', 'maxHp', 'vision', 'buildDuration', 'salvageCost',
    'order', 'cd', 'burst', 'burstTimer', 'targetId', 'revealed', 'gait', 'manualAimYaw',
    'buildTimer', 'buildTargetId', 'ability', 'cloaked', 'stationaryTime', 'damageState',
    'speedMultiplier',
  ]);
  const kind = unitKind(unit.kind, `${path}.kind`);
  const unitFaction = faction(unit.faction, `${path}.faction`);
  if (!canFactionFieldUnit(unitFaction, kind)) fail(path, `${kind} is unavailable to faction ${unitFaction}`);
  const weaponCount = UNITS[kind].weapons.length;
  const ability = readAbility(unit.ability, `${path}.ability`);
  if ((ability?.id ?? null) !== expectedAbility(kind)) {
    fail(`${path}.ability`, `does not match unit kind ${kind}`);
  }
  return {
    id: integer(unit.id, `${path}.id`, 1),
    alive: boolean(unit.alive, `${path}.alive`),
    faction: unitFaction,
    kind,
    s: finite(unit.s, `${path}.s`),
    z: finite(unit.z, `${path}.z`),
    prevS: finite(unit.prevS, `${path}.prevS`),
    prevZ: finite(unit.prevZ, `${path}.prevZ`),
    yaw: finite(unit.yaw, `${path}.yaw`),
    prevYaw: finite(unit.prevYaw, `${path}.prevYaw`),
    aimYaw: finite(unit.aimYaw, `${path}.aimYaw`),
    prevAimYaw: finite(unit.prevAimYaw, `${path}.prevAimYaw`),
    speed: finite(unit.speed, `${path}.speed`),
    hp: finite(unit.hp, `${path}.hp`),
    maxHp: finite(unit.maxHp, `${path}.maxHp`, Number.MIN_VALUE),
    vision: finite(unit.vision, `${path}.vision`, 0),
    buildDuration: finite(unit.buildDuration, `${path}.buildDuration`, 0),
    salvageCost: finite(unit.salvageCost, `${path}.salvageCost`, 0),
    order: readOrder(unit.order, `${path}.order`),
    cd: numberArray(unit.cd, `${path}.cd`, weaponCount),
    burst: numberArray(unit.burst, `${path}.burst`, weaponCount),
    burstTimer: numberArray(unit.burstTimer, `${path}.burstTimer`, weaponCount),
    targetId: integer(unit.targetId, `${path}.targetId`, 0),
    revealed: finite(unit.revealed, `${path}.revealed`, 0),
    gait: finite(unit.gait, `${path}.gait`, 0),
    manualAimYaw: nullableFinite(unit.manualAimYaw, `${path}.manualAimYaw`),
    buildTimer: finite(unit.buildTimer, `${path}.buildTimer`, 0),
    buildTargetId: integer(unit.buildTargetId, `${path}.buildTargetId`, 0),
    ability,
    cloaked: boolean(unit.cloaked, `${path}.cloaked`),
    stationaryTime: finite(unit.stationaryTime, `${path}.stationaryTime`, 0),
    damageState: damageState(unit.damageState, `${path}.damageState`),
    speedMultiplier: finite(unit.speedMultiplier, `${path}.speedMultiplier`, 0),
  };
}

function readOrder(value: unknown, path: string): Order {
  const order = object(value, path, ['kind', 's', 'z', 'targetId'], ['structure']);
  const kind = orderKind(order.kind, `${path}.kind`);
  const result: Order = {
    kind,
    s: finite(order.s, `${path}.s`),
    z: finite(order.z, `${path}.z`),
    targetId: integer(order.targetId, `${path}.targetId`, 0),
  };
  if (order.structure !== undefined) result.structure = structureKind(order.structure, `${path}.structure`);
  return result;
}

function readAbility(value: unknown, path: string): AbilityState | null {
  if (value === null) return null;
  const ability = object(value, path, ['id', 'active', 'cooldown', 'transitionTimer']);
  return {
    id: abilityId(ability.id, `${path}.id`),
    active: boolean(ability.active, `${path}.active`),
    cooldown: finite(ability.cooldown, `${path}.cooldown`, 0),
    transitionTimer: finite(ability.transitionTimer, `${path}.transitionTimer`, 0),
  };
}

function readStructure(value: unknown, path: string): Structure {
  const structure = object(value, path, [
    'id', 'alive', 'faction', 'kind', 's', 'z', 'yaw', 'hp', 'maxHp', 'vision',
    'buildDuration', 'salvageCost', 'progress', 'cd', 'burst', 'burstTimer', 'targetId',
    'revealed', 'queue', 'queueTimer', 'capture',
  ]);
  const kind = structureKind(structure.kind, `${path}.kind`);
  const structureFaction = neutralFaction(structure.faction, `${path}.faction`);
  const weaponCount = STRUCTURES[kind].weapons.length;
  return {
    id: integer(structure.id, `${path}.id`, 1),
    alive: boolean(structure.alive, `${path}.alive`),
    faction: structureFaction,
    kind,
    s: finite(structure.s, `${path}.s`),
    z: finite(structure.z, `${path}.z`),
    yaw: finite(structure.yaw, `${path}.yaw`),
    hp: finite(structure.hp, `${path}.hp`),
    maxHp: finite(structure.maxHp, `${path}.maxHp`, Number.MIN_VALUE),
    vision: finite(structure.vision, `${path}.vision`, 0),
    buildDuration: finite(structure.buildDuration, `${path}.buildDuration`, 0),
    salvageCost: finite(structure.salvageCost, `${path}.salvageCost`, 0),
    progress: finite(structure.progress, `${path}.progress`, 0, 1),
    cd: numberArray(structure.cd, `${path}.cd`, weaponCount),
    burst: numberArray(structure.burst, `${path}.burst`, weaponCount),
    burstTimer: numberArray(structure.burstTimer, `${path}.burstTimer`, weaponCount),
    targetId: integer(structure.targetId, `${path}.targetId`, 0),
    revealed: finite(structure.revealed, `${path}.revealed`, 0),
    queue: boundedArray(structure.queue, `${path}.queue`, 128).map((queued, index) => {
      const queuedKind = unitKind(queued, `${path}.queue[${index}]`);
      if (structureFaction < 0 || !canFactionFieldUnit(structureFaction as Faction, queuedKind)) {
        fail(`${path}.queue[${index}]`, `${queuedKind} is unavailable to the producer faction`);
      }
      return queuedKind;
    }),
    queueTimer: finite(structure.queueTimer, `${path}.queueTimer`, 0),
    capture: finite(structure.capture, `${path}.capture`, -1, 1),
  };
}

function readProjectile(value: unknown, path: string): Projectile {
  const projectile = object(value, path, [
    'id', 'alive', 'faction', 'st', 'p', 'weapon', 'ballistic', 'flightMode', 'targetId',
    'life', 'impactS', 'impactZ', 'doomed', 'sourceS', 'sourceZ',
  ]);
  const st = object(projectile.st, `${path}.st`, ['X', 'Y', 'Z', 'VX', 'VY', 'VZ', 't']);
  const point = object(projectile.p, `${path}.p`, ['s', 'h', 'z']);
  const weapon = weaponId(projectile.weapon, `${path}.weapon`);
  const mode = flightMode(projectile.flightMode, `${path}.flightMode`);
  const ballistic = boolean(projectile.ballistic, `${path}.ballistic`);
  const definition = WEAPONS[weapon]!;
  const expectedMode = definition.kind === 'ballistic' ? definition.flightMode ?? 'ballistic' : 'direct';
  if (mode !== expectedMode || ballistic !== (expectedMode !== 'direct')) {
    fail(path, `projectile mode does not match weapon ${weapon}`);
  }
  return {
    id: integer(projectile.id, `${path}.id`, 1),
    alive: boolean(projectile.alive, `${path}.alive`),
    faction: faction(projectile.faction, `${path}.faction`),
    st: {
      X: finite(st.X, `${path}.st.X`),
      Y: finite(st.Y, `${path}.st.Y`),
      Z: finite(st.Z, `${path}.st.Z`),
      VX: finite(st.VX, `${path}.st.VX`),
      VY: finite(st.VY, `${path}.st.VY`),
      VZ: finite(st.VZ, `${path}.st.VZ`),
      t: finite(st.t, `${path}.st.t`),
    },
    p: {
      s: finite(point.s, `${path}.p.s`),
      h: finite(point.h, `${path}.p.h`),
      z: finite(point.z, `${path}.p.z`),
    },
    weapon,
    ballistic,
    flightMode: mode,
    targetId: integer(projectile.targetId, `${path}.targetId`, 0),
    life: finite(projectile.life, `${path}.life`),
    impactS: finite(projectile.impactS, `${path}.impactS`),
    impactZ: finite(projectile.impactZ, `${path}.impactZ`),
    doomed: boolean(projectile.doomed, `${path}.doomed`),
    sourceS: finite(projectile.sourceS, `${path}.sourceS`),
    sourceZ: finite(projectile.sourceZ, `${path}.sourceZ`),
  };
}

function readDeposit(value: unknown, path: string): Deposit {
  const deposit = object(value, path, ['s', 'z', 'amount', 'claimedBy']);
  return {
    s: finite(deposit.s, `${path}.s`),
    z: finite(deposit.z, `${path}.z`),
    amount: finite(deposit.amount, `${path}.amount`, 0),
    claimedBy: integer(deposit.claimedBy, `${path}.claimedBy`, 0),
  };
}

function readWreck(value: unknown, path: string): Wreck {
  const wreck = object(value, path, [
    'id', 'alive', 'faction', 'kind', 's', 'z', 'yaw', 'hp', 'maxHp', 'lifetime',
  ]);
  return {
    id: integer(wreck.id, `${path}.id`, 1),
    alive: boolean(wreck.alive, `${path}.alive`),
    faction: faction(wreck.faction, `${path}.faction`),
    kind: unitKind(wreck.kind, `${path}.kind`),
    s: finite(wreck.s, `${path}.s`),
    z: finite(wreck.z, `${path}.z`),
    yaw: finite(wreck.yaw, `${path}.yaw`),
    hp: finite(wreck.hp, `${path}.hp`),
    maxHp: finite(wreck.maxHp, `${path}.maxHp`, Number.MIN_VALUE),
    lifetime: finite(wreck.lifetime, `${path}.lifetime`, 0),
  };
}

function assertUniqueEntityIds(
  units: readonly Unit[],
  structures: readonly Structure[],
  projectiles: readonly Projectile[],
  wreckages: readonly Wreck[],
  path: string,
): void {
  const ids = new Set<number>();
  for (const entity of [...units, ...structures, ...projectiles, ...wreckages]) {
    if (ids.has(entity.id)) fail(path, `duplicate entity id ${entity.id}`);
    ids.add(entity.id);
  }
}

function object(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'expected an object');
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unexpected field');
  for (const key of required) if (!(key in value)) fail(`${path}.${key}`, 'missing field');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value;
}

function boundedArray(value: unknown, path: string, maximum: number): unknown[] {
  const values = array(value, path);
  if (values.length > maximum) fail(path, `expected at most ${maximum} entries`);
  return values;
}

function numberArray(value: unknown, path: string, length: number, minimum = -Infinity): number[] {
  const values = array(value, path);
  if (values.length !== length) fail(path, `expected ${length} entries`);
  return values.map((entry, index) => finite(entry, `${path}[${index}]`, minimum));
}

function finite(value: unknown, path: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `expected a finite number in [${minimum}, ${maximum}]`);
  }
  return value;
}

function nullableFinite(value: unknown, path: string): number | null {
  return value === null ? null : finite(value, path);
}

function integer(value: unknown, path: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = finite(value, path, minimum, maximum);
  if (!Number.isSafeInteger(result)) fail(path, 'expected a safe integer');
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'expected a string');
  return value;
}

function symbolicId(value: unknown, path: string): string {
  const id = string(value, path);
  if (
    id.length === 0 || id.length > 64 ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(id) ||
    id === 'constructor' || id === 'prototype'
  ) {
    fail(path, 'expected a safe symbolic id');
  }
  return id;
}

function faction(value: unknown, path: string): Faction {
  if (value === Faction.Compact) return Faction.Compact;
  if (value === Faction.Choir) return Faction.Choir;
  return fail(path, 'expected a faction');
}

function nullableFaction(value: unknown, path: string): Faction | null {
  return value === null ? null : faction(value, path);
}

function neutralFaction(value: unknown, path: string): Faction | -1 {
  return value === -1 ? -1 : faction(value, path);
}

function unitKind(value: unknown, path: string): UnitKind {
  switch (value) {
    case 'vanguard': case 'longbow': case 'wisp': case 'aegis': case 'bulwark': case 'needle':
    case 'engineer': return value;
    default: return fail(path, 'expected a unit kind');
  }
}

function structureKind(value: unknown, path: string): StructureKind {
  switch (value) {
    case 'bastion': case 'extractor': case 'solarArray': case 'fusionCore': case 'fabricator':
    case 'mechFoundry': case 'rocketBattery': case 'pointDefense': case 'laserGrid':
    case 'radarMast': case 'silo': case 'spinalNode': return value;
    default: return fail(path, 'expected a structure kind');
  }
}

function orderKind(value: unknown, path: string): OrderKind {
  switch (value) {
    case 'idle': case 'move': case 'attack': case 'attackMove': case 'build': case 'capture': return value;
    default: return fail(path, 'expected an order kind');
  }
}

function abilityId(value: unknown, path: string): AbilityId {
  switch (value) {
    case 'shieldWall': case 'siegeMode': case 'cloak': case 'umbrella': return value;
    default: return fail(path, 'expected an ability id');
  }
}

function expectedAbility(kind: UnitKind): AbilityId | null {
  for (const ability of Object.values(ABILITIES)) {
    if ((ability.unitKinds as readonly UnitKind[]).includes(kind)) return ability.id;
  }
  return null;
}

function damageState(value: unknown, path: string): 0 | 1 | 2 {
  if (value === 0 || value === 1 || value === 2) return value;
  return fail(path, 'expected damage state 0, 1, or 2');
}

function flightMode(value: unknown, path: string): Projectile['flightMode'] {
  switch (value) {
    case 'direct': case 'ballistic': case 'cruise': case 'chord': return value;
    default: return fail(path, 'expected a projectile flight mode');
  }
}

function weaponId(value: unknown, path: string): string {
  const id = string(value, path);
  if (WEAPONS[id] === undefined) fail(path, 'expected a known weapon id');
  return id;
}

function matchStatus(value: unknown, path: string): MatchStatus {
  if (value === 'running' || value === 'completed') return value;
  return fail(path, 'expected running or completed');
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return fail('$', 'invalid JSON');
  }
}

function assertTerrainCompatible(state: WorldPersistenceState, terrain: Terrain): void {
  let suppliedSeed: number;
  try {
    suppliedSeed = resolveTerrainSeed(terrain, state.worldSeed);
  } catch (error) {
    return fail('terrain.seed', error instanceof Error ? error.message : 'invalid terrain seed');
  }
  if (suppliedSeed !== state.terrainSeed) {
    fail('terrain.seed', `terrain seed mismatch: save requires ${state.terrainSeed}, supplied ${suppliedSeed}`);
  }
}

function fail(path: string, message: string): never {
  throw new SnapshotValidationError(`${path}: ${message}`);
}
