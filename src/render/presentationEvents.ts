import { RING_CIRCUMFERENCE } from '@core/constants';
import { deltaS } from '@core/ringMath';
import type { Faction } from '@sim/data';
import type { SimEvent, World } from '@sim/world';

const PRESENTATION_ARC_RANGE = RING_CIRCUMFERENCE * 0.3;

export type CombatPresentationKind = SimEvent['kind'] | 'chordLaunch' | 'chordImpact';

export function combatPresentationKind(event: SimEvent): CombatPresentationKind {
  if (event.weapon === 'chordShot') {
    if (event.kind === 'weaponFired') return 'chordLaunch';
    if (event.kind === 'impact') return 'chordImpact';
  }
  return event.kind;
}

/** Shared fog-of-war boundary for every sensory presentation of a sim event. */
export function isPresentationEventEligible(
  event: SimEvent,
  world: World,
  anchorS: number,
  viewer: Faction,
): boolean {
  const deepShadowLaunch = event.kind === 'weaponFired'
    && event.faction !== viewer
    && event.faction >= 0
    && world.shadowTimingAt(event.s).state === 'shadow';
  return deepShadowLaunch || (
    isPresentationEventInRange(event, anchorS) && isPresentationEventVisible(event, world, viewer)
  );
}

export function isPresentationEventInRange(event: SimEvent, anchorS: number): boolean {
  return Math.abs(deltaS(anchorS, event.s)) < PRESENTATION_ARC_RANGE;
}

export function isPresentationEventVisible(event: SimEvent, world: World, viewer: Faction): boolean {
  if (event.faction < 0 || event.faction === viewer) return true;
  if ((event.kind === 'alignmentStarted' || event.kind === 'alignmentBroken') && event.pairId) {
    const pair = world.spinalPairs.find((candidate) => candidate.id === event.pairId);
    return Boolean(pair && pair.members.every((id) => world.isEntityVisible(viewer, id)));
  }
  return world.isEntityVisible(viewer, event.id) || world.isVisible(viewer, event.s, event.z);
}
