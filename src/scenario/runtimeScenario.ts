import type { Difficulty } from '@ai/opponent';
import { RING_CIRCUMFERENCE, RING_HALF_WIDTH } from '@core/constants';
import {
  canFactionFieldUnit,
  Faction,
  STRUCTURES,
  UNITS,
  type StructureKind,
  type UnitKind,
} from '@sim/data';

export const RUNTIME_SCENARIO_SCHEMA = 'ring-world-war/runtime-scenario';
export const RUNTIME_SCENARIO_VERSION = 2;

export interface RuntimeScenarioPlayer {
  faction: Faction;
  salvage: number;
  dominance: number;
}

export interface RuntimeScenarioAi {
  enabled: boolean;
  difficulty: Difficulty;
}

export interface RuntimeScenarioOpeningView {
  focusS: number;
  focusZ: number;
  yawRadians: number;
  zoom: number;
  actionEntities: string[];
  contextEntities: string[];
  highlightDeposits: boolean;
}

export type RuntimeScenarioOrder =
  | { kind: 'idle' }
  | { kind: 'move' | 'attackMove'; s: number; z: number }
  | { kind: 'attack' | 'build'; target: string };

export interface RuntimeScenarioUnit {
  id: string;
  faction: Faction;
  kind: UnitKind;
  s: number;
  z: number;
  yawRadians?: number;
  healthFraction?: number;
  order: RuntimeScenarioOrder;
}

export interface RuntimeScenarioStructure {
  id: string;
  faction: Faction | -1;
  kind: StructureKind;
  s: number;
  z: number;
  progress: number;
  yawRadians?: number;
  healthFraction?: number;
}

export interface RuntimeScenarioDeposit {
  s: number;
  z: number;
  amount: number;
  claimedBy?: string;
}

export interface RuntimeScenarioBinding {
  id: string;
  entity: string;
}

export interface RuntimeScenarioSpinalPair {
  id: string;
  members: [string, string];
}

export interface RuntimeScenario {
  schema: typeof RUNTIME_SCENARIO_SCHEMA;
  version: typeof RUNTIME_SCENARIO_VERSION;
  id: string;
  worldSeed: number;
  playerFaction: Faction;
  ai: RuntimeScenarioAi;
  openingView: RuntimeScenarioOpeningView;
  players: [RuntimeScenarioPlayer, RuntimeScenarioPlayer];
  structures: RuntimeScenarioStructure[];
  units: RuntimeScenarioUnit[];
  deposits: RuntimeScenarioDeposit[];
  bindings: RuntimeScenarioBinding[];
  spinalPairs: RuntimeScenarioSpinalPair[];
}

export class RuntimeScenarioValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeScenarioValidationError';
  }
}

export function parseRuntimeScenario(input: unknown): RuntimeScenario {
  const value = typeof input === 'string' ? parseJson(input) : input;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('$', 'expected an object');
  const inputVersion = (value as Record<string, unknown>).version;
  const root = object(value, '$', [
    'schema',
    'version',
    'id',
    'worldSeed',
    'playerFaction',
    'ai',
    'openingView',
    'players',
    'structures',
    'units',
    'deposits',
    'bindings',
    ...(inputVersion === 1 ? [] : ['spinalPairs']),
  ]);
  if (root.schema !== RUNTIME_SCENARIO_SCHEMA) {
    fail('$.schema', `expected ${RUNTIME_SCENARIO_SCHEMA}`);
  }
  if (root.version !== 1 && root.version !== RUNTIME_SCENARIO_VERSION) {
    fail('$.version', `expected version 1 or ${RUNTIME_SCENARIO_VERSION}`);
  }

  const playerValues = boundedArray(root.players, '$.players', 2);
  if (playerValues.length !== 2) fail('$.players', 'expected exactly two players');
  const players = playerValues.map((player, index) => readPlayer(player, `$.players[${index}]`)) as [
    RuntimeScenarioPlayer,
    RuntimeScenarioPlayer,
  ];
  if (players[0].faction === players[1].faction) fail('$.players', 'must declare each faction exactly once');

  const structures = boundedArray(root.structures, '$.structures', 256).map((structure, index) =>
    readStructure(structure, `$.structures[${index}]`));
  const units = boundedArray(root.units, '$.units', 512).map((unit, index) =>
    readUnit(unit, `$.units[${index}]`));
  const deposits = boundedArray(root.deposits, '$.deposits', 256).map((deposit, index) =>
    readDeposit(deposit, `$.deposits[${index}]`));
  const bindings = boundedArray(root.bindings, '$.bindings', 128).map((binding, index) =>
    readBinding(binding, `$.bindings[${index}]`));
  const spinalPairs = root.version === 1
    ? []
    : boundedArray(root.spinalPairs, '$.spinalPairs', 128).map((pair, index) =>
        readSpinalPair(pair, `$.spinalPairs[${index}]`)).sort((a, b) => a.id.localeCompare(b.id));
  const openingView = readOpeningView(root.openingView, '$.openingView');

  validateReferences(structures, units, deposits, bindings, spinalPairs, openingView);

  return {
    schema: RUNTIME_SCENARIO_SCHEMA,
    version: RUNTIME_SCENARIO_VERSION,
    id: symbolicId(root.id, '$.id'),
    worldSeed: integer(root.worldSeed, '$.worldSeed'),
    playerFaction: faction(root.playerFaction, '$.playerFaction'),
    ai: readAi(root.ai, '$.ai'),
    openingView,
    players,
    structures,
    units,
    deposits,
    bindings,
    spinalPairs,
  };
}

function readOpeningView(value: unknown, path: string): RuntimeScenarioOpeningView {
  const view = object(value, path, [
    'focusS',
    'focusZ',
    'yawRadians',
    'zoom',
    'actionEntities',
    'contextEntities',
    'highlightDeposits',
  ]);
  const actionEntities = boundedArray(view.actionEntities, `${path}.actionEntities`, 32).map((id, index) =>
    symbolicId(id, `${path}.actionEntities[${index}]`));
  const contextEntities = boundedArray(view.contextEntities, `${path}.contextEntities`, 32).map((id, index) =>
    symbolicId(id, `${path}.contextEntities[${index}]`));
  if (new Set(actionEntities).size !== actionEntities.length) {
    fail(`${path}.actionEntities`, 'contains duplicate symbolic ids');
  }
  if (new Set(contextEntities).size !== contextEntities.length) {
    fail(`${path}.contextEntities`, 'contains duplicate symbolic ids');
  }
  return {
    focusS: arcPosition(view.focusS, `${path}.focusS`),
    focusZ: axialPosition(view.focusZ, `${path}.focusZ`),
    yawRadians: finite(view.yawRadians, `${path}.yawRadians`),
    zoom: finite(view.zoom, `${path}.zoom`, 45, 1_150),
    actionEntities,
    contextEntities,
    highlightDeposits: boolean(view.highlightDeposits, `${path}.highlightDeposits`),
  };
}

function readAi(value: unknown, path: string): RuntimeScenarioAi {
  const ai = object(value, path, ['enabled', 'difficulty']);
  return {
    enabled: boolean(ai.enabled, `${path}.enabled`),
    difficulty: difficulty(ai.difficulty, `${path}.difficulty`),
  };
}

function readPlayer(value: unknown, path: string): RuntimeScenarioPlayer {
  const player = object(value, path, ['faction', 'salvage'], ['dominance']);
  return {
    faction: faction(player.faction, `${path}.faction`),
    salvage: finite(player.salvage, `${path}.salvage`, 0),
    dominance: player.dominance === undefined ? 0 : finite(player.dominance, `${path}.dominance`, 0),
  };
}

function readUnit(value: unknown, path: string): RuntimeScenarioUnit {
  const unit = object(
    value,
    path,
    ['id', 'faction', 'kind', 's', 'z'],
    ['yawRadians', 'healthFraction', 'order'],
  );
  const unitFaction = faction(unit.faction, `${path}.faction`);
  const kind = unitKind(unit.kind, `${path}.kind`);
  if (!canFactionFieldUnit(unitFaction, kind)) {
    fail(`${path}.kind`, `${kind} is unavailable to faction ${factionLabel(unitFaction)}`);
  }
  const result: RuntimeScenarioUnit = {
    id: symbolicId(unit.id, `${path}.id`),
    faction: unitFaction,
    kind,
    s: arcPosition(unit.s, `${path}.s`),
    z: axialPosition(unit.z, `${path}.z`),
    order: unit.order === undefined ? { kind: 'idle' } : readOrder(unit.order, `${path}.order`),
  };
  if (unit.yawRadians !== undefined) result.yawRadians = finite(unit.yawRadians, `${path}.yawRadians`);
  if (unit.healthFraction !== undefined) {
    result.healthFraction = finite(unit.healthFraction, `${path}.healthFraction`, Number.MIN_VALUE, 1);
  }
  return result;
}

function readOrder(value: unknown, path: string): RuntimeScenarioOrder {
  const discriminator = object(value, path, ['kind'], ['s', 'z', 'target']);
  switch (discriminator.kind) {
    case 'idle': {
      object(value, path, ['kind']);
      return { kind: 'idle' };
    }
    case 'move':
    case 'attackMove': {
      const order = object(value, path, ['kind', 's', 'z']);
      return {
        kind: discriminator.kind,
        s: arcPosition(order.s, `${path}.s`),
        z: axialPosition(order.z, `${path}.z`),
      };
    }
    case 'attack':
    case 'build': {
      const order = object(value, path, ['kind', 'target']);
      return { kind: discriminator.kind, target: symbolicId(order.target, `${path}.target`) };
    }
    default:
      return fail(`${path}.kind`, 'expected idle, move, attackMove, attack, or build');
  }
}

function readStructure(value: unknown, path: string): RuntimeScenarioStructure {
  const structure = object(
    value,
    path,
    ['id', 'faction', 'kind', 's', 'z', 'progress'],
    ['yawRadians', 'healthFraction'],
  );
  const structureFaction = neutralFaction(structure.faction, `${path}.faction`);
  const kind = structureKind(structure.kind, `${path}.kind`);
  if (structureFaction === -1 && !STRUCTURES[kind].neutral) {
    fail(`${path}.faction`, `only neutral structures may use faction neutral`);
  }
  const result: RuntimeScenarioStructure = {
    id: symbolicId(structure.id, `${path}.id`),
    faction: structureFaction,
    kind,
    s: arcPosition(structure.s, `${path}.s`),
    z: axialPosition(structure.z, `${path}.z`),
    progress: finite(structure.progress, `${path}.progress`, 0, 1),
  };
  if (structure.yawRadians !== undefined) {
    result.yawRadians = finite(structure.yawRadians, `${path}.yawRadians`);
  }
  if (structure.healthFraction !== undefined) {
    result.healthFraction = finite(structure.healthFraction, `${path}.healthFraction`, Number.MIN_VALUE, 1);
  }
  return result;
}

function readDeposit(value: unknown, path: string): RuntimeScenarioDeposit {
  const deposit = object(value, path, ['s', 'z', 'amount'], ['claimedBy']);
  const result: RuntimeScenarioDeposit = {
    s: arcPosition(deposit.s, `${path}.s`),
    z: axialPosition(deposit.z, `${path}.z`),
    amount: finite(deposit.amount, `${path}.amount`, Number.MIN_VALUE),
  };
  if (deposit.claimedBy !== undefined) {
    result.claimedBy = symbolicId(deposit.claimedBy, `${path}.claimedBy`);
  }
  return result;
}

function readBinding(value: unknown, path: string): RuntimeScenarioBinding {
  const binding = object(value, path, ['id', 'entity']);
  return {
    id: symbolicId(binding.id, `${path}.id`),
    entity: symbolicId(binding.entity, `${path}.entity`),
  };
}

function readSpinalPair(value: unknown, path: string): RuntimeScenarioSpinalPair {
  const pair = object(value, path, ['id', 'members']);
  const members = boundedArray(pair.members, `${path}.members`, 2);
  if (members.length !== 2) fail(`${path}.members`, 'expected exactly two members');
  return {
    id: symbolicId(pair.id, `${path}.id`),
    members: [
      symbolicId(members[0], `${path}.members[0]`),
      symbolicId(members[1], `${path}.members[1]`),
    ],
  };
}

function validateReferences(
  structures: readonly RuntimeScenarioStructure[],
  units: readonly RuntimeScenarioUnit[],
  deposits: readonly RuntimeScenarioDeposit[],
  bindings: readonly RuntimeScenarioBinding[],
  spinalPairs: readonly RuntimeScenarioSpinalPair[],
  openingView: RuntimeScenarioOpeningView,
): void {
  const entities = new Map<string, RuntimeScenarioStructure | RuntimeScenarioUnit>();
  for (const entity of [...structures, ...units]) {
    if (entities.has(entity.id)) fail('$', `duplicate symbolic id ${entity.id}`);
    entities.set(entity.id, entity);
  }

  for (let index = 0; index < units.length; index++) {
    const unit = units[index]!;
    const order = unit.order;
    if (order.kind !== 'attack' && order.kind !== 'build') continue;
    const target = entities.get(order.target);
    if (!target) fail(`$.units[${index}].order.target`, 'must reference a declared entity');
    if (order.kind === 'attack') {
      if (target.faction === -1 || target.faction === unit.faction) {
        fail(`$.units[${index}].order.target`, 'attack target must be a hostile faction entity');
      }
      continue;
    }
    if (!UNITS[unit.kind].canBuild) {
      fail(`$.units[${index}].order`, `${unit.kind} cannot receive build orders`);
    }
    if (!('progress' in target) || target.faction !== unit.faction || target.progress >= 1) {
      fail(`$.units[${index}].order.target`, 'build target must be an unfinished friendly structure');
    }
  }

  for (let index = 0; index < deposits.length; index++) {
    const claimedBy = deposits[index]!.claimedBy;
    if (claimedBy === undefined) continue;
    const claimant = entities.get(claimedBy);
    if (!claimant) fail(`$.deposits[${index}].claimedBy`, 'must reference a declared entity');
    if (!('progress' in claimant) || claimant.kind !== 'extractor') {
      fail(`$.deposits[${index}].claimedBy`, 'must reference an extractor');
    }
  }

  const bindingIds = new Set<string>();
  for (let index = 0; index < bindings.length; index++) {
    const binding = bindings[index]!;
    if (bindingIds.has(binding.id)) fail(`$.bindings[${index}].id`, `duplicate binding id ${binding.id}`);
    bindingIds.add(binding.id);
    if (!entities.has(binding.entity)) {
      fail(`$.bindings[${index}].entity`, 'must reference a declared entity');
    }
  }


  const pairIds = new Set<string>();
  const pairMembers = new Set<string>();
  for (let index = 0; index < spinalPairs.length; index++) {
    const pair = spinalPairs[index]!;
    if (pairIds.has(pair.id)) fail(`$.spinalPairs[${index}].id`, `duplicate pair id ${pair.id}`);
    pairIds.add(pair.id);
    if (pair.members[0] === pair.members[1]) {
      fail(`$.spinalPairs[${index}].members`, 'members must be distinct');
    }
    for (let memberIndex = 0; memberIndex < pair.members.length; memberIndex++) {
      const memberId = pair.members[memberIndex]!;
      if (pairMembers.has(memberId)) {
        fail(`$.spinalPairs[${index}].members[${memberIndex}]`, 'node belongs to more than one pair');
      }
      const member = entities.get(memberId);
      if (!member) fail(`$.spinalPairs[${index}].members[${memberIndex}]`, 'must reference a declared entity');
      if (!('progress' in member) || member.kind !== 'spinalNode') {
        fail(`$.spinalPairs[${index}].members[${memberIndex}]`, 'must reference a Spinal Node');
      }
      if (member.progress < 1) fail(`$.spinalPairs[${index}].members[${memberIndex}]`, 'must reference a completed Node');
      pairMembers.add(memberId);
    }
  }

  for (const [group, ids] of [
    ['actionEntities', openingView.actionEntities],
    ['contextEntities', openingView.contextEntities],
  ] as const) {
    for (let index = 0; index < ids.length; index++) {
      if (!entities.has(ids[index]!)) {
        fail(`$.openingView.${group}[${index}]`, 'must reference a declared entity');
      }
    }
  }
}

function object(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'expected an object');
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unexpected field');
  for (const key of required) if (!(key in record)) fail(`${path}.${key}`, 'missing field');
  return record;
}

function boundedArray(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (value.length > maximum) fail(path, `expected at most ${maximum} entries`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(path, 'expected a safe integer');
  return value;
}

function finite(value: unknown, path: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `expected a finite number in [${minimum}, ${maximum}]`);
  }
  return value;
}

function arcPosition(value: unknown, path: string): number {
  const result = finite(value, path, 0);
  if (result >= RING_CIRCUMFERENCE) fail(path, `expected a finite number below ${RING_CIRCUMFERENCE}`);
  return result;
}

function axialPosition(value: unknown, path: string): number {
  return finite(value, path, -RING_HALF_WIDTH + 40, RING_HALF_WIDTH - 40);
}

function symbolicId(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value) ||
    value === 'constructor' ||
    value === 'prototype'
  ) {
    fail(path, 'expected a safe symbolic id');
  }
  return value;
}

function faction(value: unknown, path: string): Faction {
  if (value === 'compact') return Faction.Compact;
  if (value === 'choir') return Faction.Choir;
  return fail(path, 'expected compact or choir');
}

function neutralFaction(value: unknown, path: string): Faction | -1 {
  return value === 'neutral' ? -1 : faction(value, path);
}

function unitKind(value: unknown, path: string): UnitKind {
  if (typeof value === 'string' && Object.hasOwn(UNITS, value)) return value as UnitKind;
  return fail(path, 'expected a unit kind');
}

function structureKind(value: unknown, path: string): StructureKind {
  if (typeof value === 'string' && Object.hasOwn(STRUCTURES, value)) return value as StructureKind;
  return fail(path, 'expected a structure kind');
}

function difficulty(value: unknown, path: string): Difficulty {
  if (value === 'recruit' || value === 'veteran' || value === 'commander') return value;
  return fail(path, 'expected recruit, veteran, or commander');
}

function factionLabel(value: Faction): string {
  return value === Faction.Compact ? 'compact' : 'choir';
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return fail('$', 'invalid JSON');
  }
}

function fail(path: string, message: string): never {
  throw new RuntimeScenarioValidationError(`${path}: ${message}`);
}
