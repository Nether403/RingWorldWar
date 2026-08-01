import type { Difficulty } from '@ai/opponent';
import { createTerrain, type Terrain } from '@gen/terrain';
import {
  runHeadlessMatch,
  type HeadlessMatchConfig,
  type HeadlessMatchObservation,
  type MatchResult,
} from '@headless/runner';
import { Faction, UNITS } from '@sim/data';
import type { SimEvent } from '@sim/world';

export const CORE_MATCH_MANIFEST_SCHEMA = 'ring-world-war/core-match-manifest';
export const CORE_MATCH_MANIFEST_VERSION = 1;

export interface CoreMatchRole {
  id: string;
  difficulty: Difficulty;
}

export interface CoreMatchRangeGate {
  minimum: number;
  maximum: number;
}

export interface CoreMatchRoleWinRateGate {
  roleId: string;
  minimum?: number;
  maximum?: number;
}

export interface CoreMatchGatePolicy {
  expectedMatches: number;
  meanDurationSeconds: CoreMatchRangeGate;
  maximumFactionWinRate: number;
  maximumDrawRate: number;
  roleWinRates: CoreMatchRoleWinRateGate[];
}

export interface CoreMatchManifest {
  schema: typeof CORE_MATCH_MANIFEST_SCHEMA;
  version: typeof CORE_MATCH_MANIFEST_VERSION;
  id: string;
  description: string;
  pairSeeds: number[];
  legsPerSeed: 1 | 2;
  tickLimit: number;
  telemetryCadenceTicks: number;
  roles: [CoreMatchRole, CoreMatchRole];
  gates: CoreMatchGatePolicy;
}

export interface ExpandedCoreMatch extends HeadlessMatchConfig {
  matchId: string;
  pairIndex: number;
  leg: 'a' | 'b';
  roleByFaction: Record<Faction, string>;
}

export interface CoreMatchMilestone {
  tick: number;
  seconds: number;
  faction?: Faction;
}

export interface CoreMatchMilestones {
  firstContact?: CoreMatchMilestone;
  firstProduction?: CoreMatchMilestone;
  firstCombat?: CoreMatchMilestone;
  firstBastionDamage?: CoreMatchMilestone;
}

export interface CoreMatchFactionSample {
  salvage: number;
  netPower: number;
  dominance: number;
  aliveCombatUnits: number;
  idleCombatUnits: number;
  queuedUnits: number;
  structures: number;
  bastionHp: number;
  bastionMaxHp: number;
}

export interface CoreMatchSample {
  tick: number;
  seconds: number;
  factions: Record<Faction, CoreMatchFactionSample>;
}

export interface CoreMatchFactionInactivity {
  noCombatUnits: boolean;
  allCombatUnitsIdle: boolean;
  productionQueuesEmpty: boolean;
}

export interface CoreMatchTimeline {
  milestones: CoreMatchMilestones;
  samples: CoreMatchSample[];
  lastProgressTick: number;
  noProgressForTelemetryWindow: boolean;
  terminalInactivity: Record<Faction, CoreMatchFactionInactivity>;
}

export interface CoreMatchTimelineCollector {
  observe(observation: HeadlessMatchObservation): void;
  finish(): CoreMatchTimeline;
}

export interface CoreMatchRecord {
  match: ExpandedCoreMatch;
  result: MatchResult;
  timeline: CoreMatchTimeline;
  /** Observational only. Gate evaluation never reads this field. */
  wallClockMilliseconds?: number;
}

export interface CoreMatchFactionSummary {
  wins: number;
  winRate: number;
}

export interface CoreMatchRoleSummary {
  difficulty: Difficulty;
  matches: number;
  wins: number;
  winRate: number;
}

export interface CoreMatchSummary {
  matches: number;
  draws: number;
  drawRate: number;
  meanDurationSeconds: number;
  factions: Record<Faction, CoreMatchFactionSummary>;
  roles: Record<string, CoreMatchRoleSummary>;
  endReasons: Record<string, number>;
  wallClock?: {
    measuredMatches: number;
    totalMilliseconds: number;
    meanMilliseconds: number;
  };
}

export interface CoreMatchGateCheck {
  id: string;
  passed: boolean;
  actual: number;
  expectation: string;
}

export interface CoreMatchGateEvaluation {
  passed: boolean;
  checks: CoreMatchGateCheck[];
}

export interface CoreMatchReport {
  manifest: CoreMatchManifest;
  summary: CoreMatchSummary;
  gates: CoreMatchGateEvaluation;
  matches: readonly CoreMatchRecord[];
}

export interface RunCoreMatchOptions {
  terrainFactory?: (seed: number) => Terrain;
  /** Disabled by default and excluded from every deterministic gate. */
  measureWallClock?: boolean;
}

export class CoreMatchManifestValidationError extends TypeError {}

const FACTIONS = [Faction.Compact, Faction.Choir] as const;
const PROGRESS_EVENTS = new Set<SimEvent['kind']>([
  'weaponFired',
  'impact',
  'unitDied',
  'structureDied',
  'structureComplete',
  'unitComplete',
  'intercepted',
  'nodeCaptured',
  'damageStateChanged',
]);

export function parseCoreMatchManifest(input: unknown): CoreMatchManifest {
  const root = readObject(input, '$', [
    'schema',
    'version',
    'id',
    'description',
    'pairSeeds',
    'legsPerSeed',
    'tickLimit',
    'telemetryCadenceTicks',
    'roles',
    'gates',
  ]);
  if (root.schema !== CORE_MATCH_MANIFEST_SCHEMA) fail('$.schema', `expected ${CORE_MATCH_MANIFEST_SCHEMA}`);
  if (root.version !== CORE_MATCH_MANIFEST_VERSION) fail('$.version', `expected ${CORE_MATCH_MANIFEST_VERSION}`);

  const id = readNonEmptyString(root.id, '$.id');
  const description = readNonEmptyString(root.description, '$.description');
  const pairSeeds = readArray(root.pairSeeds, '$.pairSeeds').map((seed, index) =>
    readInteger(seed, `$.pairSeeds[${index}]`));
  if (pairSeeds.length === 0) fail('$.pairSeeds', 'must contain at least one seed');
  if (new Set(pairSeeds).size !== pairSeeds.length) fail('$.pairSeeds', 'must contain unique exact seeds');
  const legsPerSeedValue = readInteger(root.legsPerSeed, '$.legsPerSeed');
  if (legsPerSeedValue !== 1 && legsPerSeedValue !== 2) {
    fail('$.legsPerSeed', 'expected 1 or 2');
  }
  const legsPerSeed = legsPerSeedValue as 1 | 2;

  const tickLimit = readPositiveInteger(root.tickLimit, '$.tickLimit');
  const telemetryCadenceTicks = readPositiveInteger(root.telemetryCadenceTicks, '$.telemetryCadenceTicks');
  if (telemetryCadenceTicks > tickLimit) {
    fail('$.telemetryCadenceTicks', 'must not exceed tickLimit');
  }

  const roleValues = readArray(root.roles, '$.roles');
  if (roleValues.length !== 2) fail('$.roles', 'must contain exactly two roles');
  const roles = roleValues.map((role, index) => readRole(role, `$.roles[${index}]`)) as [
    CoreMatchRole,
    CoreMatchRole,
  ];
  if (roles[0].id === roles[1].id) fail('$.roles', 'role ids must be distinct');

  const gates = readGates(root.gates, '$.gates', new Set(roles.map((role) => role.id)));
  const expectedMatches = pairSeeds.length * legsPerSeed;
  if (gates.expectedMatches !== expectedMatches) {
    fail(
      '$.gates.expectedMatches',
      `must equal pairSeeds.length * legsPerSeed (${expectedMatches})`,
    );
  }

  return {
    schema: CORE_MATCH_MANIFEST_SCHEMA,
    version: CORE_MATCH_MANIFEST_VERSION,
    id,
    description,
    pairSeeds,
    legsPerSeed,
    tickLimit,
    telemetryCadenceTicks,
    roles,
    gates,
  };
}

export function expandCoreMatchManifest(manifest: CoreMatchManifest): ExpandedCoreMatch[] {
  return manifest.pairSeeds.flatMap((seed, index) => {
    const pairIndex = index + 1;
    const legs = [
      createExpandedMatch(manifest, seed, pairIndex, 'a', manifest.roles[0], manifest.roles[1]),
      createExpandedMatch(manifest, seed, pairIndex, 'b', manifest.roles[1], manifest.roles[0]),
    ];
    return legs.slice(0, manifest.legsPerSeed);
  });
}

export function collectCoreMatchTimeline(telemetryCadenceTicks: number): CoreMatchTimelineCollector {
  if (!Number.isSafeInteger(telemetryCadenceTicks) || telemetryCadenceTicks <= 0) {
    throw new TypeError('telemetryCadenceTicks must be a positive safe integer');
  }
  const milestones: CoreMatchMilestones = {};
  const samples: CoreMatchSample[] = [];
  let lastProgressTick = 0;
  let terminalObservation: HeadlessMatchObservation | undefined;

  return {
    observe(observation): void {
      terminalObservation = observation;
      if (milestones.firstContact === undefined) {
        const contactFaction = findContactFaction(observation);
        if (contactFaction !== undefined) {
          milestones.firstContact = milestone(observation, contactFaction);
          lastProgressTick = observation.tick;
        }
      }
      for (const event of observation.events) {
        if (PROGRESS_EVENTS.has(event.kind)) lastProgressTick = observation.tick;
        if (milestones.firstProduction === undefined && event.kind === 'unitComplete' && isFaction(event.faction)) {
          milestones.firstProduction = milestone(observation, event.faction);
        }
        if (milestones.firstCombat === undefined && event.kind === 'weaponFired' && isFaction(event.faction)) {
          milestones.firstCombat = milestone(observation, event.faction);
        }
      }
      if (milestones.firstBastionDamage === undefined) {
        const damagedFaction = findDamagedBastionFaction(observation);
        if (damagedFaction !== undefined) {
          milestones.firstBastionDamage = milestone(observation, damagedFaction);
          lastProgressTick = observation.tick;
        }
      }
      if (observation.tick % telemetryCadenceTicks === 0) {
        samples.push(createSample(observation));
      }
    },
    finish(): CoreMatchTimeline {
      if (terminalObservation === undefined) throw new Error('Cannot finish a timeline without observations');
      return {
        milestones: { ...milestones },
        samples: [...samples],
        lastProgressTick,
        noProgressForTelemetryWindow:
          terminalObservation.tick - lastProgressTick >= telemetryCadenceTicks,
        terminalInactivity: {
          [Faction.Compact]: inactivityFor(terminalObservation, Faction.Compact),
          [Faction.Choir]: inactivityFor(terminalObservation, Faction.Choir),
        },
      };
    },
  };
}

export function runCoreMatchCohort(
  manifest: CoreMatchManifest,
  options: RunCoreMatchOptions = {},
): CoreMatchRecord[] {
  const terrainFactory = options.terrainFactory ?? createTerrain;
  return expandCoreMatchManifest(manifest).map((match) => {
    const timeline = collectCoreMatchTimeline(manifest.telemetryCadenceTicks);
    const started = options.measureWallClock === true ? Date.now() : 0;
    const result = runHeadlessMatch(match, terrainFactory(match.seed), timeline.observe);
    const record: CoreMatchRecord = { match, result, timeline: timeline.finish() };
    if (options.measureWallClock === true) record.wallClockMilliseconds = Date.now() - started;
    return record;
  });
}

export function summarizeCoreMatches(
  manifest: CoreMatchManifest,
  records: readonly CoreMatchRecord[],
): CoreMatchSummary {
  const factions: Record<Faction, CoreMatchFactionSummary> = {
    [Faction.Compact]: { wins: 0, winRate: 0 },
    [Faction.Choir]: { wins: 0, winRate: 0 },
  };
  const roles: Record<string, CoreMatchRoleSummary> = Object.fromEntries(
    manifest.roles.map((role) => [role.id, { difficulty: role.difficulty, matches: 0, wins: 0, winRate: 0 }]),
  );
  const endReasons: Record<string, number> = {};
  const wallClockValues: number[] = [];
  let durationSeconds = 0;
  let draws = 0;

  for (const record of records) {
    durationSeconds += record.result.durationSeconds;
    endReasons[record.result.endReason] = (endReasons[record.result.endReason] ?? 0) + 1;
    if (record.wallClockMilliseconds !== undefined) wallClockValues.push(record.wallClockMilliseconds);
    if (record.result.winner === null) draws++;
    else factions[record.result.winner].wins++;
    for (const faction of FACTIONS) {
      const role = roles[record.match.roleByFaction[faction]];
      if (role === undefined) throw new Error(`Match ${record.match.matchId} references an unknown role`);
      role.matches++;
      if (record.result.winner === faction) role.wins++;
    }
  }

  const count = records.length;
  for (const faction of FACTIONS) factions[faction].winRate = rate(factions[faction].wins, count);
  for (const role of Object.values(roles)) role.winRate = rate(role.wins, role.matches);

  const summary: CoreMatchSummary = {
    matches: count,
    draws,
    drawRate: rate(draws, count),
    meanDurationSeconds: rate(durationSeconds, count),
    factions,
    roles,
    endReasons,
  };
  if (wallClockValues.length > 0) {
    const totalMilliseconds = wallClockValues.reduce((total, value) => total + value, 0);
    summary.wallClock = {
      measuredMatches: wallClockValues.length,
      totalMilliseconds,
      meanMilliseconds: totalMilliseconds / wallClockValues.length,
    };
  }
  return summary;
}

export function evaluateCoreMatchGates(
  manifest: CoreMatchManifest,
  summary: CoreMatchSummary,
): CoreMatchGateEvaluation {
  const checks: CoreMatchGateCheck[] = [
    equalCheck('cohort-size', summary.matches, manifest.gates.expectedMatches),
    minimumCheck(
      'mean-duration-minimum',
      summary.meanDurationSeconds,
      manifest.gates.meanDurationSeconds.minimum,
    ),
    maximumCheck(
      'mean-duration-maximum',
      summary.meanDurationSeconds,
      manifest.gates.meanDurationSeconds.maximum,
    ),
    maximumCheck(
      'faction:compact:maximum-win-rate',
      summary.factions[Faction.Compact].winRate,
      manifest.gates.maximumFactionWinRate,
    ),
    maximumCheck(
      'faction:choir:maximum-win-rate',
      summary.factions[Faction.Choir].winRate,
      manifest.gates.maximumFactionWinRate,
    ),
    maximumCheck('maximum-draw-rate', summary.drawRate, manifest.gates.maximumDrawRate),
  ];
  for (const policy of manifest.gates.roleWinRates) {
    const role = summary.roles[policy.roleId];
    const actual = role?.winRate ?? 0;
    if (policy.minimum !== undefined) {
      checks.push(minimumCheck(`role:${policy.roleId}:minimum-win-rate`, actual, policy.minimum));
    }
    if (policy.maximum !== undefined) {
      checks.push(maximumCheck(`role:${policy.roleId}:maximum-win-rate`, actual, policy.maximum));
    }
  }
  return { passed: checks.every((check) => check.passed), checks };
}

export function createCoreMatchReport(
  manifest: CoreMatchManifest,
  records: readonly CoreMatchRecord[],
): CoreMatchReport {
  const summary = summarizeCoreMatches(manifest, records);
  return { manifest, summary, gates: evaluateCoreMatchGates(manifest, summary), matches: records };
}

export function formatCoreMatchJson(report: CoreMatchReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatCoreMatchMarkdown(report: CoreMatchReport): string {
  const roleLines = report.manifest.roles.map((manifestRole) => {
    const role = report.summary.roles[manifestRole.id]!;
    return `- Role ${manifestRole.id} (${role.difficulty}) wins: ${role.wins}/${role.matches} (${percent(role.winRate)})`;
  });
  const wallClockLines = report.summary.wallClock === undefined
    ? []
    : [
        `- Observed wall clock: ${formatNumber(report.summary.wallClock.totalMilliseconds)} ms total, ${formatNumber(report.summary.wallClock.meanMilliseconds)} ms mean (non-gating)`,
      ];
  const lines = [
    `# Core Match Validation: ${report.manifest.id}`,
    '',
    report.manifest.description,
    '',
    '## Manifest',
    '',
    `- Schema: \`${report.manifest.schema}\` v${report.manifest.version}`,
    `- Pair seeds: ${report.manifest.pairSeeds.join(', ')}`,
    `- Legs per seed: ${report.manifest.legsPerSeed}`,
    `- Tick limit: ${report.manifest.tickLimit}`,
    `- Telemetry cadence: ${report.manifest.telemetryCadenceTicks} ticks`,
    `- Roles: ${report.manifest.roles.map((role) => `${role.id} (${role.difficulty})`).join(' vs ')}`,
    '',
    '## Result',
    '',
    `- Gates: **${report.gates.passed ? 'PASS' : 'FAIL'}**`,
    `- Matches: ${report.summary.matches}`,
    `- Draws: ${report.summary.draws} (${percent(report.summary.drawRate)})`,
    `- Mean duration: ${formatDuration(report.summary.meanDurationSeconds)}`,
    `- Compact wins: ${report.summary.factions[Faction.Compact].wins} (${percent(report.summary.factions[Faction.Compact].winRate)})`,
    `- Choir wins: ${report.summary.factions[Faction.Choir].wins} (${percent(report.summary.factions[Faction.Choir].winRate)})`,
    ...roleLines,
    ...wallClockLines,
    '',
    '## Gates',
    '',
    '| Gate | Result | Actual | Expectation |',
    '| --- | --- | ---: | --- |',
    ...report.gates.checks.map((check) =>
      `| ${check.id} | ${check.passed ? 'PASS' : 'FAIL'} | ${formatNumber(check.actual)} | ${check.expectation} |`),
    '',
    '## Matches',
    '',
    '| Match | Pair | Seed | Compact role | Choir role | Winner | End reason | Duration | First contact | First production | First combat | First Bastion damage | Last progress | Terminal inactivity |',
    '| --- | ---: | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.matches.map(formatMatchRow),
  ];
  return `${lines.join('\n')}\n`;
}

function createExpandedMatch(
  manifest: CoreMatchManifest,
  seed: number,
  pairIndex: number,
  leg: 'a' | 'b',
  compactRole: CoreMatchRole,
  choirRole: CoreMatchRole,
): ExpandedCoreMatch {
  return {
    matchId: `${manifest.id}-p${String(pairIndex).padStart(2, '0')}-${leg}`,
    pairIndex,
    leg,
    seed,
    factions: [Faction.Compact, Faction.Choir],
    difficulties: [compactRole.difficulty, choirRole.difficulty],
    tickLimit: manifest.tickLimit,
    roleByFaction: {
      [Faction.Compact]: compactRole.id,
      [Faction.Choir]: choirRole.id,
    },
  };
}

function createSample(observation: HeadlessMatchObservation): CoreMatchSample {
  return {
    tick: observation.tick,
    seconds: observation.time,
    factions: {
      [Faction.Compact]: createFactionSample(observation, Faction.Compact),
      [Faction.Choir]: createFactionSample(observation, Faction.Choir),
    },
  };
}

function createFactionSample(
  observation: HeadlessMatchObservation,
  faction: Faction,
): CoreMatchFactionSample {
  const combatUnits = observation.units.filter((unit) =>
    unit.alive && unit.faction === faction && UNITS[unit.kind].isMech);
  const structures = observation.structures.filter((structure) =>
    structure.alive && structure.faction === faction);
  const bastion = structures.find((structure) => structure.kind === 'bastion');
  const player = observation.players[faction];
  return {
    salvage: player.salvage,
    netPower: player.energyProduced - player.energyDrawn - player.weaponEnergyLoad,
    dominance: player.dominance,
    aliveCombatUnits: combatUnits.length,
    idleCombatUnits: combatUnits.filter((unit) => unit.order.kind === 'idle' && unit.targetId === 0).length,
    queuedUnits: structures.reduce((total, structure) => total + structure.queue.length, 0),
    structures: structures.length,
    bastionHp: bastion?.hp ?? 0,
    bastionMaxHp: bastion?.maxHp ?? 0,
  };
}

function inactivityFor(
  observation: HeadlessMatchObservation,
  faction: Faction,
): CoreMatchFactionInactivity {
  const sample = createFactionSample(observation, faction);
  return {
    noCombatUnits: sample.aliveCombatUnits === 0,
    allCombatUnitsIdle:
      sample.aliveCombatUnits > 0 && sample.idleCombatUnits === sample.aliveCombatUnits,
    productionQueuesEmpty: sample.queuedUnits === 0,
  };
}

function findContactFaction(observation: HeadlessMatchObservation): Faction | undefined {
  for (const faction of FACTIONS) {
    if (observation.units.some((unit) =>
      unit.alive && unit.faction === faction && UNITS[unit.kind].isMech &&
      (unit.targetId !== 0 || unit.order.targetId !== 0))) return faction;
    if (observation.structures.some((structure) =>
      structure.alive && structure.faction === faction && structure.targetId !== 0)) return faction;
  }
  return undefined;
}

function findDamagedBastionFaction(observation: HeadlessMatchObservation): Faction | undefined {
  const destroyed = observation.events.find((event) =>
    event.kind === 'structureDied' && event.entityKind === 'bastion' && isFaction(event.faction));
  if (destroyed !== undefined && isFaction(destroyed.faction)) return destroyed.faction;
  for (const faction of FACTIONS) {
    const bastion = observation.structures.find((structure) =>
      structure.faction === faction && structure.kind === 'bastion');
    if (bastion !== undefined && bastion.hp < bastion.maxHp) return faction;
  }
  return undefined;
}

function milestone(observation: HeadlessMatchObservation, faction?: Faction): CoreMatchMilestone {
  const value: CoreMatchMilestone = { tick: observation.tick, seconds: observation.time };
  if (faction !== undefined) value.faction = faction;
  return value;
}

function formatMatchRow(record: CoreMatchRecord): string {
  const timeline = record.timeline;
  const winner = record.result.winner === null ? 'Draw' : shortFaction(record.result.winner);
  const inactivity = FACTIONS.map((faction) => {
    const flags = timeline.terminalInactivity[faction];
    const activeFlags = [
      flags.noCombatUnits ? 'no-combat' : '',
      flags.allCombatUnitsIdle ? 'all-idle' : '',
      flags.productionQueuesEmpty ? 'queues-empty' : '',
    ].filter(Boolean);
    return `${shortFaction(faction)}:${activeFlags.join('+') || 'active'}`;
  }).join('; ');
  return [
    record.match.matchId,
    record.match.pairIndex,
    record.match.seed,
    `${record.match.roleByFaction[Faction.Compact]} (${record.match.difficulties[0]})`,
    `${record.match.roleByFaction[Faction.Choir]} (${record.match.difficulties[1]})`,
    winner,
    record.result.endReason,
    formatDuration(record.result.durationSeconds),
    milestoneTick(timeline.milestones.firstContact),
    milestoneTick(timeline.milestones.firstProduction),
    milestoneTick(timeline.milestones.firstCombat),
    milestoneTick(timeline.milestones.firstBastionDamage),
    timeline.lastProgressTick,
    `${inactivity}${timeline.noProgressForTelemetryWindow ? '; stale' : ''}`,
  ].map((value) => ` ${value} `).join('|').replace(/^/, '|').replace(/$/, '|');
}

function milestoneTick(value: CoreMatchMilestone | undefined): string | number {
  return value?.tick ?? '-';
}

function equalCheck(id: string, actual: number, expected: number): CoreMatchGateCheck {
  return { id, actual, passed: actual === expected, expectation: `= ${expected}` };
}

function minimumCheck(id: string, actual: number, minimum: number): CoreMatchGateCheck {
  return { id, actual, passed: actual >= minimum, expectation: `>= ${minimum}` };
}

function maximumCheck(id: string, actual: number, maximum: number): CoreMatchGateCheck {
  return { id, actual, passed: actual <= maximum, expectation: `<= ${maximum}` };
}

function readRole(input: unknown, path: string): CoreMatchRole {
  const role = readObject(input, path, ['id', 'difficulty']);
  return {
    id: readNonEmptyString(role.id, `${path}.id`),
    difficulty: readDifficulty(role.difficulty, `${path}.difficulty`),
  };
}

function readGates(input: unknown, path: string, roleIds: ReadonlySet<string>): CoreMatchGatePolicy {
  const gates = readObject(input, path, [
    'expectedMatches',
    'meanDurationSeconds',
    'maximumFactionWinRate',
    'maximumDrawRate',
    'roleWinRates',
  ]);
  const duration = readObject(gates.meanDurationSeconds, `${path}.meanDurationSeconds`, ['minimum', 'maximum']);
  const minimum = readFinite(duration.minimum, `${path}.meanDurationSeconds.minimum`, 0);
  const maximum = readFinite(duration.maximum, `${path}.meanDurationSeconds.maximum`, minimum);
  const roleWinRates = readArray(gates.roleWinRates, `${path}.roleWinRates`).map((value, index) => {
    const gatePath = `${path}.roleWinRates[${index}]`;
    const gate = readObject(value, gatePath, ['roleId'], ['minimum', 'maximum']);
    const roleId = readNonEmptyString(gate.roleId, `${gatePath}.roleId`);
    if (!roleIds.has(roleId)) fail(`${gatePath}.roleId`, 'must reference a declared role');
    if (gate.minimum === undefined && gate.maximum === undefined) {
      fail(gatePath, 'must define minimum and/or maximum');
    }
    const result: CoreMatchRoleWinRateGate = { roleId };
    if (gate.minimum !== undefined) result.minimum = readRate(gate.minimum, `${gatePath}.minimum`);
    if (gate.maximum !== undefined) result.maximum = readRate(gate.maximum, `${gatePath}.maximum`);
    if (result.minimum !== undefined && result.maximum !== undefined && result.minimum > result.maximum) {
      fail(gatePath, 'minimum must not exceed maximum');
    }
    return result;
  });
  if (new Set(roleWinRates.map((gate) => gate.roleId)).size !== roleWinRates.length) {
    fail(`${path}.roleWinRates`, 'must not repeat a role');
  }
  return {
    expectedMatches: readPositiveInteger(gates.expectedMatches, `${path}.expectedMatches`),
    meanDurationSeconds: { minimum, maximum },
    maximumFactionWinRate: readRate(gates.maximumFactionWinRate, `${path}.maximumFactionWinRate`),
    maximumDrawRate: readRate(gates.maximumDrawRate, `${path}.maximumDrawRate`),
    roleWinRates,
  };
}

function readObject(
  input: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) fail(path, 'expected an object');
  const value = input as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unexpected field');
  for (const key of required) if (!(key in value)) fail(`${path}.${key}`, 'missing field');
  return value;
}

function readArray(input: unknown, path: string): unknown[] {
  if (!Array.isArray(input)) fail(path, 'expected an array');
  return input;
}

function readNonEmptyString(input: unknown, path: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) fail(path, 'expected a non-empty string');
  return input;
}

function readDifficulty(input: unknown, path: string): Difficulty {
  if (input === 'recruit' || input === 'veteran' || input === 'commander') return input;
  return fail(path, 'expected recruit, veteran, or commander');
}

function readPositiveInteger(input: unknown, path: string): number {
  const value = readInteger(input, path);
  if (value <= 0) fail(path, 'expected a positive safe integer');
  return value;
}

function readInteger(input: unknown, path: string): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input)) fail(path, 'expected a safe integer');
  return input;
}

function readFinite(input: unknown, path: string, minimum: number, maximum = Infinity): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < minimum || input > maximum) {
    fail(path, `expected a finite number in [${minimum}, ${maximum}]`);
  }
  return input;
}

function readRate(input: unknown, path: string): number {
  return readFinite(input, path, 0, 1);
}

function fail(path: string, message: string): never {
  throw new CoreMatchManifestValidationError(`${path}: ${message}`);
}

function rate(value: number, count: number): number {
  return count === 0 ? 0 : value / count;
}

function isFaction(value: Faction | -1): value is Faction {
  return value === Faction.Compact || value === Faction.Choir;
}

function shortFaction(faction: Faction): string {
  return faction === Faction.Compact ? 'Compact' : 'Choir';
}

function percent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
