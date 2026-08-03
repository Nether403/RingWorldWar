import { RING_CIRCUMFERENCE } from '@core/constants';
import { deltaS } from '@core/ringMath';
import type { Faction } from '@sim/data';
import type { SimEvent, World } from '@sim/world';

const PRESENTATION_ARC_RANGE = RING_CIRCUMFERENCE * 0.3;

/** Shared fog-of-war boundary for every sensory presentation of a sim event. */
export function isPresentationEventEligible(
  event: SimEvent,
  world: World,
  anchorS: number,
  viewer: Faction,
): boolean {
  return isPresentationEventInRange(event, anchorS) && isPresentationEventVisible(event, world, viewer);
}

export function isPresentationEventInRange(event: SimEvent, anchorS: number): boolean {
  return Math.abs(deltaS(anchorS, event.s)) < PRESENTATION_ARC_RANGE;
}

export function isPresentationEventVisible(event: SimEvent, world: World, viewer: Faction): boolean {
  if (event.faction < 0 || event.faction === viewer) return true;
  return world.isEntityVisible(viewer, event.id) || world.isVisible(viewer, event.s, event.z);
}
