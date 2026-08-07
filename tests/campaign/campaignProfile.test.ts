import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_PROFILE_KEY,
  CAMPAIGN_PROFILE_SCHEMA,
  CAMPAIGN_PROFILE_VERSION,
  CampaignActionError,
  completeCampaignMission,
  continueCampaign,
  createCampaignProfile,
  loadCampaignProfile,
  parseCampaignProfile,
  recordCampaignFailure,
  recordCampaignReplayResult,
  replayCampaignMission,
  retryCampaignMission,
  saveCampaignProfile,
  startCampaignMission,
} from '../../src/campaign/campaignProfile';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('campaign profile', () => {
  it('starts with each faction opener unlocked and continues into First Contact', () => {
    const profile = createCampaignProfile();
    expect(profile).toEqual({
      schema: CAMPAIGN_PROFILE_SCHEMA,
      version: CAMPAIGN_PROFILE_VERSION,
      revision: 0,
      unlockedMissionIds: ['compact-01', 'choir-01'],
      completedMissionIds: [],
      currentMissionId: 'compact-01',
      lastResult: null,
    });
    expect(continueCampaign(profile).launch).toMatchObject({ missionId: 'compact-01', runtimeScenarioId: 'first-contact' });
  });

  it('unlocks Break the Line on completion but refuses to launch it until its runtime scenario exists', () => {
    const started = startCampaignMission(createCampaignProfile(), 'compact-01');
    const completed = completeCampaignMission(started.profile, 'compact-01');
    expect(completed.unlockedMissionIds).toContain('compact-02');
    expect(completed.completedMissionIds).toEqual(['compact-01']);
    expect(completed.currentMissionId).toBe('compact-02');
    expect(() => continueCampaign(completed)).toThrowError(CampaignActionError);
    expect(() => continueCampaign(completed)).toThrow(/not available yet/i);
    expect(() => startCampaignMission(completed, 'compact-02')).toThrow(/not available yet/i);
  });

  it('supports retry after failure and replay only after completion', () => {
    const started = startCampaignMission(createCampaignProfile(), 'compact-01').profile;
    expect(() => retryCampaignMission(started)).toThrow(/failed campaign mission/i);
    const failed = recordCampaignFailure(started, 'compact-01');
    expect(retryCampaignMission(failed).launch.missionId).toBe('compact-01');
    expect(() => replayCampaignMission(failed, 'compact-01')).toThrow(/not completed/i);

    const completed = completeCampaignMission(started, 'compact-01');
    const replay = replayCampaignMission(completed, 'compact-01');
    expect(replay.launch).toMatchObject({
      missionId: 'compact-01',
      runtimeScenarioId: 'first-contact',
    });
    expect(replay.profile.currentMissionId).toBe('compact-02');
    expect(recordCampaignReplayResult(replay.profile, 'compact-01', 'completed')).toMatchObject({
      currentMissionId: 'compact-02',
      lastResult: { missionId: 'compact-01', outcome: 'completed' },
    });
    expect(recordCampaignReplayResult(replay.profile, 'compact-01', 'failed')).toMatchObject({
      currentMissionId: 'compact-02',
      lastResult: { missionId: 'compact-01', outcome: 'failed' },
    });
  });

  it('strictly rejects unknown, corrupt, duplicate, and impossible version 2 shapes', () => {
    const valid = createCampaignProfile();
    expect(() => parseCampaignProfile({ ...valid, extra: true })).toThrow(/unexpected field/i);
    expect(() => parseCampaignProfile({ ...valid, revision: -1 })).toThrow(/revision/i);
    expect(() => parseCampaignProfile({ ...valid, unlockedMissionIds: ['compact-01', 'compact-01'] }))
      .toThrow(/duplicate/i);
    expect(() => parseCampaignProfile({ ...valid, currentMissionId: 'unknown-01' })).toThrow(/mission/i);
    expect(() => parseCampaignProfile({ ...valid, unlockedMissionIds: ['compact-01'] })).toThrow(/opener/i);
    expect(() => parseCampaignProfile({
      ...valid,
      unlockedMissionIds: ['choir-01', 'compact-01'],
    })).toThrow(/registry order/i);
    expect(() => parseCampaignProfile({
      ...valid,
      unlockedMissionIds: ['compact-01', 'compact-02', 'choir-01'],
    })).toThrow(/predecessor/i);
    expect(() => parseCampaignProfile({
      ...valid,
      lastResult: { missionId: 'compact-01', outcome: 'completed' },
    })).toThrow(/completed result/i);
    expect(() => parseCampaignProfile({
      ...valid,
      lastResult: { missionId: 'compact-02', outcome: 'failed' },
    })).toThrow(/unlocked mission/i);
  });

  it('migrates a strict version 1 fixture and derives unlocked progression', () => {
    const migrated = parseCampaignProfile({
      schema: CAMPAIGN_PROFILE_SCHEMA,
      version: 1,
      revision: 7,
      completedMissionIds: ['compact-01'],
      currentMissionId: 'compact-02',
    });
    expect(migrated).toEqual({
      schema: CAMPAIGN_PROFILE_SCHEMA,
      version: CAMPAIGN_PROFILE_VERSION,
      revision: 7,
      unlockedMissionIds: ['compact-01', 'compact-02', 'choir-01'],
      completedMissionIds: ['compact-01'],
      currentMissionId: 'compact-02',
      lastResult: { missionId: 'compact-01', outcome: 'completed' },
    });
  });

  it('recovers a corrupt campaign profile without deleting or replacing a valid match save', () => {
    const storage = new MemoryStorage();
    const matchKey = 'ring-world-war/save-slot';
    storage.setItem(matchKey, '{"valid":"match-save"}');
    storage.setItem(CAMPAIGN_PROFILE_KEY, '{corrupt');

    const loaded = loadCampaignProfile(storage);

    expect(loaded.recovered).toBe(true);
    expect(loaded.profile).toEqual(createCampaignProfile());
    expect(storage.getItem(matchKey)).toBe('{"valid":"match-save"}');
    expect(parseCampaignProfile(storage.getItem(CAMPAIGN_PROFILE_KEY))).toEqual(createCampaignProfile());
  });

  it('round-trips profile persistence independently', () => {
    const storage = new MemoryStorage();
    const profile = completeCampaignMission(createCampaignProfile(), 'compact-01');
    saveCampaignProfile(storage, profile);
    expect(loadCampaignProfile(storage)).toMatchObject({ profile, recovered: false, migrated: false });
  });
});
