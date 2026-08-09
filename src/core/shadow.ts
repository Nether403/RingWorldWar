import {
  DAY_LENGTH,
  RING_CIRCUMFERENCE,
  SHADOW_SQUARE_COUNT,
} from './constants';

export const SHADOW_PANEL_HALF_SPAN = 0.19;
export const SHADOW_MAX_OCCLUSION = 0.72;
export const SHADOW_PANEL_SPACING = (Math.PI * 2) / SHADOW_SQUARE_COUNT;
export const SHADOW_PANEL_PHASE_OFFSET = SHADOW_PANEL_SPACING * 0.5;

const SHADOW_PATTERN_SPEED = SHADOW_PANEL_SPACING / DAY_LENGTH;
const TRANSITION_BOUNDARIES = [
  SHADOW_PANEL_HALF_SPAN * 0.5,
  SHADOW_PANEL_HALF_SPAN,
  SHADOW_PANEL_SPACING - SHADOW_PANEL_HALF_SPAN,
  SHADOW_PANEL_SPACING - SHADOW_PANEL_HALF_SPAN * 0.5,
] as const;

export type ShadowState = 'day' | 'transition' | 'shadow';

export interface ShadowTiming {
  daylight: number;
  state: ShadowState;
  nextState: ShadowState;
  secondsToTransition: number;
}

export function panelPhaseAt(time: number): number {
  return (time / (DAY_LENGTH * SHADOW_SQUARE_COUNT)) * Math.PI * 2 + SHADOW_PANEL_PHASE_OFFSET;
}

export function shadowFactorAtAngle(theta: number, time: number): number {
  const distance = distanceToPanelCenter(relativePanelAngle(theta, time));
  const occluded = 1 - smoothstep(
    SHADOW_PANEL_HALF_SPAN * 0.5,
    SHADOW_PANEL_HALF_SPAN,
    distance,
  );
  return clamp01(1 - occluded * SHADOW_MAX_OCCLUSION);
}

export function shadowTimingAtSurface(s: number, time: number): ShadowTiming {
  const theta = (s / RING_CIRCUMFERENCE) * Math.PI * 2;
  const relative = relativePanelAngle(theta, time);
  const state = shadowStateAtRelativeAngle(relative);
  let nextBoundary = -Infinity;
  for (const boundary of TRANSITION_BOUNDARIES) {
    if (boundary < relative - 1e-12) nextBoundary = Math.max(nextBoundary, boundary);
  }
  if (!Number.isFinite(nextBoundary)) nextBoundary = TRANSITION_BOUNDARIES.at(-1)! - SHADOW_PANEL_SPACING;
  const angularDistance = relative - nextBoundary;
  return {
    daylight: shadowFactorAtAngle(theta, time),
    state,
    nextState: shadowStateAtRelativeAngle(normalizePanelAngle(nextBoundary - 1e-9)),
    secondsToTransition: angularDistance / SHADOW_PATTERN_SPEED,
  };
}

function relativePanelAngle(theta: number, time: number): number {
  return normalizePanelAngle(theta - panelPhaseAt(time));
}

function normalizePanelAngle(angle: number): number {
  const normalized = angle % SHADOW_PANEL_SPACING;
  return normalized < 0 ? normalized + SHADOW_PANEL_SPACING : normalized;
}

function distanceToPanelCenter(relative: number): number {
  return Math.min(relative, SHADOW_PANEL_SPACING - relative);
}

function shadowStateAtRelativeAngle(relative: number): ShadowState {
  const core = SHADOW_PANEL_HALF_SPAN * 0.5;
  const epsilon = 1e-12;
  if (relative <= core + epsilon || relative > SHADOW_PANEL_SPACING - core + epsilon) return 'shadow';
  if (
    relative <= SHADOW_PANEL_HALF_SPAN + epsilon
    || relative > SHADOW_PANEL_SPACING - SHADOW_PANEL_HALF_SPAN + epsilon
  ) {
    return 'transition';
  }
  return 'day';
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
