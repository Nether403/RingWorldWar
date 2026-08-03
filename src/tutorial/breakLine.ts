import { deltaS, surfaceDist } from '@core/ringMath';
import { Faction } from '@sim/data';
import type { World } from '@sim/world';

export const BREAK_LINE_HOLD_TICKS = 30 * 30;

export interface BreakLineBindings {
  forwardNode: number;
  protectedExtractor: number;
  enemyArtillery: number;
  strongpointIds: number[];
  raiderIds: number[];
}

export interface BreakLineMilestones {
  scoutedArtillery: boolean;
  capturedForwardNode: boolean;
  raidersDefeated: boolean;
  extractorSurvived: boolean;
  favorableLongbow: boolean;
  artilleryDestroyed: boolean;
  strongpointDestroyed: boolean;
  holdTicks: number;
  lastHoldWorldTick: number;
  milestoneTicks: Array<number | null>;
  failureReason: 'extractor-destroyed' | 'match-ended' | null;
}

export const BREAK_LINE_OBJECTIVES = [
  {
    id: 'hold-salvage-line',
    title: 'Hold the salvage line',
    body: 'Defeat the incoming Choir raiders before they destroy the protected Extractor.',
    hint: 'The established defence group begins selected. Intercept the raid before sending the Wisp forward.',
  },
  {
    id: 'scout-forward-line',
    title: 'Find the Choir line',
    body: 'Use the Wisp to reveal the enemy artillery position and inspect the axial approaches.',
    hint: 'Scout ahead of the main force. Sensor coverage reveals targets; exact terrain still controls line of sight.',
  },
  {
    id: 'secure-forward-node',
    title: 'Secure the forward node',
    body: 'Capture the forward Spinal Node to anchor the attack and expand command capacity.',
    hint: 'Move combat units close to the neutral node and hold the area until capture completes.',
  },
  {
    id: 'establish-high-ground',
    title: 'Make direction the high ground',
    body: 'Deploy a Longbow near the forward node so the enemy battery lies antispinward of it.',
    hint: 'The target must sit to the left of the deployed launcher. The node marks the intended firing ground.',
  },
  {
    id: 'silence-artillery',
    title: 'Silence the Choir battery',
    body: 'Destroy the enemy Rocket Battery before pushing into the strongpoint.',
    hint: 'Use Wisp spotting and explicit Siege Mortar ground fire. Preview blockers remain authoritative.',
  },
  {
    id: 'break-strongpoint',
    title: 'Break the strongpoint',
    body: 'Destroy the remaining bound Choir power, sensor, and defensive structures.',
    hint: 'Protect the Longbow while the line force closes. The objective tracks the whole fortified group.',
  },
  {
    id: 'hold-forward-line',
    title: 'Consolidate the breach',
    body: 'Keep the forward node under Compact control for thirty seconds.',
    hint: 'The hold timer resets if the node changes hands. Re-form the line instead of chasing survivors.',
  },
] as const;

export function emptyBreakLineMilestones(): BreakLineMilestones {
  return {
    scoutedArtillery: false,
    capturedForwardNode: false,
    raidersDefeated: false,
    extractorSurvived: true,
    favorableLongbow: false,
    artilleryDestroyed: false,
    strongpointDestroyed: false,
    holdTicks: 0,
    lastHoldWorldTick: -1,
    milestoneTicks: Array.from({ length: BREAK_LINE_OBJECTIVES.length }, () => null),
    failureReason: null,
  };
}

export function updateBreakLineMilestones(
  milestones: BreakLineMilestones,
  bindings: BreakLineBindings,
  world: World,
  objectiveIndex: number,
): BreakLineMilestones['failureReason'] {
  if (world.status === 'completed') {
    milestones.failureReason = 'match-ended';
    return milestones.failureReason;
  }
  const mark = (index: number, achieved: boolean): void => {
    if (!achieved || milestones.milestoneTicks[index] !== null) return;
    milestones.milestoneTicks[index] = world.tick;
  };
  const artillery = world.structureById(bindings.enemyArtillery);
  milestones.artilleryDestroyed ||= !artillery;
  milestones.scoutedArtillery ||= milestones.artilleryDestroyed ||
    Boolean(artillery && world.isEntityVisible(Faction.Compact, artillery.id));
  mark(1, milestones.scoutedArtillery);

  const node = world.structureById(bindings.forwardNode);
  milestones.capturedForwardNode ||= node?.faction === Faction.Compact;
  mark(2, milestones.capturedForwardNode);
  milestones.raidersDefeated ||= bindings.raiderIds.every((id) => !world.unitById(id));
  mark(0, milestones.raidersDefeated);

  const extractor = world.structureById(bindings.protectedExtractor);
  if (!extractor && !milestones.raidersDefeated) {
    milestones.extractorSurvived = false;
    milestones.failureReason = 'extractor-destroyed';
    return milestones.failureReason;
  }

  if (!milestones.favorableLongbow && artillery) {
    milestones.favorableLongbow = Boolean(node &&
      world.units.some((unit) =>
        unit.alive && unit.faction === Faction.Compact && unit.kind === 'longbow' &&
        unit.ability?.id === 'siegeMode' && unit.ability.active && unit.ability.transitionTimer === 0 &&
        surfaceDist(unit.s, unit.z, node.s, node.z) <= 1_300 && deltaS(unit.s, artillery.s) < 0));
  }
  milestones.favorableLongbow ||= milestones.artilleryDestroyed;
  mark(3, milestones.favorableLongbow);
  mark(4, milestones.artilleryDestroyed);

  milestones.strongpointDestroyed ||= bindings.strongpointIds.every((id) => !world.structureById(id));
  mark(5, milestones.strongpointDestroyed);
  if (objectiveIndex === 6 && milestones.strongpointDestroyed) {
    if (node?.faction === Faction.Compact) {
      if (milestones.lastHoldWorldTick < 0) {
        milestones.holdTicks++;
      } else if (world.tick > milestones.lastHoldWorldTick) {
        milestones.holdTicks += world.tick - milestones.lastHoldWorldTick;
      }
    } else {
      milestones.holdTicks = 0;
    }
    milestones.lastHoldWorldTick = world.tick;
  }
  mark(6, milestones.holdTicks >= BREAK_LINE_HOLD_TICKS);
  return null;
}

export function breakLineObjectiveMet(milestones: BreakLineMilestones, objectiveIndex: number): boolean {
  switch (BREAK_LINE_OBJECTIVES[objectiveIndex]?.id) {
    case 'hold-salvage-line': return milestones.raidersDefeated && milestones.extractorSurvived;
    case 'scout-forward-line': return milestones.scoutedArtillery;
    case 'secure-forward-node': return milestones.capturedForwardNode;
    case 'establish-high-ground': return milestones.favorableLongbow;
    case 'silence-artillery': return milestones.artilleryDestroyed;
    case 'break-strongpoint': return milestones.strongpointDestroyed;
    case 'hold-forward-line': return milestones.holdTicks >= BREAK_LINE_HOLD_TICKS;
    default: return false;
  }
}
