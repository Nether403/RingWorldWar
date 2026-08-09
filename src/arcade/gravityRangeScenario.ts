import { Faction } from '@sim/data';
import { parseRuntimeScenario, type RuntimeScenario } from '../scenario/runtimeScenario';

export interface GravityRangeBindings {
  launcherId: number;
  spinwardTargetId: number;
  antispinwardTargetId: number;
}

export const GRAVITY_RANGE_SCENARIO: RuntimeScenario = parseRuntimeScenario({
  schema: 'ring-world-war/runtime-scenario',
  version: 2,
  id: 'gravity-range',
  worldSeed: 20260809,
  playerFaction: 'compact',
  ai: { enabled: false, difficulty: 'recruit' },
  openingView: {
    focusS: 4_000,
    focusZ: 0,
    yawRadians: 0,
    zoom: 420,
    actionEntities: ['range-launcher'],
    contextEntities: ['spinward-target', 'antispinward-target'],
    highlightDeposits: false,
  },
  players: [
    { faction: 'compact', salvage: 0, dominance: 0 },
    { faction: 'choir', salvage: 0, dominance: 0 },
  ],
  structures: [
    { id: 'compact-range-bastion', faction: 'compact', kind: 'bastion', s: 3_600, z: -1_500, progress: 1 },
    { id: 'choir-range-bastion', faction: 'choir', kind: 'bastion', s: 14_000, z: 1_500, progress: 1 },
    { id: 'range-launcher', faction: 'compact', kind: 'rocketBattery', s: 4_000, z: 0, progress: 1 },
    { id: 'range-power', faction: 'compact', kind: 'fusionCore', s: 4_300, z: 300, progress: 1 },
    { id: 'spinward-sensor', faction: 'compact', kind: 'radarMast', s: 4_800, z: 120, progress: 1 },
    { id: 'antispinward-sensor-a', faction: 'compact', kind: 'radarMast', s: 3_100, z: -120, progress: 1 },
    { id: 'antispinward-sensor-b', faction: 'compact', kind: 'radarMast', s: 2_200, z: 120, progress: 1 },
    { id: 'spinward-target', faction: 'choir', kind: 'extractor', s: 4_800, z: 0, progress: 1 },
    { id: 'antispinward-target', faction: 'choir', kind: 'extractor', s: 2_200, z: 0, progress: 1 },
  ],
  units: [],
  deposits: [],
  bindings: [
    { id: 'gravity-range-launcher', entity: 'range-launcher' },
    { id: 'gravity-range-spinward-target', entity: 'spinward-target' },
    { id: 'gravity-range-antispinward-target', entity: 'antispinward-target' },
  ],
  spinalPairs: [],
});

export function resolveGravityRangeBindings(bindings: ReadonlyMap<string, number>): GravityRangeBindings {
  return {
    launcherId: requiredBinding(bindings, 'gravity-range-launcher'),
    spinwardTargetId: requiredBinding(bindings, 'gravity-range-spinward-target'),
    antispinwardTargetId: requiredBinding(bindings, 'gravity-range-antispinward-target'),
  };
}

function requiredBinding(bindings: ReadonlyMap<string, number>, id: string): number {
  const entityId = bindings.get(id);
  if (entityId === undefined) throw new Error(`Gravity Range is missing binding: ${id}`);
  return entityId;
}

export const GRAVITY_RANGE_PLAYER_FACTION = Faction.Compact;
