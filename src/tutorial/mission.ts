import { deltaS, surfaceDist } from '@core/ringMath';
import { Faction, type StructureKind, type UnitKind } from '@sim/data';
import { SnapshotValidationError } from '@sim/serialize';
import type { SimEvent, World } from '@sim/world';
import {
  BREAK_LINE_OBJECTIVES,
  breakLineObjectiveMet,
  emptyBreakLineMilestones,
  updateBreakLineMilestones,
  type BreakLineBindings,
  type BreakLineMilestones,
} from './breakLine';
import {
  COUNTERFIRE_OBJECTIVES,
  counterfireObjectiveMet,
  emptyCounterfireMilestones,
  observeCounterfireAction,
  updateCounterfireMilestones,
  type CounterfireBindings,
  type CounterfireMilestones,
} from './counterfire';
export type { BreakLineBindings } from './breakLine';
export type { CounterfireBindings } from './counterfire';

export const MISSION_SNAPSHOT_SCHEMA = 'ring-world-war/mission';
export const MISSION_SNAPSHOT_VERSION = 1;

export type MissionId = 'first-contact' | 'break-the-line' | 'counterfire';
export type MissionStatus = 'active' | 'completed' | 'failed';

export interface MissionBindings {
  tutorialNode: number;
  artilleryTarget: number;
}

export type PlayerAction =
  | { kind: 'selection-changed'; selectedIds: number[] }
  | {
    kind: 'artillery-fired';
    sourceId: number;
    weaponId: string;
    projectileId?: number;
    targetS: number;
    targetZ: number;
  };

export interface MissionMilestones {
  selectedEngineer: boolean;
  structureCounts: Partial<Record<StructureKind, number>>;
  unitCounts: Partial<Record<UnitKind, number>>;
  capturedNodeIds: number[];
  deployedLongbow: boolean;
  firedAntispinward: boolean;
  breakLine: BreakLineMilestones | null;
  counterfire: CounterfireMilestones | null;
}

export interface MissionSnapshot {
  schema: typeof MISSION_SNAPSHOT_SCHEMA;
  version: typeof MISSION_SNAPSHOT_VERSION;
  missionId: MissionId;
  revision: 1;
  status: MissionStatus;
  objectiveIndex: number;
  startedAtTick: number;
  objectiveStartedAtTick: number;
  completedAtTick: number | null;
  failedAtTick: number | null;
  completedObjectiveTicks: number[];
  bindings: MissionBindings | BreakLineBindings | CounterfireBindings;
  milestones: MissionMilestones;
}

export interface MissionHudModel {
  missionId: MissionId;
  title: string;
  status: MissionStatus;
  objectiveId: string | null;
  objectiveTitle: string | null;
  objectiveBody: string | null;
  hint: string | null;
  progressText: string;
}

export interface MissionDebriefModel {
  key: string;
  outcome: 'success' | 'failure';
  title: string;
  summary: string;
  rows: Array<{ label: string; value: string }>;
}

interface ObjectiveDefinition {
  id: string;
  title: string;
  body: string;
  hint: string;
}

const FIRST_CONTACT_OBJECTIVES: readonly ObjectiveDefinition[] = [
  {
    id: 'select-engineer',
    title: 'Wake the construction crew',
    body: 'Select one of the Meridian engineers near the Bastion.',
    hint: 'Left-click an engineer, or drag a selection box around one.',
  },
  {
    id: 'build-power',
    title: 'Establish reliable power',
    body: 'Complete two Solar Arrays. Their output will support the first field force.',
    hint: 'With an engineer selected, press S or choose Solar Array, then place it near the Bastion.',
  },
  {
    id: 'build-extractor',
    title: 'Recover scrith salvage',
    body: 'Complete an Extractor on one of the nearby salvage deposits.',
    hint: 'Press E or choose Extractor. Deposits are marked on the ring and minimap.',
  },
  {
    id: 'build-fabricator',
    title: 'Restore fabrication',
    body: 'Complete a Fabricator to unlock the Meridian field arsenal.',
    hint: 'Press B or choose Fabricator and place it inside your construction radius.',
  },
  {
    id: 'build-foundry',
    title: 'Raise a Mech Foundry',
    body: 'Complete a Mech Foundry for scout and artillery production.',
    hint: 'Press M or choose Mech Foundry after the Fabricator is complete.',
  },
  {
    id: 'produce-wisp',
    title: 'Commission a Wisp',
    body: 'Produce a Wisp reconnaissance mech from the Mech Foundry.',
    hint: 'Select the completed Mech Foundry and choose Wisp.',
  },
  {
    id: 'capture-node',
    title: 'Take the forward Spinal Node',
    body: 'Move the Wisp antispinward and hold the forward neutral node until it joins the Compact.',
    hint: 'Cross the joined minimap edge toward antispinward. Units capture nodes by remaining nearby.',
  },
  {
    id: 'produce-longbow',
    title: 'Commission a Longbow',
    body: 'Produce a Longbow from the Mech Foundry.',
    hint: 'Select the Mech Foundry and choose Longbow.',
  },
  {
    id: 'deploy-longbow',
    title: 'Deploy for ring fire',
    body: 'Keep the Longbow near the Bastion, select it, and finish deploying Siege Mode.',
    hint: 'Press X or use the Siege Mode command, then wait for the transition to complete.',
  },
  {
    id: 'fire-antispinward',
    title: 'Use the ring, not brute force',
    body: 'Fire the Siege Mortar antispinward at the Choir power core revealed beyond the node.',
    hint: 'The left side is the long-shot side. A visible path is only a preview; the status names any blocker.',
  },
] as const;

export class MissionController {
  private constructor(private state: MissionSnapshot) {}

  static start(missionId: 'first-contact', tick: number, bindings: MissionBindings): MissionController;
  static start(missionId: 'break-the-line', tick: number, bindings: BreakLineBindings): MissionController;
  static start(missionId: 'counterfire', tick: number, bindings: CounterfireBindings): MissionController;
  static start(
    missionId: MissionId,
    tick: number,
    bindings: MissionBindings | BreakLineBindings | CounterfireBindings,
  ): MissionController {
    const state: MissionSnapshot = {
      schema: MISSION_SNAPSHOT_SCHEMA,
      version: MISSION_SNAPSHOT_VERSION,
      missionId,
      revision: 1,
      status: 'active',
      objectiveIndex: 0,
      startedAtTick: tick,
      objectiveStartedAtTick: tick,
      completedAtTick: null,
      failedAtTick: null,
      completedObjectiveTicks: [],
      bindings: structuredClone(bindings),
      milestones: emptyMilestones(missionId),
    };
    validateBindings(missionId, state.bindings);
    return new MissionController(state);
  }

  static fromSnapshot(snapshot: MissionSnapshot, world: World): MissionController {
    const state = parseMissionSnapshot(snapshot);
    validateWorldChronology(state, world.tick);
    validateWorldBindings(state, world);
    return new MissionController(state);
  }

  advanceTick(world: World, events: readonly SimEvent[]): void {
    if (this.state.status !== 'active') return;
    if (this.state.missionId === 'counterfire') {
      const milestones = this.state.milestones.counterfire!;
      const failure = updateCounterfireMilestones(
        milestones,
        counterfireBindings(this.state),
        world,
        events,
      );
      if (failure) {
        this.state.status = 'failed';
        this.state.failedAtTick = world.tick;
        return;
      }
      this.advanceObjectives(world.tick);
      return;
    }
    if (this.state.missionId === 'break-the-line') {
      const milestones = this.state.milestones.breakLine!;
      const failure = updateBreakLineMilestones(
        milestones,
        breakLineBindings(this.state),
        world,
        this.state.objectiveIndex,
      );
      if (failure) {
        this.state.status = 'failed';
        this.state.failedAtTick = world.tick;
        return;
      }
      this.advanceObjectives(world.tick);
      return;
    }
    for (const event of events) this.recordEvent(event);
    this.state.milestones.deployedLongbow ||= world.units.some((unit) =>
      unit.alive && unit.faction === Faction.Compact && unit.kind === 'longbow' &&
      unit.ability?.id === 'siegeMode' && unit.ability.active && unit.ability.transitionTimer === 0);
    this.advanceObjectives(world.tick);
  }

  observePlayerAction(action: PlayerAction, world: World): void {
    if (this.state.status !== 'active') return;
    if (this.state.missionId === 'counterfire') {
      observeCounterfireAction(
        this.state.milestones.counterfire!,
        action,
        world,
      );
      this.advanceObjectives(world.tick);
      return;
    }
    if (this.state.missionId !== 'first-contact') return;
    if (action.kind === 'selection-changed') {
      this.state.milestones.selectedEngineer ||= action.selectedIds.some((id) => {
        const unit = world.unitById(id);
        return unit?.alive && unit.faction === Faction.Compact && unit.kind === 'engineer';
      });
    } else if (action.weaponId === 'siegeMortar') {
      const source = world.unitById(action.sourceId);
      const target = world.positionOf(firstContactBindings(this.state).artilleryTarget);
      if (
        source?.alive && source.faction === Faction.Compact && source.kind === 'longbow' && target &&
        surfaceDist(target.s, target.z, action.targetS, action.targetZ) <= 120 &&
        deltaS(source.s, action.targetS) < 0
      ) {
        this.state.milestones.firedAntispinward = true;
      }
    }
    this.advanceObjectives(world.tick);
  }

  snapshot(): MissionSnapshot {
    return structuredClone(this.state);
  }

  hudModel(): MissionHudModel {
    const objectives = missionObjectives(this.state.missionId);
    const objective = objectives[this.state.objectiveIndex] ?? null;
    if (this.state.status === 'failed') {
      const reason = this.state.milestones.breakLine?.failureReason;
      const counterfireFailure = this.state.milestones.counterfire?.failureReason;
      return {
        missionId: this.state.missionId,
        title: missionTitle(this.state.missionId),
        status: 'failed',
        objectiveId: null,
        objectiveTitle: this.state.missionId === 'counterfire' ? 'Defensive line lost' : 'The line is broken',
        objectiveBody: counterfireFailure === 'protected-asset-destroyed'
          ? 'The protected Fabricator was destroyed before the enemy launcher was neutralized.'
          : reason === 'match-ended' || counterfireFailure === 'match-ended'
          ? 'The battle ended before the forward-line objectives were secured.'
          : 'The protected Extractor was destroyed before the raiders were defeated.',
        hint: 'Reload the mission and re-form the established defence group.',
        progressText: `${this.state.objectiveIndex + 1} / ${objectives.length}`,
      };
    }
    return {
      missionId: this.state.missionId,
      title: missionTitle(this.state.missionId),
      status: this.state.status,
      objectiveId: objective?.id ?? null,
      objectiveTitle: objective?.title ?? null,
      objectiveBody: objective?.body ?? null,
      hint: objective?.hint ?? null,
      progressText: `${Math.min(this.state.objectiveIndex + 1, objectives.length)} / ${objectives.length}`,
    };
  }

  debriefModel(): MissionDebriefModel | null {
    if (this.state.status === 'active') return null;
    const durationTicks = (this.state.completedAtTick ?? this.state.failedAtTick ?? this.state.objectiveStartedAtTick) -
      this.state.startedAtTick;
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Mission time', value: formatMissionClock(durationTicks) },
      { label: 'Objectives', value: `${this.state.completedObjectiveTicks.length}/${missionObjectives(this.state.missionId).length}` },
    ];
    const counterfire = this.state.milestones.counterfire;
    if (counterfire) {
      rows.push(
        { label: 'Hostile launches', value: String(counterfire.hostileShots) },
        { label: 'Intercepted', value: String(counterfire.friendlyInterceptions) },
        { label: 'Penetrations', value: String(counterfire.hostilePenetrations) },
        { label: 'Counterfire rounds', value: String(counterfire.counterfireShots) },
        { label: 'Asset integrity', value: counterfire.protectedStartHp > 0
          ? `${Math.round((counterfire.protectedEndHp / counterfire.protectedStartHp) * 100)}%`
          : 'unknown' },
        { label: 'Lowest power ratio', value: `${Math.round(counterfire.minimumPowerRatio * 100)}%` },
      );
    }
    return {
      key: `${this.state.missionId}:${this.state.status}:${this.state.completedAtTick ?? this.state.failedAtTick}`,
      outcome: this.state.status === 'completed' ? 'success' : 'failure',
      title: this.state.status === 'completed' ? 'Mission complete' : 'Mission failed',
      summary: this.state.status === 'completed'
        ? `${missionTitle(this.state.missionId)} objectives secured.`
        : `${missionTitle(this.state.missionId)} ended before all objectives were secured.`,
      rows,
    };
  }

  private recordEvent(event: SimEvent): void {
    if (event.faction !== Faction.Compact) return;
    if (event.kind === 'structureComplete' && event.entityKind) {
      const kind = event.entityKind as StructureKind;
      this.state.milestones.structureCounts[kind] = (this.state.milestones.structureCounts[kind] ?? 0) + 1;
    } else if (event.kind === 'unitComplete' && event.entityKind) {
      const kind = event.entityKind as UnitKind;
      this.state.milestones.unitCounts[kind] = (this.state.milestones.unitCounts[kind] ?? 0) + 1;
    } else if (
      event.kind === 'nodeCaptured' && event.id === firstContactBindings(this.state).tutorialNode &&
      !this.state.milestones.capturedNodeIds.includes(event.id)
    ) {
      this.state.milestones.capturedNodeIds.push(event.id);
    }
  }

  private advanceObjectives(tick: number): void {
    while (this.state.status === 'active' && objectiveMet(this.state)) {
      this.state.completedObjectiveTicks.push(tick);
      this.state.objectiveIndex++;
      this.state.objectiveStartedAtTick = tick;
      if (this.state.objectiveIndex === missionObjectives(this.state.missionId).length) {
        this.state.status = 'completed';
        this.state.completedAtTick = tick;
      }
    }
  }
}

export function parseMissionSnapshot(input: unknown): MissionSnapshot {
  const value = typeof input === 'string' ? parseJson(input) : input;
  const root = record(value, '$', [
    'schema', 'version', 'missionId', 'revision', 'status', 'objectiveIndex', 'startedAtTick',
    'objectiveStartedAtTick', 'completedAtTick', 'completedObjectiveTicks', 'bindings', 'milestones',
  ], ['failedAtTick']);
  if (root.schema !== MISSION_SNAPSHOT_SCHEMA) fail('$.schema', `expected ${MISSION_SNAPSHOT_SCHEMA}`);
  if (root.version !== MISSION_SNAPSHOT_VERSION) fail('$.version', `expected version ${MISSION_SNAPSHOT_VERSION}`);
  if (root.missionId !== 'first-contact' && root.missionId !== 'break-the-line' && root.missionId !== 'counterfire') {
    fail('$.missionId', 'expected first-contact, break-the-line, or counterfire');
  }
  const missionId = root.missionId;
  const objectives = missionObjectives(missionId);
  if (root.revision !== 1) fail('$.revision', 'expected revision 1');
  if (root.status !== 'active' && root.status !== 'completed' && root.status !== 'failed') {
    fail('$.status', 'expected active, completed, or failed');
  }
  const objectiveIndex = integer(root.objectiveIndex, '$.objectiveIndex', 0, objectives.length);
  const startedAtTick = integer(root.startedAtTick, '$.startedAtTick', 0);
  const objectiveStartedAtTick = integer(root.objectiveStartedAtTick, '$.objectiveStartedAtTick', startedAtTick);
  const completedAtTick = root.completedAtTick === null
    ? null
    : integer(root.completedAtTick, '$.completedAtTick', objectiveStartedAtTick);
  const failedAtTick = root.failedAtTick === undefined || root.failedAtTick === null
    ? null
    : integer(root.failedAtTick, '$.failedAtTick', startedAtTick);
  const completedTickValues = array(root.completedObjectiveTicks, '$.completedObjectiveTicks');
  if (completedTickValues.length > objectives.length) {
    fail('$.completedObjectiveTicks', `expected at most ${objectives.length} entries`);
  }
  const completedObjectiveTicks = completedTickValues.map((tick, index) =>
    integer(tick, `$.completedObjectiveTicks[${index}]`, startedAtTick));
  if (completedObjectiveTicks.length !== objectiveIndex) {
    fail('$.completedObjectiveTicks', 'length must equal objectiveIndex');
  }
  for (let index = 1; index < completedObjectiveTicks.length; index++) {
    if (completedObjectiveTicks[index]! < completedObjectiveTicks[index - 1]!) {
      fail('$.completedObjectiveTicks', 'must be ordered by tick');
    }
  }
  if (root.status === 'active' && objectiveIndex >= objectives.length) {
    fail('$.status', 'active mission must have an objectiveIndex below the objective count');
  }
  if (root.status === 'active' && (completedAtTick !== null || failedAtTick !== null)) {
    fail('$.status', 'active mission must not have a terminal tick');
  }
  if (root.status === 'completed' && (objectiveIndex !== objectives.length || completedAtTick === null)) {
    fail('$.status', 'completed mission must include every objective and a completion tick');
  }
  if (root.status === 'failed' &&
      (missionId === 'first-contact' || objectiveIndex >= objectives.length || completedAtTick !== null || failedAtTick === null)) {
    fail('$.status', 'failed state must be an incomplete fallible mission with a failure tick');
  }
  if (root.status !== 'failed' && failedAtTick !== null) {
    fail('$.failedAtTick', 'is only valid for a failed mission');
  }
  const expectedObjectiveStart = completedObjectiveTicks.at(-1) ?? startedAtTick;
  if (objectiveStartedAtTick !== expectedObjectiveStart) {
    fail('$.objectiveStartedAtTick', 'must equal the latest objective completion tick');
  }
  if (root.status === 'completed' && completedAtTick !== expectedObjectiveStart) {
    fail('$.completedAtTick', 'must equal the final objective completion tick');
  }
  const bindings = readBindings(missionId, root.bindings, '$.bindings');
  const milestones = readMilestones(missionId, root.milestones, '$.milestones');
  const failureReason = missionId === 'break-the-line'
    ? milestones.breakLine?.failureReason ?? null
    : missionId === 'counterfire'
      ? milestones.counterfire?.failureReason ?? null
      : null;
  if (root.status === 'failed' && !failureReason) {
    fail('$.milestones', 'a failure reason is required for a failed mission');
  }
  if (root.status !== 'failed' && failureReason) {
    fail('$.milestones', 'failure reason is only valid for a failed mission');
  }
  if (root.status === 'failed' && milestones.breakLine?.failureReason === 'extractor-destroyed' &&
      (milestones.breakLine.extractorSurvived || milestones.breakLine.raidersDefeated)) {
    fail('$.milestones.breakLine', 'extractor failure requires a lost extractor and undefeated raiders');
  }
  if (
    missionId === 'first-contact' &&
    milestones.capturedNodeIds.some((id) => id !== (bindings as MissionBindings).tutorialNode)
  ) {
    fail('$.milestones.capturedNodeIds', 'may only contain the bound tutorial node');
  }
  const snapshot: MissionSnapshot = {
    schema: MISSION_SNAPSHOT_SCHEMA,
    version: MISSION_SNAPSHOT_VERSION,
    missionId,
    revision: 1,
    status: root.status,
    objectiveIndex,
    startedAtTick,
    objectiveStartedAtTick,
    completedAtTick,
    failedAtTick,
    completedObjectiveTicks,
    bindings,
    milestones,
  };
  for (let index = 0; index < objectiveIndex; index++) {
    if (!objectiveMetAt(snapshot, index)) fail('$.milestones', `does not satisfy completed objective ${index + 1}`);
  }
  return snapshot;
}

function objectiveMet(state: MissionSnapshot): boolean {
  return objectiveMetAt(state, state.objectiveIndex);
}

function objectiveMetAt(state: MissionSnapshot, objectiveIndex: number): boolean {
  if (state.missionId === 'counterfire') {
    return counterfireObjectiveMet(state.milestones.counterfire!, objectiveIndex);
  }
  if (state.missionId === 'break-the-line') {
    return breakLineObjectiveMet(state.milestones.breakLine!, objectiveIndex);
  }
  return milestoneMet(state, objectiveIndex);
}

function milestoneMet(state: MissionSnapshot, objectiveIndex: number): boolean {
  const counts = state.milestones.structureCounts;
  const units = state.milestones.unitCounts;
  switch (FIRST_CONTACT_OBJECTIVES[objectiveIndex]?.id) {
    case 'select-engineer': return state.milestones.selectedEngineer;
    case 'build-power': return (counts.solarArray ?? 0) >= 2;
    case 'build-extractor': return (counts.extractor ?? 0) >= 1;
    case 'build-fabricator': return (counts.fabricator ?? 0) >= 1;
    case 'build-foundry': return (counts.mechFoundry ?? 0) >= 1;
    case 'produce-wisp': return (units.wisp ?? 0) >= 1;
    case 'capture-node': return state.milestones.capturedNodeIds.includes(firstContactBindings(state).tutorialNode);
    case 'produce-longbow': return (units.longbow ?? 0) >= 1;
    case 'deploy-longbow': return state.milestones.deployedLongbow;
    case 'fire-antispinward': return state.milestones.firedAntispinward;
    default: return false;
  }
}

function emptyMilestones(missionId: MissionId): MissionMilestones {
  return {
    selectedEngineer: false,
    structureCounts: {},
    unitCounts: {},
    capturedNodeIds: [],
    deployedLongbow: false,
    firedAntispinward: false,
    breakLine: missionId === 'break-the-line' ? emptyBreakLineMilestones() : null,
    counterfire: missionId === 'counterfire' ? emptyCounterfireMilestones() : null,
  };
}

function readBindings(
  missionId: MissionId,
  value: unknown,
  path: string,
): MissionBindings | BreakLineBindings | CounterfireBindings {
  if (missionId === 'first-contact') {
    const bindings = record(value, path, ['tutorialNode', 'artilleryTarget']);
    const result: MissionBindings = {
      tutorialNode: integer(bindings.tutorialNode, `${path}.tutorialNode`, 1),
      artilleryTarget: integer(bindings.artilleryTarget, `${path}.artilleryTarget`, 1),
    };
    validateBindings(missionId, result);
    return result;
  }
  if (missionId === 'counterfire') {
    const bindings = record(value, path, [
      'protectedAsset', 'defensePower', 'aegis', 'wisp', 'playerBattery', 'enemyLauncher', 'enemyGrid',
    ]);
    const result: CounterfireBindings = {
      protectedAsset: integer(bindings.protectedAsset, `${path}.protectedAsset`, 1),
      defensePower: integer(bindings.defensePower, `${path}.defensePower`, 1),
      aegis: integer(bindings.aegis, `${path}.aegis`, 1),
      wisp: integer(bindings.wisp, `${path}.wisp`, 1),
      playerBattery: integer(bindings.playerBattery, `${path}.playerBattery`, 1),
      enemyLauncher: integer(bindings.enemyLauncher, `${path}.enemyLauncher`, 1),
      enemyGrid: integer(bindings.enemyGrid, `${path}.enemyGrid`, 1),
    };
    validateBindings(missionId, result);
    return result;
  }
  const bindings = record(value, path, [
    'forwardNode', 'protectedExtractor', 'enemyArtillery', 'strongpointIds', 'raiderIds',
  ]);
  const result: BreakLineBindings = {
    forwardNode: integer(bindings.forwardNode, `${path}.forwardNode`, 1),
    protectedExtractor: integer(bindings.protectedExtractor, `${path}.protectedExtractor`, 1),
    enemyArtillery: integer(bindings.enemyArtillery, `${path}.enemyArtillery`, 1),
    strongpointIds: idArray(bindings.strongpointIds, `${path}.strongpointIds`, 1, 8),
    raiderIds: idArray(bindings.raiderIds, `${path}.raiderIds`, 1, 12),
  };
  validateBindings(missionId, result);
  return result;
}

function validateBindings(
  missionId: MissionId,
  bindings: MissionBindings | BreakLineBindings | CounterfireBindings,
): void {
  if (missionId === 'first-contact') {
    const first = bindings as MissionBindings;
    if (!Number.isSafeInteger(first.tutorialNode) || first.tutorialNode < 1) {
      fail('$.bindings.tutorialNode', 'expected a positive entity id');
    }
    if (!Number.isSafeInteger(first.artilleryTarget) || first.artilleryTarget < 1) {
      fail('$.bindings.artilleryTarget', 'expected a positive entity id');
    }
    if (first.tutorialNode === first.artilleryTarget) fail('$.bindings', 'entity ids must be distinct');
    return;
  }
  if (missionId === 'counterfire') {
    const counterfire = bindings as CounterfireBindings;
    const all = Object.values(counterfire);
    if (all.some((id) => !Number.isSafeInteger(id) || id < 1)) fail('$.bindings', 'expected positive entity ids');
    if (new Set(all).size !== all.length) fail('$.bindings', 'entity ids must be distinct');
    return;
  }
  const line = bindings as BreakLineBindings;
  if (!Array.isArray(line.strongpointIds) || !Array.isArray(line.raiderIds)) {
    fail('$.bindings', 'break-the-line requires strongpointIds and raiderIds arrays');
  }
  const all = [
    line.forwardNode,
    line.protectedExtractor,
    line.enemyArtillery,
    ...line.strongpointIds,
    ...line.raiderIds,
  ];
  if (all.some((id) => !Number.isSafeInteger(id) || id < 1)) fail('$.bindings', 'expected positive entity ids');
  if (new Set(all).size !== all.length) fail('$.bindings', 'entity ids must be distinct');
}

function validateWorldBindings(state: MissionSnapshot, world: World): void {
  if (state.status === 'failed') {
    if (state.missionId === 'counterfire') {
      const milestones = state.milestones.counterfire!;
      if (milestones.failureReason === 'match-ended' && world.status !== 'completed') {
        fail('$.milestones.counterfire.failureReason', 'match-ended requires a completed match');
      }
      if (milestones.failureReason === 'protected-asset-destroyed' &&
          world.structureById(counterfireBindings(state).protectedAsset)) {
        fail('$.milestones.counterfire.failureReason', 'protected asset must be gone');
      }
      return;
    }
    const milestones = state.milestones.breakLine!;
    if (milestones.failureReason === 'match-ended' && world.status !== 'completed') {
      fail('$.milestones.breakLine.failureReason', 'match-ended requires a completed match');
    }
    if (milestones.failureReason === 'extractor-destroyed' && world.structureById(breakLineBindings(state).protectedExtractor)) {
      fail('$.milestones.breakLine.failureReason', 'extractor-destroyed requires the bound Extractor to be gone');
    }
    return;
  }
  if (state.status !== 'active') return;
  if (world.status === 'completed') fail('$', 'active mission cannot be restored into a completed match');
  if (state.missionId === 'break-the-line') {
    validateBreakLineWorldBindings(state, world);
    return;
  }
  if (state.missionId === 'counterfire') {
    validateCounterfireWorldBindings(state, world);
    return;
  }
  const bindings = firstContactBindings(state);
  if (!state.milestones.capturedNodeIds.includes(bindings.tutorialNode)) {
    const node = world.structureById(bindings.tutorialNode);
    if (!node?.alive || node.kind !== 'spinalNode' || node.faction !== -1 || node.progress !== 1) {
      fail('$.bindings.tutorialNode', 'must reference a completed neutral Spinal Node until capture');
    }
  }
  if (!state.milestones.firedAntispinward) {
    const target = world.structureById(bindings.artilleryTarget);
    if (!target?.alive || target.faction !== Faction.Choir || target.kind !== 'fusionCore' || target.progress !== 1) {
      fail('$.bindings.artilleryTarget', 'must reference a completed live Choir Fusion Core until it is fired on');
    }
  }
}

function validateCounterfireWorldBindings(state: MissionSnapshot, world: World): void {
  const bindings = counterfireBindings(state);
  const milestones = state.milestones.counterfire!;
  const protectedAsset = world.structureById(bindings.protectedAsset);
  if (!protectedAsset?.alive || protectedAsset.faction !== Faction.Compact || protectedAsset.kind !== 'fabricator' || protectedAsset.progress !== 1) {
    fail('$.bindings.protectedAsset', 'must reference a completed Compact Fabricator');
  }
  const power = world.structureById(bindings.defensePower);
  if (!milestones.powerRestored &&
      (!power?.alive || power.faction !== Faction.Compact || power.kind !== 'fusionCore')) {
    fail('$.bindings.defensePower', 'must reference a Compact Fusion Core');
  }
  const aegis = world.unitById(bindings.aegis);
  if (!milestones.defenseIntercepted &&
      (!aegis?.alive || aegis.faction !== Faction.Compact || aegis.kind !== 'aegis')) {
    fail('$.bindings.aegis', 'must reference a Compact Aegis');
  }
  const wisp = world.unitById(bindings.wisp);
  if (!milestones.launcherScouted &&
      (!wisp?.alive || wisp.faction !== Faction.Compact || wisp.kind !== 'wisp')) {
    fail('$.bindings.wisp', 'must reference a Compact Wisp');
  }
  const battery = world.structureById(bindings.playerBattery);
  if (!milestones.launcherDestroyed &&
      (!battery?.alive || battery.faction !== Faction.Compact || battery.kind !== 'rocketBattery' || battery.progress !== 1)) {
    fail('$.bindings.playerBattery', 'must reference a completed Compact Rocket Battery');
  }
  const launcher = world.unitById(bindings.enemyLauncher);
  if (!milestones.launcherDestroyed &&
      (!launcher?.alive || launcher.faction !== Faction.Choir || launcher.kind !== 'longbow')) {
    fail('$.bindings.enemyLauncher', 'must reference a Choir Longbow');
  }
  const grid = world.structureById(bindings.enemyGrid);
  if (!milestones.standardIntercepted &&
      (!grid?.alive || grid.faction !== Faction.Choir || grid.kind !== 'laserGrid' || grid.progress !== 1)) {
    fail('$.bindings.enemyGrid', 'must reference a completed Choir Laser Grid');
  }
  for (const id of milestones.trackedStandardProjectileIds) {
    const projectile = world.projectiles.find((candidate) => candidate.alive && candidate.id === id);
    const source = projectile ? world.structureById(projectile.targetId) : undefined;
    if (!projectile || projectile.faction !== Faction.Compact || projectile.weapon !== 'batteryGun' ||
        !source?.alive || source.faction !== Faction.Compact || source.kind !== 'rocketBattery' || source.progress < 1) {
      fail('$.milestones.counterfire.trackedStandardProjectileIds', 'must reference live Standard Rockets from a Compact Rocket Battery');
    }
  }
  for (const id of milestones.hostileProjectileIds) {
    const projectile = world.projectiles.find((candidate) => candidate.alive && candidate.id === id);
    if (!projectile || projectile.faction !== Faction.Choir || projectile.targetId !== bindings.enemyLauncher ||
        projectile.weapon !== 'siegeMortar') {
      fail('$.milestones.counterfire.hostileProjectileIds', 'must reference live projectiles from the bound launcher');
    }
  }
}

function validateBreakLineWorldBindings(state: MissionSnapshot, world: World): void {
  const bindings = breakLineBindings(state);
  const milestones = state.milestones.breakLine!;
  const node = world.structureById(bindings.forwardNode);
  if (!node?.alive || node.kind !== 'spinalNode') {
    fail('$.bindings.forwardNode', 'must reference a live Spinal Node');
  }
  if (!milestones.raidersDefeated) {
    const extractor = world.structureById(bindings.protectedExtractor);
    if (!extractor?.alive || extractor.faction !== Faction.Compact || extractor.kind !== 'extractor') {
      fail('$.bindings.protectedExtractor', 'must reference the live Compact Extractor during the raid');
    }
  }
  if (!milestones.artilleryDestroyed) {
    const artillery = world.structureById(bindings.enemyArtillery);
    if (!artillery?.alive || artillery.faction !== Faction.Choir || artillery.kind !== 'rocketBattery') {
      fail('$.bindings.enemyArtillery', 'must reference the live Choir Rocket Battery');
    }
  }
  if (!milestones.strongpointDestroyed) {
    let remaining = 0;
    for (const id of bindings.strongpointIds) {
      const structure = world.structureById(id);
      if (!structure) continue;
      remaining++;
      if (structure.faction !== Faction.Choir) fail('$.bindings.strongpointIds', 'remaining structures must be Choir-owned');
    }
    if (remaining === 0) fail('$.bindings.strongpointIds', 'must retain a live structure until aggregate destruction');
  }
  if (!milestones.raidersDefeated) {
    const remaining = bindings.raiderIds.map((id) => world.unitById(id)).filter((unit) => unit !== undefined);
    if (remaining.length === 0 || remaining.some((unit) => unit.faction !== Faction.Choir)) {
      fail('$.bindings.raiderIds', 'must retain only live Choir raiders until defeat');
    }
  }
}

function validateWorldChronology(state: MissionSnapshot, worldTick: number): void {
  if (
    state.startedAtTick > worldTick || state.objectiveStartedAtTick > worldTick ||
    state.completedAtTick !== null && state.completedAtTick > worldTick ||
    state.failedAtTick !== null && state.failedAtTick > worldTick ||
    state.completedObjectiveTicks.some((tick) => tick > worldTick)
  ) {
    fail('$', 'mission timestamps must not exceed the restored world tick');
  }
  if (state.failedAtTick !== null && state.failedAtTick < (state.completedObjectiveTicks.at(-1) ?? state.startedAtTick)) {
    fail('$.failedAtTick', 'must not precede completed objectives');
  }
  const line = state.milestones.breakLine;
  if (line) {
    if (line.milestoneTicks.some((tick) => tick !== null && (tick < state.startedAtTick || tick > worldTick))) {
      fail('$.milestones.breakLine.milestoneTicks', 'must fall between mission start and the restored world tick');
    }
    if (line.lastHoldWorldTick > worldTick ||
        line.lastHoldWorldTick >= 0 && line.lastHoldWorldTick < state.startedAtTick) {
      fail('$.milestones.breakLine.lastHoldWorldTick', 'must fall within the restored mission timeline');
    }
    if (line.holdTicks > 0 && line.lastHoldWorldTick < 0) {
      fail('$.milestones.breakLine.lastHoldWorldTick', 'is required after hold progress begins');
    }
    for (let index = 0; index < state.completedObjectiveTicks.length; index++) {
      const occurredAt = line.milestoneTicks[index];
      if (occurredAt !== null && state.completedObjectiveTicks[index]! < occurredAt) {
        fail('$.completedObjectiveTicks', 'cannot precede its milestone occurrence tick');
      }
    }
  }
  const counterfire = state.milestones.counterfire;
  if (counterfire) {
    if (counterfire.milestoneTicks.some((tick) => tick !== null &&
        (tick < state.startedAtTick || tick > worldTick))) {
      fail('$.milestones.counterfire.milestoneTicks', 'must fall within the restored mission timeline');
    }
    for (let index = 0; index < state.completedObjectiveTicks.length; index++) {
      const occurredAt = counterfire.milestoneTicks[index];
      if (occurredAt !== null && state.completedObjectiveTicks[index]! < occurredAt) {
        fail('$.completedObjectiveTicks', 'cannot precede its milestone occurrence tick');
      }
    }
  }
}

function readMilestones(missionId: MissionId, value: unknown, path: string): MissionMilestones {
  const milestones = record(value, path, [
    'selectedEngineer', 'structureCounts', 'unitCounts', 'capturedNodeIds',
    'deployedLongbow', 'firedAntispinward',
  ], ['breakLine', 'counterfire']);
  const structureCounts = countRecord<StructureKind>(
    milestones.structureCounts,
    `${path}.structureCounts`,
    ['bastion', 'extractor', 'solarArray', 'fusionCore', 'fabricator', 'mechFoundry', 'rocketBattery',
      'pointDefense', 'laserGrid', 'radarMast', 'silo', 'spinalNode'],
  );
  const unitCounts = countRecord<UnitKind>(
    milestones.unitCounts,
    `${path}.unitCounts`,
    ['vanguard', 'longbow', 'wisp', 'aegis', 'engineer'],
  );
  const capturedNodeValues = array(milestones.capturedNodeIds, `${path}.capturedNodeIds`);
  if (capturedNodeValues.length > 1) fail(`${path}.capturedNodeIds`, 'expected at most one entity id');
  const capturedNodeIds = capturedNodeValues.map((id, index) =>
    integer(id, `${path}.capturedNodeIds[${index}]`, 1));
  if (new Set(capturedNodeIds).size !== capturedNodeIds.length) {
    fail(`${path}.capturedNodeIds`, 'contains duplicate entity ids');
  }
  const breakLine = milestones.breakLine === undefined || milestones.breakLine === null
    ? null
    : readBreakLineMilestones(milestones.breakLine, `${path}.breakLine`);
  const counterfire = milestones.counterfire === undefined || milestones.counterfire === null
    ? null
    : readCounterfireMilestones(milestones.counterfire, `${path}.counterfire`);
  if (missionId === 'break-the-line' && !breakLine) fail(`${path}.breakLine`, 'is required for break-the-line');
  if (missionId === 'counterfire' && !counterfire) fail(`${path}.counterfire`, 'is required for counterfire');
  if (missionId !== 'break-the-line' && breakLine) fail(`${path}.breakLine`, 'must be null outside break-the-line');
  if (missionId !== 'counterfire' && counterfire) fail(`${path}.counterfire`, 'must be null outside counterfire');
  if (missionId !== 'first-contact' && (
    milestones.selectedEngineer !== false || Object.keys(structureCounts).length > 0 ||
    Object.keys(unitCounts).length > 0 || capturedNodeIds.length > 0 ||
    milestones.deployedLongbow !== false || milestones.firedAntispinward !== false
  )) fail(path, 'first-contact milestone fields must remain empty outside first-contact');
  return {
    selectedEngineer: bool(milestones.selectedEngineer, `${path}.selectedEngineer`),
    structureCounts,
    unitCounts,
    capturedNodeIds,
    deployedLongbow: bool(milestones.deployedLongbow, `${path}.deployedLongbow`),
    firedAntispinward: bool(milestones.firedAntispinward, `${path}.firedAntispinward`),
    breakLine,
    counterfire,
  };
}

function readBreakLineMilestones(value: unknown, path: string): BreakLineMilestones {
  const state = record(value, path, [
    'scoutedArtillery', 'capturedForwardNode', 'raidersDefeated', 'extractorSurvived',
    'favorableLongbow', 'artilleryDestroyed', 'strongpointDestroyed', 'holdTicks',
    'lastHoldWorldTick', 'milestoneTicks', 'failureReason',
  ]);
  const tickValues = array(state.milestoneTicks, `${path}.milestoneTicks`);
  if (tickValues.length !== BREAK_LINE_OBJECTIVES.length) {
    fail(`${path}.milestoneTicks`, `expected ${BREAK_LINE_OBJECTIVES.length} entries`);
  }
  const milestoneTicks = tickValues.map((tick, index) => tick === null
    ? null
    : integer(tick, `${path}.milestoneTicks[${index}]`, 0));
  if (state.failureReason !== null && state.failureReason !== 'extractor-destroyed' && state.failureReason !== 'match-ended') {
    fail(`${path}.failureReason`, 'expected extractor-destroyed, match-ended, or null');
  }
  const result: BreakLineMilestones = {
    scoutedArtillery: bool(state.scoutedArtillery, `${path}.scoutedArtillery`),
    capturedForwardNode: bool(state.capturedForwardNode, `${path}.capturedForwardNode`),
    raidersDefeated: bool(state.raidersDefeated, `${path}.raidersDefeated`),
    extractorSurvived: bool(state.extractorSurvived, `${path}.extractorSurvived`),
    favorableLongbow: bool(state.favorableLongbow, `${path}.favorableLongbow`),
    artilleryDestroyed: bool(state.artilleryDestroyed, `${path}.artilleryDestroyed`),
    strongpointDestroyed: bool(state.strongpointDestroyed, `${path}.strongpointDestroyed`),
    holdTicks: integer(state.holdTicks, `${path}.holdTicks`, 0, 30 * 60 * 60),
    lastHoldWorldTick: integer(state.lastHoldWorldTick, `${path}.lastHoldWorldTick`, -1),
    milestoneTicks,
    failureReason: state.failureReason,
  };
  for (let index = 0; index < BREAK_LINE_OBJECTIVES.length; index++) {
    if (breakLineObjectiveMet(result, index) !== (milestoneTicks[index] !== null)) {
      fail(`${path}.milestoneTicks[${index}]`, 'must agree with its milestone state');
    }
  }
  return result;
}

function readCounterfireMilestones(value: unknown, path: string): CounterfireMilestones {
  const state = record(value, path, [
    'incomingDetected', 'powerRestored', 'umbrellaActivated', 'defenseIntercepted',
    'launcherScouted', 'standardFired', 'standardIntercepted', 'cruiseFired',
    'launcherDestroyed', 'hostileShots', 'friendlyInterceptions', 'hostilePenetrations',
    'counterfireShots', 'brownoutTicks', 'minimumPowerRatio', 'protectedStartHp',
    'protectedEndHp', 'trackedStandardProjectileIds', 'hostileProjectileIds', 'milestoneTicks', 'failureReason',
  ]);
  const tickValues = array(state.milestoneTicks, `${path}.milestoneTicks`);
  if (tickValues.length !== COUNTERFIRE_OBJECTIVES.length) {
    fail(`${path}.milestoneTicks`, `expected ${COUNTERFIRE_OBJECTIVES.length} entries`);
  }
  const milestoneTicks = tickValues.map((tick, index) => tick === null
    ? null
    : integer(tick, `${path}.milestoneTicks[${index}]`, 0));
  if (state.failureReason !== null &&
      state.failureReason !== 'protected-asset-destroyed' && state.failureReason !== 'match-ended') {
    fail(`${path}.failureReason`, 'expected protected-asset-destroyed, match-ended, or null');
  }
  const result: CounterfireMilestones = {
    incomingDetected: bool(state.incomingDetected, `${path}.incomingDetected`),
    powerRestored: bool(state.powerRestored, `${path}.powerRestored`),
    umbrellaActivated: bool(state.umbrellaActivated, `${path}.umbrellaActivated`),
    defenseIntercepted: bool(state.defenseIntercepted, `${path}.defenseIntercepted`),
    launcherScouted: bool(state.launcherScouted, `${path}.launcherScouted`),
    standardFired: bool(state.standardFired, `${path}.standardFired`),
    standardIntercepted: bool(state.standardIntercepted, `${path}.standardIntercepted`),
    cruiseFired: bool(state.cruiseFired, `${path}.cruiseFired`),
    launcherDestroyed: bool(state.launcherDestroyed, `${path}.launcherDestroyed`),
    hostileShots: integer(state.hostileShots, `${path}.hostileShots`, 0, 10000),
    friendlyInterceptions: integer(state.friendlyInterceptions, `${path}.friendlyInterceptions`, 0, 10000),
    hostilePenetrations: integer(state.hostilePenetrations, `${path}.hostilePenetrations`, 0, 10000),
    counterfireShots: integer(state.counterfireShots, `${path}.counterfireShots`, 0, 10000),
    brownoutTicks: integer(state.brownoutTicks, `${path}.brownoutTicks`, 0, Number.MAX_SAFE_INTEGER),
    minimumPowerRatio: finiteNumber(state.minimumPowerRatio, `${path}.minimumPowerRatio`, 0, 1),
    protectedStartHp: finiteNumber(state.protectedStartHp, `${path}.protectedStartHp`, 0),
    protectedEndHp: finiteNumber(state.protectedEndHp, `${path}.protectedEndHp`, 0),
    trackedStandardProjectileIds: idArray(
      state.trackedStandardProjectileIds, `${path}.trackedStandardProjectileIds`, 0, 64,
    ),
    hostileProjectileIds: idArray(state.hostileProjectileIds, `${path}.hostileProjectileIds`, 0, 64),
    milestoneTicks,
    failureReason: state.failureReason,
  };
  for (let index = 0; index < COUNTERFIRE_OBJECTIVES.length; index++) {
    if (counterfireObjectiveMet(result, index) !== (milestoneTicks[index] !== null)) {
      fail(`${path}.milestoneTicks[${index}]`, 'must agree with its milestone state');
    }
  }
  if (result.incomingDetected && result.hostileShots < 1) fail(path, 'incoming detection requires a hostile shot');
  if (result.defenseIntercepted && result.friendlyInterceptions < 1) fail(path, 'defense interception requires an interception count');
  if (result.standardIntercepted && !result.standardFired) fail(path, 'standard interception requires a fired Standard Rocket');
  const firedTypes = Number(result.standardFired) + Number(result.cruiseFired);
  if (result.counterfireShots < firedTypes) fail(path, 'counterfireShots must cover fired ammunition types');
  if (result.hostilePenetrations > result.hostileShots) fail(path, 'penetrations cannot exceed hostile launches');
  if (result.friendlyInterceptions + result.hostilePenetrations > result.hostileShots) {
    fail(path, 'resolved hostile rounds cannot exceed hostile launches');
  }
  if (result.hostileProjectileIds.length + result.friendlyInterceptions + result.hostilePenetrations > result.hostileShots) {
    fail(path, 'tracked and resolved hostile rounds cannot exceed hostile launches');
  }
  if (result.hostileShots > 0 && !result.incomingDetected) fail(path, 'hostileShots require incomingDetected');
  if (result.friendlyInterceptions > 0 && !result.defenseIntercepted) fail(path, 'interception count requires defenseIntercepted');
  if (result.counterfireShots > 0 && !result.standardFired && !result.cruiseFired) fail(path, 'counterfire count requires fired ammunition');
  if (result.protectedEndHp > result.protectedStartHp) fail(path, 'protectedEndHp cannot exceed protectedStartHp');
  return result;
}

function missionObjectives(missionId: MissionId): readonly ObjectiveDefinition[] {
  if (missionId === 'break-the-line') return BREAK_LINE_OBJECTIVES;
  if (missionId === 'counterfire') return COUNTERFIRE_OBJECTIVES;
  return FIRST_CONTACT_OBJECTIVES;
}

function missionTitle(missionId: MissionId): string {
  if (missionId === 'break-the-line') return 'Break the Line';
  if (missionId === 'counterfire') return 'Counterfire';
  return 'First Contact';
}

function firstContactBindings(state: MissionSnapshot): MissionBindings {
  return state.bindings as MissionBindings;
}

function breakLineBindings(state: MissionSnapshot): BreakLineBindings {
  return state.bindings as BreakLineBindings;
}

function counterfireBindings(state: MissionSnapshot): CounterfireBindings {
  return state.bindings as CounterfireBindings;
}

function idArray(value: unknown, path: string, minimumLength: number, maximumLength: number): number[] {
  const values = array(value, path);
  if (values.length < minimumLength || values.length > maximumLength) {
    fail(path, `expected between ${minimumLength} and ${maximumLength} entity ids`);
  }
  const ids = values.map((id, index) => integer(id, `${path}[${index}]`, 1));
  if (new Set(ids).size !== ids.length) fail(path, 'contains duplicate entity ids');
  return ids;
}

function countRecord<T extends string>(value: unknown, path: string, allowed: readonly T[]): Partial<Record<T, number>> {
  const input = record(value, path, [], allowed);
  const result: Partial<Record<T, number>> = {};
  for (const [key, count] of Object.entries(input)) result[key as T] = integer(count, `${path}.${key}`, 0);
  return result;
}

function record(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'expected an object');
  const input = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unexpected field');
  for (const key of required) if (!(key in input)) fail(`${path}.${key}`, 'missing field');
  return input;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(path, `expected a safe integer in [${minimum}, ${maximum}]`);
  }
  return value as number;
}

function finiteNumber(value: unknown, path: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `expected a finite number in [${minimum}, ${maximum}]`);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
  return value;
}

function formatMissionClock(ticks: number): string {
  const seconds = Math.max(0, Math.round(ticks / 30));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
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
