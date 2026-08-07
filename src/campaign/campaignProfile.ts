import {
  CAMPAIGN_MISSIONS,
  campaignMission,
  isCampaignMissionId,
  type CampaignMission,
  type CampaignMissionId,
  type CampaignRuntimeScenarioId,
} from './missionRegistry';

export const CAMPAIGN_PROFILE_KEY = 'ring-world-war/campaign-profile';
export const CAMPAIGN_PROFILE_SCHEMA = 'ring-world-war/campaign-profile';
export const CAMPAIGN_PROFILE_VERSION = 2;
const MAX_CAMPAIGN_PROFILE_BYTES = 64 * 1024;

export interface CampaignResult {
  missionId: CampaignMissionId;
  outcome: 'completed' | 'failed';
}

export interface CampaignProfile {
  schema: typeof CAMPAIGN_PROFILE_SCHEMA;
  version: typeof CAMPAIGN_PROFILE_VERSION;
  revision: number;
  unlockedMissionIds: CampaignMissionId[];
  completedMissionIds: CampaignMissionId[];
  currentMissionId: CampaignMissionId | null;
  lastResult: CampaignResult | null;
}

export interface CampaignLaunch {
  missionId: CampaignMissionId;
  runtimeScenarioId: CampaignRuntimeScenarioId;
}

export interface CampaignTransition {
  profile: CampaignProfile;
  launch: CampaignLaunch;
}

export interface CampaignProfileLoadResult {
  profile: CampaignProfile;
  recovered: boolean;
  migrated: boolean;
}

export interface CampaignProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class CampaignProfileValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignProfileValidationError';
  }
}

export class CampaignActionError extends Error {
  constructor(
    readonly code: 'locked' | 'unavailable' | 'not-completed' | 'no-continuation' | 'wrong-current',
    message: string,
  ) {
    super(message);
    this.name = 'CampaignActionError';
  }
}

export function createCampaignProfile(): CampaignProfile {
  return {
    schema: CAMPAIGN_PROFILE_SCHEMA,
    version: CAMPAIGN_PROFILE_VERSION,
    revision: 0,
    unlockedMissionIds: ['compact-01', 'choir-01'],
    completedMissionIds: [],
    currentMissionId: 'compact-01',
    lastResult: null,
  };
}

export function parseCampaignProfile(input: unknown): CampaignProfile {
  if (typeof input === 'string' && input.length > MAX_CAMPAIGN_PROFILE_BYTES) {
    profileFail('$', `profile exceeds ${MAX_CAMPAIGN_PROFILE_BYTES} byte size limit`);
  }
  const value = typeof input === 'string' ? parseJson(input) : input;
  if (!isRecord(value)) profileFail('$', 'expected an object');
  if (value.version === 1) return migrateVersionOne(value);
  const root = exactObject(value, '$', [
    'schema', 'version', 'revision', 'unlockedMissionIds', 'completedMissionIds', 'currentMissionId', 'lastResult',
  ]);
  if (root.schema !== CAMPAIGN_PROFILE_SCHEMA) profileFail('$.schema', `expected ${CAMPAIGN_PROFILE_SCHEMA}`);
  if (root.version !== CAMPAIGN_PROFILE_VERSION) profileFail('$.version', `expected version 1 or ${CAMPAIGN_PROFILE_VERSION}`);
  return validateProfile({
    schema: CAMPAIGN_PROFILE_SCHEMA,
    version: CAMPAIGN_PROFILE_VERSION,
    revision: integer(root.revision, '$.revision'),
    unlockedMissionIds: missionIds(root.unlockedMissionIds, '$.unlockedMissionIds'),
    completedMissionIds: missionIds(root.completedMissionIds, '$.completedMissionIds'),
    currentMissionId: nullableMissionId(root.currentMissionId, '$.currentMissionId'),
    lastResult: readResult(root.lastResult, '$.lastResult'),
  });
}

export function loadCampaignProfile(storage: CampaignProfileStorage): CampaignProfileLoadResult {
  const stored = storage.getItem(CAMPAIGN_PROFILE_KEY);
  if (stored === null) {
    const profile = createCampaignProfile();
    saveCampaignProfile(storage, profile);
    return { profile, recovered: false, migrated: false };
  }
  try {
    const raw = JSON.parse(stored) as unknown;
    const migrated = isRecord(raw) && raw.version === 1;
    const profile = parseCampaignProfile(raw);
    if (migrated) saveCampaignProfile(storage, profile);
    return { profile, recovered: false, migrated };
  } catch {
    const profile = createCampaignProfile();
    saveCampaignProfile(storage, profile);
    return { profile, recovered: true, migrated: false };
  }
}

export function saveCampaignProfile(storage: CampaignProfileStorage, profile: CampaignProfile): void {
  const validated = parseCampaignProfile(profile);
  storage.setItem(CAMPAIGN_PROFILE_KEY, JSON.stringify(validated));
}

export function startCampaignMission(profile: CampaignProfile, missionId: CampaignMissionId): CampaignTransition {
  const valid = parseCampaignProfile(profile);
  const mission = requireLaunchable(valid, missionId);
  return {
    profile: revise(valid, { currentMissionId: missionId, lastResult: null }),
    launch: launchFor(mission),
  };
}

export function completeCampaignMission(profile: CampaignProfile, missionId: CampaignMissionId): CampaignProfile {
  const valid = parseCampaignProfile(profile);
  if (valid.currentMissionId !== missionId) {
    throw new CampaignActionError('wrong-current', `${campaignMission(missionId).title} is not the current campaign mission`);
  }
  const mission = campaignMission(missionId);
  const completed = new Set(valid.completedMissionIds);
  completed.add(missionId);
  const unlocked = new Set(valid.unlockedMissionIds);
  if (mission.nextMissionId) unlocked.add(mission.nextMissionId);
  return revise(valid, {
    unlockedMissionIds: orderedIds(unlocked),
    completedMissionIds: orderedIds(completed),
    currentMissionId: mission.nextMissionId,
    lastResult: { missionId, outcome: 'completed' },
  });
}

export function recordCampaignFailure(profile: CampaignProfile, missionId: CampaignMissionId): CampaignProfile {
  const valid = parseCampaignProfile(profile);
  if (valid.currentMissionId !== missionId) {
    throw new CampaignActionError('wrong-current', `${campaignMission(missionId).title} is not the current campaign mission`);
  }
  return revise(valid, { lastResult: { missionId, outcome: 'failed' } });
}

export function recordCampaignReplayResult(
  profile: CampaignProfile,
  missionId: CampaignMissionId,
  outcome: CampaignResult['outcome'],
): CampaignProfile {
  const valid = parseCampaignProfile(profile);
  if (!valid.completedMissionIds.includes(missionId)) {
    throw new CampaignActionError('not-completed', `${campaignMission(missionId).title} is not completed`);
  }
  return revise(valid, { lastResult: { missionId, outcome } });
}

export function retryCampaignMission(profile: CampaignProfile): CampaignTransition {
  const valid = parseCampaignProfile(profile);
  if (valid.lastResult?.outcome !== 'failed') {
    throw new CampaignActionError('no-continuation', 'No failed campaign mission is available to retry');
  }
  const missionId = valid.lastResult.missionId;
  const mission = requireLaunchable(valid, missionId);
  return {
    profile: revise(valid, { currentMissionId: missionId }),
    launch: launchFor(mission),
  };
}

export function replayCampaignMission(profile: CampaignProfile, missionId: CampaignMissionId): CampaignTransition {
  const valid = parseCampaignProfile(profile);
  if (!valid.completedMissionIds.includes(missionId)) {
    throw new CampaignActionError('not-completed', `${campaignMission(missionId).title} is not completed`);
  }
  const mission = requireLaunchable(valid, missionId);
  return {
    profile: revise(valid, { lastResult: null }),
    launch: launchFor(mission),
  };
}

export function continueCampaign(profile: CampaignProfile): CampaignTransition {
  const valid = parseCampaignProfile(profile);
  if (valid.currentMissionId === null) {
    throw new CampaignActionError('no-continuation', 'This campaign arc is complete');
  }
  return startCampaignMission(valid, valid.currentMissionId);
}

function requireLaunchable(profile: CampaignProfile, missionId: CampaignMissionId): CampaignMission {
  const mission = campaignMission(missionId);
  if (!profile.unlockedMissionIds.includes(missionId)) {
    throw new CampaignActionError('locked', `${mission.title} is locked`);
  }
  if (mission.availability !== 'available' || mission.runtimeScenarioId === null) {
    throw new CampaignActionError('unavailable', `${mission.title} is unlocked but not available yet`);
  }
  return mission;
}

function launchFor(mission: CampaignMission): CampaignLaunch {
  if (mission.runtimeScenarioId === null) {
    throw new CampaignActionError('unavailable', `${mission.title} is unlocked but not available yet`);
  }
  return { missionId: mission.id, runtimeScenarioId: mission.runtimeScenarioId };
}

function revise(profile: CampaignProfile, changes: Partial<Omit<CampaignProfile, 'schema' | 'version' | 'revision'>>): CampaignProfile {
  return validateProfile({ ...profile, ...changes, revision: profile.revision + 1 });
}

function validateProfile(profile: CampaignProfile): CampaignProfile {
  const unlocked = new Set(profile.unlockedMissionIds);
  const completed = new Set(profile.completedMissionIds);
  if (unlocked.size !== profile.unlockedMissionIds.length) profileFail('$.unlockedMissionIds', 'contains duplicate mission ids');
  if (completed.size !== profile.completedMissionIds.length) profileFail('$.completedMissionIds', 'contains duplicate mission ids');
  if (!unlocked.has('compact-01') || !unlocked.has('choir-01')) {
    profileFail('$.unlockedMissionIds', 'must contain both faction openers');
  }
  if (!sameIds(profile.unlockedMissionIds, orderedIds(unlocked))) {
    profileFail('$.unlockedMissionIds', 'must follow registry order');
  }
  if (!sameIds(profile.completedMissionIds, orderedIds(completed))) {
    profileFail('$.completedMissionIds', 'must follow registry order');
  }
  for (const missionId of completed) {
    if (!unlocked.has(missionId)) profileFail('$.completedMissionIds', `${missionId} must also be unlocked`);
  }
  for (const mission of CAMPAIGN_MISSIONS) {
    if (!unlocked.has(mission.id) || mission.campaignIndex === 1) continue;
    const predecessor = CAMPAIGN_MISSIONS.find((candidate) => candidate.nextMissionId === mission.id)!;
    if (!completed.has(predecessor.id)) {
      profileFail('$.unlockedMissionIds', `${mission.id} requires its predecessor ${predecessor.id} to be completed`);
    }
  }
  if (profile.currentMissionId !== null && !unlocked.has(profile.currentMissionId)) {
    profileFail('$.currentMissionId', 'must reference an unlocked mission');
  }
  if (profile.lastResult?.outcome === 'completed' && !completed.has(profile.lastResult.missionId)) {
    profileFail('$.lastResult', 'completed result must reference a completed mission');
  }
  if (profile.lastResult !== null && !unlocked.has(profile.lastResult.missionId)) {
    profileFail('$.lastResult', 'must reference an unlocked mission');
  }
  return structuredClone(profile);
}

function migrateVersionOne(value: Record<string, unknown>): CampaignProfile {
  const root = exactObject(value, '$', [
    'schema', 'version', 'revision', 'completedMissionIds', 'currentMissionId',
  ]);
  if (root.schema !== CAMPAIGN_PROFILE_SCHEMA) profileFail('$.schema', `expected ${CAMPAIGN_PROFILE_SCHEMA}`);
  if (root.version !== 1) profileFail('$.version', 'expected version 1');
  const completedMissionIds = missionIds(root.completedMissionIds, '$.completedMissionIds');
  const unlocked = new Set<CampaignMissionId>(['compact-01', 'choir-01']);
  for (const id of completedMissionIds) {
    const next = campaignMission(id).nextMissionId;
    if (next) unlocked.add(next);
  }
  const currentMissionId = nullableMissionId(root.currentMissionId, '$.currentMissionId');
  if (currentMissionId) unlocked.add(currentMissionId);
  const lastCompleted = [...CAMPAIGN_MISSIONS].reverse().find((mission) => completedMissionIds.includes(mission.id));
  return validateProfile({
    schema: CAMPAIGN_PROFILE_SCHEMA,
    version: CAMPAIGN_PROFILE_VERSION,
    revision: integer(root.revision, '$.revision'),
    unlockedMissionIds: orderedIds(unlocked),
    completedMissionIds,
    currentMissionId,
    lastResult: lastCompleted ? { missionId: lastCompleted.id, outcome: 'completed' } : null,
  });
}

function orderedIds(ids: ReadonlySet<CampaignMissionId>): CampaignMissionId[] {
  return CAMPAIGN_MISSIONS.filter((mission) => ids.has(mission.id)).map((mission) => mission.id);
}

function sameIds(left: readonly CampaignMissionId[], right: readonly CampaignMissionId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function missionIds(value: unknown, path: string): CampaignMissionId[] {
  if (!Array.isArray(value) || value.length > CAMPAIGN_MISSIONS.length) profileFail(path, 'expected a bounded mission id array');
  return value.map((id, index) => missionId(id, `${path}[${index}]`));
}

function missionId(value: unknown, path: string): CampaignMissionId {
  if (!isCampaignMissionId(value)) profileFail(path, 'expected a known campaign mission id');
  return value;
}

function nullableMissionId(value: unknown, path: string): CampaignMissionId | null {
  return value === null ? null : missionId(value, path);
}

function readResult(value: unknown, path: string): CampaignResult | null {
  if (value === null) return null;
  const result = exactObject(value, path, ['missionId', 'outcome']);
  if (result.outcome !== 'completed' && result.outcome !== 'failed') profileFail(`${path}.outcome`, 'expected completed or failed');
  return { missionId: missionId(result.missionId, `${path}.missionId`), outcome: result.outcome };
}

function exactObject(value: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) profileFail(path, 'expected an object');
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) if (!allowed.has(key)) profileFail(`${path}.${key}`, 'unexpected field');
  for (const key of fields) if (!(key in value)) profileFail(`${path}.${key}`, 'missing field');
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) profileFail(path, 'expected a non-negative safe integer');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return profileFail('$', 'invalid JSON');
  }
}

function profileFail(path: string, message: string): never {
  throw new CampaignProfileValidationError(`${path}: ${message}`);
}
