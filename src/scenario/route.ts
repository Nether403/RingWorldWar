import { FIRST_CONTACT_RUNTIME_SCENARIO } from './firstContact';
import type { CampaignRuntimeScenarioId } from '../campaign/missionRegistry';
import type { RuntimeScenario } from './runtimeScenario';

export function runtimeScenarioFromParams(params: URLSearchParams): RuntimeScenario | null {
  const requested = params.getAll('scenario');
  if (requested.length === 0) return null;
  if (requested.length !== 1) throw new Error('Runtime scenario query must be specified exactly once');
  if (requested[0] === 'first-contact') return runtimeScenarioById(requested[0]);
  throw new Error(`Unsupported runtime scenario: ${requested[0]}`);
}

export function runtimeScenarioById(id: CampaignRuntimeScenarioId): RuntimeScenario {
  if (id === 'first-contact') return FIRST_CONTACT_RUNTIME_SCENARIO;
  throw new Error(`Unsupported runtime scenario: ${id}`);
}
