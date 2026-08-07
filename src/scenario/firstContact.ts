import { RING_CIRCUMFERENCE, RING_HALF_WIDTH } from '@core/constants';
import type { MissionBindings } from '../tutorial/mission';
import { parseRuntimeScenario } from './runtimeScenario';

const C = RING_CIRCUMFERENCE;

/** Production-authored setup. Validation browser scenarios remain separate fixtures. */
export const FIRST_CONTACT_RUNTIME_SCENARIO = parseRuntimeScenario({
  schema: 'ring-world-war/runtime-scenario',
  version: 1,
  id: 'first-contact',
  worldSeed: 20260803,
  playerFaction: 'compact',
  ai: { enabled: false, difficulty: 'veteran' },
  openingView: {
    focusS: 58,
    focusZ: 0,
    yawRadians: 0,
    zoom: 138,
    actionEntities: ['compact-engineer-1', 'compact-engineer-2', 'compact-engineer-3'],
    contextEntities: ['compact-bastion'],
    highlightDeposits: true,
  },
  players: [
    { faction: 'compact', salvage: 3_000, dominance: 0 },
    { faction: 'choir', salvage: 850, dominance: 0 },
  ],
  structures: [
    { id: 'compact-bastion', faction: 'compact', kind: 'bastion', s: 0, z: 0, progress: 1 },
    { id: 'choir-bastion', faction: 'choir', kind: 'bastion', s: C * 0.5, z: 0, progress: 1 },
    { id: 'choir-power-core', faction: 'choir', kind: 'fusionCore', s: C - 2_600, z: 0, progress: 1 },
    { id: 'tutorial-node', faction: 'neutral', kind: 'spinalNode', s: C - 2_200, z: 0, progress: 1 },
    { id: 'quarter-node', faction: 'neutral', kind: 'spinalNode', s: C * 0.25, z: 0, progress: 1 },
    { id: 'three-quarter-node', faction: 'neutral', kind: 'spinalNode', s: C * 0.75, z: 0, progress: 1 },
    { id: 'rim-node', faction: 'neutral', kind: 'spinalNode', s: C * 0.125, z: RING_HALF_WIDTH * 0.6, progress: 1 },
  ],
  units: [
    { id: 'compact-engineer-1', faction: 'compact', kind: 'engineer', s: 68, z: -70 },
    { id: 'compact-engineer-2', faction: 'compact', kind: 'engineer', s: 82, z: -34 },
    { id: 'compact-engineer-3', faction: 'compact', kind: 'engineer', s: 68, z: 38 },
    { id: 'choir-engineer-1', faction: 'choir', kind: 'engineer', s: C * 0.5 - 65, z: -45 },
    { id: 'choir-engineer-2', faction: 'choir', kind: 'engineer', s: C * 0.5 - 95, z: -65 },
    { id: 'choir-engineer-3', faction: 'choir', kind: 'engineer', s: C * 0.5 - 125, z: -45 },
    {
      id: 'choir-tutorial-raider', faction: 'choir', kind: 'vanguard', s: 68, z: -900,
      healthFraction: 0.65,
      order: { kind: 'move', s: 68, z: -70 },
    },
    {
      id: 'choir-tutorial-hunter', faction: 'choir', kind: 'vanguard', s: 68, z: 900,
      healthFraction: 0.65,
      order: { kind: 'move', s: 68, z: 38 },
    },
  ],
  deposits: [
    { s: 135, z: -88, amount: 9_000 },
    { s: 155, z: 88, amount: 9_000 },
    { s: 190, z: 0, amount: 7_000 },
    { s: C * 0.5 - 190, z: -150, amount: 9_000 },
    { s: C * 0.5 + 190, z: 150, amount: 9_000 },
    { s: C * 0.5 + 40, z: 320, amount: 7_000 },
  ],
  bindings: [
    { id: 'tutorial-node', entity: 'tutorial-node' },
    { id: 'artillery-target', entity: 'choir-power-core' },
  ],
});

export function resolveFirstContactMissionBindings(
  bindings: ReadonlyMap<string, number>,
): MissionBindings {
  return {
    tutorialNode: requiredBinding(bindings, 'tutorial-node'),
    artilleryTarget: requiredBinding(bindings, 'artillery-target'),
  };
}

function requiredBinding(bindings: ReadonlyMap<string, number>, id: string): number {
  const entityId = bindings.get(id);
  if (entityId === undefined) {
    throw new Error(`First Contact runtime scenario is missing required binding ${id}`);
  }
  return entityId;
}
