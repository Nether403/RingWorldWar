import { describe, expect, it } from 'vitest';
import { Faction } from '@sim/data';
import {
  CAMPAIGN_MISSIONS,
  campaignMission,
  validateMissionRegistry,
  type CampaignMission,
} from '../../src/campaign/missionRegistry';

const TITLES = [
  'First Contact',
  'Break the Line',
  'Counterfire',
  'A Signal in the Spine',
  'The Shadow Front',
  'Anchor the Living',
  'The Listening Arc',
  'Against the Spin',
  'The Weight We Shed',
  'Beneath the Shadow',
  'What We Carry',
  'Migration Window',
];

const PURPOSES = [
  'Controls, economy, wrap, first Node, favorable artillery direction',
  'Established base, scouting, two-front movement, artillery positioning',
  'Power, interception, ammunition counters, threat telegraphing',
  'Bulwark escort, Needle threat, land transport, final-correction evidence',
  'Inhabited-arc defense, strikecraft, anti-air, shadow timing, paired Nodes',
  'Multi-front Alignment finale, air transport, capture versus destruction',
  'Sensing, rapid construction, fragile-force preservation, Needle reconnaissance',
  'Relocation after fire and favorable-direction attacks',
  'Land transports, archives, evacuees, and dismantling choices',
  'Sensor resilience, strikecraft, anti-air route planning',
  'Air transport and paired-node chord evacuation',
  'Distributed launch defense and Migration Alignment finale',
];

describe('campaign mission registry', () => {
  it('contains the roadmap missions in exact Compact then Choir order', () => {
    expect(CAMPAIGN_MISSIONS).toHaveLength(12);
    expect(CAMPAIGN_MISSIONS.map((mission) => mission.id)).toEqual([
      'compact-01', 'compact-02', 'compact-03', 'compact-04', 'compact-05', 'compact-06',
      'choir-01', 'choir-02', 'choir-03', 'choir-04', 'choir-05', 'choir-06',
    ]);
    expect(CAMPAIGN_MISSIONS.map((mission) => mission.title)).toEqual(TITLES);
    expect(CAMPAIGN_MISSIONS.map((mission) => mission.purpose)).toEqual(PURPOSES);
    expect(CAMPAIGN_MISSIONS.slice(0, 6).every((mission) => mission.faction === Faction.Compact)).toBe(true);
    expect(CAMPAIGN_MISSIONS.slice(6).every((mission) => mission.faction === Faction.Choir)).toBe(true);
    expect(CAMPAIGN_MISSIONS.map((mission) => mission.campaignIndex)).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]);
  });

  it('associates only migrated production scenarios with launchable missions', () => {
    expect(campaignMission('compact-01')).toMatchObject({
      runtimeScenarioId: 'first-contact',
      availability: 'available',
    });
    expect(campaignMission('compact-02')).toMatchObject({
      runtimeScenarioId: null,
      availability: 'unavailable',
    });
    expect(CAMPAIGN_MISSIONS.filter((mission) => mission.availability === 'available').map((mission) => mission.id))
      .toEqual(['compact-01']);
  });

  it('rejects duplicate IDs, broken links, wrong faction order, and dishonest availability', () => {
    const copy = (): CampaignMission[] => structuredClone(CAMPAIGN_MISSIONS) as CampaignMission[];
    const duplicate = copy();
    duplicate[1]!.id = duplicate[0]!.id;
    expect(() => validateMissionRegistry(duplicate)).toThrow(/duplicate/i);

    const brokenLink = copy();
    brokenLink[0]!.nextMissionId = 'choir-06';
    expect(() => validateMissionRegistry(brokenLink)).toThrow(/next mission/i);

    const wrongFaction = copy();
    wrongFaction[2]!.faction = Faction.Choir;
    expect(() => validateMissionRegistry(wrongFaction)).toThrow(/faction|order/i);

    const dishonest = copy();
    dishonest[1]!.availability = 'available';
    expect(() => validateMissionRegistry(dishonest)).toThrow(/runtime scenario/i);

    const wrongStatus = copy();
    wrongStatus[0]!.status = 'planned';
    expect(() => validateMissionRegistry(wrongStatus)).toThrow(/status/i);

    const wrongScenario = copy();
    wrongScenario[0]!.runtimeScenarioId = 'not-first-contact' as 'first-contact';
    expect(() => validateMissionRegistry(wrongScenario)).toThrow(/runtime scenario/i);
  });
});
