import { parseCampaignProfile, type CampaignLaunch, type CampaignProfile } from './campaignProfile';
import {
  campaignMission,
  isCampaignMissionId,
  type CampaignMissionId,
} from './missionRegistry';

export const CAMPAIGN_MISSION_PARAM = 'campaignMission';
export const CAMPAIGN_INTENT_PARAM = 'campaignIntent';

export type CampaignRouteIntent = 'start' | 'continue' | 'retry' | 'replay';

export interface CampaignRouteContext {
  missionId: CampaignMissionId;
  intent: CampaignRouteIntent;
}

export class CampaignRouteValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignRouteValidationError';
  }
}

export function campaignRouteContextFromParams(
  params: URLSearchParams,
  runtimeScenarioId: string | null,
  profileInput: CampaignProfile,
): CampaignRouteContext | null {
  const missionValues = params.getAll(CAMPAIGN_MISSION_PARAM);
  const intentValues = params.getAll(CAMPAIGN_INTENT_PARAM);
  if (missionValues.length === 0 && intentValues.length === 0) return null;
  if (missionValues.length === 0 || intentValues.length === 0) {
    routeFail('Campaign mission and intent must be specified together');
  }
  if (missionValues.length !== 1 || intentValues.length !== 1) {
    routeFail('Campaign mission and intent must each be specified exactly once');
  }
  const missionId = missionValues[0];
  if (!isCampaignMissionId(missionId)) routeFail(`Unknown campaign mission: ${missionId}`);
  const intent = campaignIntent(intentValues[0]);
  const mission = campaignMission(missionId);
  if (runtimeScenarioId === null) routeFail('Campaign context requires a runtime scenario');
  if (mission.runtimeScenarioId !== runtimeScenarioId || mission.availability !== 'available') {
    routeFail(`${mission.title} does not match runtime scenario ${runtimeScenarioId}`);
  }

  const profile = parseCampaignProfile(profileInput);
  if (!profile.unlockedMissionIds.includes(missionId)) routeFail(`${mission.title} is locked in the campaign profile`);
  if (intent === 'replay') {
    if (!profile.completedMissionIds.includes(missionId)) {
      routeFail(`${mission.title} must be completed before replay`);
    }
  } else if (intent === 'retry') {
    if (profile.currentMissionId !== missionId || profile.lastResult?.outcome !== 'failed' ||
        profile.lastResult.missionId !== missionId) {
      routeFail(`${mission.title} is not the failed current mission for retry`);
    }
  } else if (profile.currentMissionId !== missionId) {
    routeFail(`${mission.title} is not the current campaign mission for ${intent}`);
  }
  return { missionId, intent };
}

export function applyCampaignRouteContext(
  params: URLSearchParams,
  launch: CampaignLaunch,
  intent: CampaignRouteIntent,
): void {
  const mission = campaignMission(launch.missionId);
  if (mission.runtimeScenarioId !== launch.runtimeScenarioId || mission.availability !== 'available') {
    routeFail(`${mission.title} launch does not match its runtime scenario`);
  }
  params.set(CAMPAIGN_MISSION_PARAM, launch.missionId);
  params.set(CAMPAIGN_INTENT_PARAM, campaignIntent(intent));
}

function campaignIntent(value: unknown): CampaignRouteIntent {
  if (value === 'start' || value === 'continue' || value === 'retry' || value === 'replay') return value;
  return routeFail('Campaign intent must be start, continue, retry, or replay');
}

function routeFail(message: string): never {
  throw new CampaignRouteValidationError(message);
}
