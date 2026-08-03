import { surfaceDist } from '@core/ringMath';
import { Faction } from '@sim/data';
import type { World } from '@sim/world';
import type { NarrativeBeat } from './narrative';

export const SIGNAL_HOLD_TICKS = 30 * 30;

export interface SignalInSpineBindings {
  signalNode: number;
  engineer: number;
  bulwark: number;
  needleIds: number[];
  restorationPower: number;
  fieldCommand: number;
}

export interface SignalInSpineMilestones {
  teamAtNode: boolean;
  needlesDefeated: boolean;
  powerRestored: boolean;
  nodeCaptured: boolean;
  holdTicks: number;
  lastHoldWorldTick: number;
  fieldCommandDestroyed: boolean;
  nodeSurvived: boolean;
  milestoneTicks: Array<number | null>;
  failureReason: 'node-destroyed' | 'engineer-killed' | 'match-ended' | null;
}

export const SIGNAL_OBJECTIVES = [
  { id: 'reach-signal-node', title: 'Reach the silent node', body: 'Escort the Engineer and Bulwark to the isolated Spinal Node.', hint: 'Keep the Bulwark between the Engineer and likely ambush routes.' },
  { id: 'break-hunter-screen', title: 'Break the hunter screen', body: 'Defeat the Choir Needles hunting the restoration team.', hint: 'Needles cloak while stationary. Close the distance and hold the Engineer behind the Bulwark.' },
  { id: 'restore-node-power', title: 'Restore node power', body: 'Complete the emergency Fusion Core beside the Spinal Node.', hint: 'Select the Engineer and right-click the unfinished core.' },
  { id: 'take-node', title: 'Establish Compact authority', body: 'Capture the restored Spinal Node.', hint: 'Hold combat units inside the capture radius.' },
  { id: 'decode-signal', title: 'Decode the correction signal', body: 'Hold the node for thirty seconds while its archive unlocks.', hint: 'The timer resets if the node changes hands.' },
  { id: 'disable-field-command', title: 'Cut the Choir link', body: 'Destroy the Choir field command without losing the Spinal Node.', hint: 'The node must survive; concentrate fire on the bound command structure.' },
] as const;

export const SIGNAL_NARRATIVE: readonly NarrativeBeat[] = [
  { id: 'signal-briefing', kind: 'briefing', speaker: 'Marshal Ilyan Voss', faction: Faction.Compact, title: 'A Signal in the Spine', body: 'A dormant Spinal Node is transmitting correction data. Restore it intact. The Choir has dispatched hunters, not demolition crews.', blocking: true },
  { id: 'signal-hunters', kind: 'transmission', speaker: 'Wisp Pilot Sera', faction: Faction.Compact, title: 'Contact', body: 'Needles. They are screening the approaches, but they are not firing on the node.', blocking: false },
  { id: 'signal-migration', kind: 'transmission', speaker: 'Intercepted Choir Chorus', faction: Faction.Choir, title: 'Migration Protocol', body: 'Preserve the vector. The ring is not the vessel. The archive is the seed.', blocking: false },
  { id: 'signal-last-correction', kind: 'transmission', speaker: 'Spinal Archive', faction: -1, title: 'Correction Capacity', body: 'Habitat-scale authority remaining: one operation.', blocking: true },
];

export function emptySignalMilestones(): SignalInSpineMilestones {
  return { teamAtNode: false, needlesDefeated: false, powerRestored: false, nodeCaptured: false, holdTicks: 0, lastHoldWorldTick: -1, fieldCommandDestroyed: false, nodeSurvived: true, milestoneTicks: Array.from({ length: SIGNAL_OBJECTIVES.length }, () => null), failureReason: null };
}

export function updateSignalMilestones(
  state: SignalInSpineMilestones,
  bindings: SignalInSpineBindings,
  world: World,
  objectiveIndex: number,
): SignalInSpineMilestones['failureReason'] {
  if (world.status === 'completed') return (state.failureReason = 'match-ended');
  const node = world.structureById(bindings.signalNode);
  if (!node) return (state.nodeSurvived = false, state.failureReason = 'node-destroyed');
  state.powerRestored ||= world.structureById(bindings.restorationPower)?.progress === 1;
  const engineer = world.unitById(bindings.engineer);
  if (!engineer && (!state.teamAtNode || !state.powerRestored)) {
    return (state.failureReason = 'engineer-killed');
  }
  const bulwark = world.unitById(bindings.bulwark);
  state.teamAtNode ||= Boolean(engineer && bulwark &&
    surfaceDist(engineer.s, engineer.z, node.s, node.z) <= 150 &&
    surfaceDist(bulwark.s, bulwark.z, node.s, node.z) <= 260);
  state.needlesDefeated ||= bindings.needleIds.every((id) => !world.unitById(id));
  state.nodeCaptured ||= node.faction === Faction.Compact;
  if (objectiveIndex === 4 && state.nodeCaptured) {
    if (node.faction === Faction.Compact) {
      if (state.lastHoldWorldTick < 0) state.holdTicks++;
      else if (world.tick > state.lastHoldWorldTick) state.holdTicks += world.tick - state.lastHoldWorldTick;
    } else state.holdTicks = 0;
    state.lastHoldWorldTick = world.tick;
  }
  state.fieldCommandDestroyed ||= !world.structureById(bindings.fieldCommand);
  const values = [state.teamAtNode, state.needlesDefeated, state.powerRestored, state.nodeCaptured, state.holdTicks >= SIGNAL_HOLD_TICKS, state.fieldCommandDestroyed];
  for (let index = 0; index < values.length; index++) if (values[index] && state.milestoneTicks[index] === null) state.milestoneTicks[index] = world.tick;
  return null;
}

export function signalObjectiveMet(state: SignalInSpineMilestones, index: number): boolean {
  switch (SIGNAL_OBJECTIVES[index]?.id) {
    case 'reach-signal-node': return state.teamAtNode;
    case 'break-hunter-screen': return state.needlesDefeated;
    case 'restore-node-power': return state.powerRestored;
    case 'take-node': return state.nodeCaptured;
    case 'decode-signal': return state.holdTicks >= SIGNAL_HOLD_TICKS;
    case 'disable-field-command': return state.fieldCommandDestroyed && state.nodeSurvived;
    default: return false;
  }
}
