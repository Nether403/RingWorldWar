/**
 * Ring coordinate math.
 *
 * THREE COORDINATE SYSTEMS, AND WHY:
 *
 * 1. RING SPACE (theta, h, z) -- the canonical description of a point.
 *      theta : angle around the ring, radians, wrapped to [0, 2pi)
 *      h     : height above the floor, metres (up = toward the axis)
 *      z     : axial position across the ring's width, metres
 *
 * 2. SURFACE SPACE (s, z) -- the gameplay plane. s = R * theta is arc length,
 *    and it wraps at the circumference. Over the scale of a battle the floor is
 *    locally flat, so pathfinding, collision, targeting and building placement
 *    are all plain 2D maths on a cylinder-wrapped plane. This is the single
 *    biggest simplification in the codebase: the ring is only exotic where it
 *    has to be.
 *
 * 3. RENDER SPACE (x, y, z) -- a local tangent frame around a floating anchor,
 *    so Three.js never sees a coordinate large enough to lose float32 precision.
 *      +x = spinward, +y = up (toward the axis), +z = axial
 *
 * The ring->render transform is EXACT, not a small-angle approximation, which
 * is what makes the far side of the world render correctly directly overhead
 * instead of drifting out of place.
 */

import {
  RING_CIRCUMFERENCE,
  RING_HALF_WIDTH,
  RING_OMEGA,
  RING_RADIUS,
  SURFACE_GRAVITY,
} from './constants';

export const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Wrapping
// ---------------------------------------------------------------------------

/** Wrap an angle into [0, 2pi). */
export function wrapAngle(theta: number): number {
  const t = theta % TAU;
  return t < 0 ? t + TAU : t;
}

/** Wrap an arc-length coordinate into [0, circumference). */
export function wrapS(s: number): number {
  const c = RING_CIRCUMFERENCE;
  const v = s % c;
  return v < 0 ? v + c : v;
}

/**
 * Shortest signed angular delta from a to b, in (-pi, pi].
 * Positive means b is spinward of a.
 */
export function deltaAngle(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/**
 * Shortest signed arc-length delta from a to b, in (-C/2, C/2].
 *
 * Every distance, direction and targeting calculation in the game goes through
 * this. Forgetting it is what makes a unit walk the long way around the world.
 */
export function deltaS(a: number, b: number): number {
  const c = RING_CIRCUMFERENCE;
  const half = c * 0.5;
  let d = (b - a) % c;
  if (d > half) d -= c;
  else if (d <= -half) d += c;
  return d;
}

/** Squared distance between two surface points, respecting the wrap. */
export function surfaceDistSq(s1: number, z1: number, s2: number, z2: number): number {
  const ds = deltaS(s1, s2);
  const dz = z2 - z1;
  return ds * ds + dz * dz;
}

/** Distance between two surface points, respecting the wrap. */
export function surfaceDist(s1: number, z1: number, s2: number, z2: number): number {
  return Math.sqrt(surfaceDistSq(s1, z1, s2, z2));
}

/** Clamp an axial coordinate to the habitable band. */
export function clampZ(z: number): number {
  return z < -RING_HALF_WIDTH ? -RING_HALF_WIDTH : z > RING_HALF_WIDTH ? RING_HALF_WIDTH : z;
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/** Arc length -> angle. */
export function sToTheta(s: number): number {
  return s / RING_RADIUS;
}

/** Angle -> arc length. */
export function thetaToS(theta: number): number {
  return theta * RING_RADIUS;
}

/** Radial distance from the ring axis for a given height above the floor. */
export function radiusAt(h: number): number {
  return RING_RADIUS - h;
}

// ---------------------------------------------------------------------------
// Render-space projection
// ---------------------------------------------------------------------------

export interface Vec3Out {
  x: number;
  y: number;
  z: number;
}

/**
 * Project a ring-space point into the render frame anchored at (anchorS, anchorZ).
 *
 * Derivation: work in the 2D cross-section plane of the ring. Let dTheta be the
 * angular offset from the anchor and r = R - h the radial distance from the axis.
 * Relative to the anchor's floor point:
 *
 *     x = r * sin(dTheta)          (spinward)
 *     y = R - r * cos(dTheta)      (up, toward the axis)
 *
 * Sanity checks that fall out of this:
 *   - dTheta = 0, h = 0   -> (0, 0)          the anchor itself
 *   - dTheta = 0, h = 50  -> (0, 50)         50 m up
 *   - small dTheta, h = 0 -> x ~ arc length, y ~ R*dTheta^2/2
 *       i.e. distant ground rises INTO THE SKY. This is the whole visual
 *       identity of the game, and it is pure geometry, not a shader trick.
 *   - dTheta = pi, h = 0  -> (0, 2R)         the far side, directly overhead
 */
export function ringToRender(
  s: number,
  h: number,
  z: number,
  anchorS: number,
  anchorZ: number,
  out: Vec3Out,
): Vec3Out {
  const dTheta = deltaS(anchorS, s) / RING_RADIUS;
  const r = RING_RADIUS - h;
  out.x = r * Math.sin(dTheta);
  out.y = RING_RADIUS - r * Math.cos(dTheta);
  out.z = z - anchorZ;
  return out;
}

/**
 * Inverse of ringToRender: render frame -> ring space.
 * Returns { s, h, z }. Used for picking (turning a ray hit back into a command).
 */
export function renderToRing(
  x: number,
  y: number,
  z: number,
  anchorS: number,
  anchorZ: number,
): { s: number; h: number; z: number } {
  // The ring axis sits at render-space (0, R, *).
  const dy = RING_RADIUS - y;
  const r = Math.hypot(x, dy);
  const dTheta = Math.atan2(x, dy);
  return {
    s: wrapS(anchorS + dTheta * RING_RADIUS),
    h: RING_RADIUS - r,
    z: z + anchorZ,
  };
}

/**
 * Local "up" (toward the ring axis) in render space, for a point at arc offset
 * `s` from the anchor. Unit length.
 */
export function upAt(s: number, anchorS: number, out: Vec3Out): Vec3Out {
  const dTheta = deltaS(anchorS, s) / RING_RADIUS;
  out.x = -Math.sin(dTheta);
  out.y = Math.cos(dTheta);
  out.z = 0;
  return out;
}

/** Local spinward tangent in render space. Unit length. */
export function tangentAt(s: number, anchorS: number, out: Vec3Out): Vec3Out {
  const dTheta = deltaS(anchorS, s) / RING_RADIUS;
  out.x = Math.cos(dTheta);
  out.y = Math.sin(dTheta);
  out.z = 0;
  return out;
}

// ---------------------------------------------------------------------------
// Rotating-frame physics
// ---------------------------------------------------------------------------

/**
 * Apparent gravity at height h. Centrifugal acceleration is w^2 * r, so it
 * weakens as you rise toward the axis and vanishes at the centre. High-apex
 * shots therefore hang far longer than flat-world intuition predicts.
 */
export function gravityAt(h: number): number {
  return RING_OMEGA * RING_OMEGA * (RING_RADIUS - h);
}

/**
 * Coriolis acceleration in the rotating frame: a = -2 * w x v.
 *
 * With the ring spinning about the axial (z) direction and the local frame
 * being (x = spinward, y = up), this reduces to:
 *
 *     a_x = +2 * w * v_y
 *     a_y = +2 * w * v_x
 *
 * Consequences, all of which are gameplay:
 *   - Rising projectiles are pushed spinward; falling ones antispinward.
 *   - Travelling spinward adds apparent lift, so spinward shots fly flatter
 *     and much further than identical antispinward shots.
 *   - Drop something from a tower and it lands antispinward of straight down.
 */
export function coriolisX(vy: number): number {
  return 2 * RING_OMEGA * vy;
}

export function coriolisY(vx: number): number {
  return 2 * RING_OMEGA * vx;
}

/**
 * Ratio of Coriolis to gravity for a shot of the given flat-world range.
 * Purely diagnostic -- used by tests and the debug overlay to sanity-check
 * that the world's dimensions still produce interesting-but-aimable arcs.
 */
export function coriolisRatioForRange(range: number): number {
  return 2 * Math.sqrt(range / RING_RADIUS);
}

/** Flat-world reference range for a launch speed at 45 degrees. */
export function nominalRange(launchSpeed: number): number {
  return (launchSpeed * launchSpeed) / SURFACE_GRAVITY;
}
