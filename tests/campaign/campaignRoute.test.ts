import { describe, expect, it } from 'vitest';
import {
  completeCampaignMission,
  createCampaignProfile,
  recordCampaignFailure,
  replayCampaignMission,
  retryCampaignMission,
  startCampaignMission,
} from '../../src/campaign/campaignProfile';
import {
  applyCampaignRouteContext,
  campaignRouteContextFromParams,
} from '../../src/campaign/campaignRoute';

describe('campaign route context', () => {
  it('keeps a standalone runtime scenario outside campaign semantics', () => {
    expect(campaignRouteContextFromParams(
      new URLSearchParams('scenario=first-contact'),
      'first-contact',
      createCampaignProfile(),
    )).toBeNull();
  });

  it('round-trips an allowlisted start, retry, and replay context', () => {
    const started = startCampaignMission(createCampaignProfile(), 'compact-01');
    const startParams = new URLSearchParams('scenario=first-contact');
    applyCampaignRouteContext(startParams, started.launch, 'start');
    expect(campaignRouteContextFromParams(startParams, 'first-contact', started.profile)).toEqual({
      missionId: 'compact-01',
      intent: 'start',
    });

    const retry = retryCampaignMission(recordCampaignFailure(started.profile, 'compact-01'));
    const retryParams = new URLSearchParams('scenario=first-contact');
    applyCampaignRouteContext(retryParams, retry.launch, 'retry');
    expect(campaignRouteContextFromParams(retryParams, 'first-contact', retry.profile)).toEqual({
      missionId: 'compact-01',
      intent: 'retry',
    });

    const completed = completeCampaignMission(started.profile, 'compact-01');
    const replay = replayCampaignMission(completed, 'compact-01');
    const replayParams = new URLSearchParams('scenario=first-contact');
    applyCampaignRouteContext(replayParams, replay.launch, 'replay');
    expect(campaignRouteContextFromParams(replayParams, 'first-contact', replay.profile)).toEqual({
      missionId: 'compact-01',
      intent: 'replay',
    });
  });

  it('rejects partial, duplicate, unknown, mismatched, and profile-inconsistent context', () => {
    const fresh = createCampaignProfile();
    const started = startCampaignMission(fresh, 'compact-01').profile;
    expect(() => campaignRouteContextFromParams(
      new URLSearchParams('scenario=first-contact&campaignMission=compact-01'),
      'first-contact',
      started,
    )).toThrow(/specified together/i);
    expect(() => campaignRouteContextFromParams(
      new URLSearchParams('scenario=first-contact&campaignMission=compact-01&campaignMission=compact-01&campaignIntent=start'),
      'first-contact',
      started,
    )).toThrow(/exactly once/i);
    expect(() => campaignRouteContextFromParams(
      new URLSearchParams('scenario=first-contact&campaignMission=compact-01&campaignIntent=resume'),
      'first-contact',
      started,
    )).toThrow(/intent/i);
    expect(() => campaignRouteContextFromParams(
      new URLSearchParams('scenario=first-contact&campaignMission=choir-01&campaignIntent=start'),
      'first-contact',
      fresh,
    )).toThrow(/scenario/i);
    expect(() => campaignRouteContextFromParams(
      new URLSearchParams('scenario=first-contact&campaignMission=compact-01&campaignIntent=replay'),
      'first-contact',
      fresh,
    )).toThrow(/completed/i);
    expect(() => campaignRouteContextFromParams(
      new URLSearchParams('scenario=first-contact&campaignMission=compact-01&campaignIntent=retry'),
      'first-contact',
      started,
    )).toThrow(/failed/i);
    expect(() => campaignRouteContextFromParams(
      new URLSearchParams('campaignMission=compact-01&campaignIntent=start'),
      null,
      started,
    )).toThrow(/runtime scenario/i);
  });
});
