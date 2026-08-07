import { Faction } from '@sim/data';

export type CampaignMissionId =
  | 'compact-01' | 'compact-02' | 'compact-03' | 'compact-04' | 'compact-05' | 'compact-06'
  | 'choir-01' | 'choir-02' | 'choir-03' | 'choir-04' | 'choir-05' | 'choir-06';

export type CampaignMissionStatus = 'existing-revise' | 'new' | 'planned';
export type CampaignMissionAvailability = 'available' | 'unavailable';
export type CampaignRuntimeScenarioId = 'first-contact';

export interface CampaignMission {
  id: CampaignMissionId;
  faction: Faction;
  campaignIndex: number;
  title: string;
  purpose: string;
  status: CampaignMissionStatus;
  availability: CampaignMissionAvailability;
  runtimeScenarioId: CampaignRuntimeScenarioId | null;
  nextMissionId: CampaignMissionId | null;
}

const DEFINITIONS = [
  ['compact-01', Faction.Compact, 1, 'First Contact', 'Controls, economy, wrap, first Node, favorable artillery direction', 'existing-revise', 'available', 'first-contact', 'compact-02'],
  ['compact-02', Faction.Compact, 2, 'Break the Line', 'Established base, scouting, two-front movement, artillery positioning', 'existing-revise', 'unavailable', null, 'compact-03'],
  ['compact-03', Faction.Compact, 3, 'Counterfire', 'Power, interception, ammunition counters, threat telegraphing', 'existing-revise', 'unavailable', null, 'compact-04'],
  ['compact-04', Faction.Compact, 4, 'A Signal in the Spine', 'Bulwark escort, Needle threat, land transport, final-correction evidence', 'existing-revise', 'unavailable', null, 'compact-05'],
  ['compact-05', Faction.Compact, 5, 'The Shadow Front', 'Inhabited-arc defense, strikecraft, anti-air, shadow timing, paired Nodes', 'new', 'unavailable', null, 'compact-06'],
  ['compact-06', Faction.Compact, 6, 'Anchor the Living', 'Multi-front Alignment finale, air transport, capture versus destruction', 'new', 'unavailable', null, null],
  ['choir-01', Faction.Choir, 1, 'The Listening Arc', 'Sensing, rapid construction, fragile-force preservation, Needle reconnaissance', 'planned', 'unavailable', null, 'choir-02'],
  ['choir-02', Faction.Choir, 2, 'Against the Spin', 'Relocation after fire and favorable-direction attacks', 'planned', 'unavailable', null, 'choir-03'],
  ['choir-03', Faction.Choir, 3, 'The Weight We Shed', 'Land transports, archives, evacuees, and dismantling choices', 'planned', 'unavailable', null, 'choir-04'],
  ['choir-04', Faction.Choir, 4, 'Beneath the Shadow', 'Sensor resilience, strikecraft, anti-air route planning', 'planned', 'unavailable', null, 'choir-05'],
  ['choir-05', Faction.Choir, 5, 'What We Carry', 'Air transport and paired-node chord evacuation', 'planned', 'unavailable', null, 'choir-06'],
  ['choir-06', Faction.Choir, 6, 'Migration Window', 'Distributed launch defense and Migration Alignment finale', 'planned', 'unavailable', null, null],
] as const;

export const CAMPAIGN_MISSIONS: readonly CampaignMission[] = validateMissionRegistry(
  DEFINITIONS.map(([
    id, faction, campaignIndex, title, purpose, status, availability, runtimeScenarioId, nextMissionId,
  ]) => ({ id, faction, campaignIndex, title, purpose, status, availability, runtimeScenarioId, nextMissionId })),
);

const MISSION_BY_ID = new Map(CAMPAIGN_MISSIONS.map((mission) => [mission.id, mission]));

export function campaignMission(id: CampaignMissionId): CampaignMission {
  const mission = MISSION_BY_ID.get(id);
  if (!mission) throw new MissionRegistryValidationError(`Unknown campaign mission: ${id}`);
  return mission;
}

export function isCampaignMissionId(value: unknown): value is CampaignMissionId {
  return typeof value === 'string' && MISSION_BY_ID.has(value as CampaignMissionId);
}

export class MissionRegistryValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'MissionRegistryValidationError';
  }
}

export function validateMissionRegistry(input: readonly CampaignMission[]): readonly CampaignMission[] {
  if (input.length !== DEFINITIONS.length) {
    fail(`Mission registry must contain exactly ${DEFINITIONS.length} missions`);
  }
  const ids = new Set<string>();
  const scenarios = new Set<string>();
  for (let index = 0; index < input.length; index++) {
    const mission = input[index]!;
    const expected = DEFINITIONS[index]!;
    if (ids.has(mission.id)) fail(`Duplicate mission ID: ${mission.id}`);
    ids.add(mission.id);
    if (mission.id !== expected[0]) fail(`Wrong mission order: expected ${expected[0]}, received ${mission.id}`);
    if (mission.faction !== expected[1]) fail(`${mission.id} has the wrong faction or faction order`);
    if (mission.campaignIndex !== expected[2]) fail(`${mission.id} has the wrong campaign index`);
    if (mission.title !== expected[3]) fail(`${mission.id} has the wrong roadmap title`);
    if (mission.purpose !== expected[4]) fail(`${mission.id} has the wrong roadmap purpose`);
    if (mission.status !== expected[5]) fail(`${mission.id} has the wrong roadmap status`);
    if (mission.nextMissionId !== expected[8]) fail(`${mission.id} has a broken next mission link`);
    if (mission.runtimeScenarioId !== expected[7]) fail(`${mission.id} has the wrong runtime scenario association`);
    if (mission.availability === 'available') {
      if (mission.runtimeScenarioId === null) fail(`${mission.id} is available without a runtime scenario`);
      if (scenarios.has(mission.runtimeScenarioId)) fail(`Duplicate runtime scenario: ${mission.runtimeScenarioId}`);
      scenarios.add(mission.runtimeScenarioId);
    } else if (mission.availability === 'unavailable') {
      if (mission.runtimeScenarioId !== null) fail(`${mission.id} has a runtime scenario but is marked unavailable`);
    } else {
      fail(`${mission.id} has invalid availability`);
    }
  }
  for (const mission of input) {
    if (mission.nextMissionId !== null && !ids.has(mission.nextMissionId)) {
      fail(`${mission.id} next mission does not exist: ${mission.nextMissionId}`);
    }
  }
  return Object.freeze(input.map((mission) => Object.freeze({ ...mission })));
}

function fail(message: string): never {
  throw new MissionRegistryValidationError(message);
}
