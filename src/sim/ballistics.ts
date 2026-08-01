/**
 * Ballistics in the rotating ring frame.
 *
 * THE TRICK: we do not integrate centrifugal and Coriolis accelerations
 * directly. Those forces are fictitious -- artefacts of describing motion in a
 * spinning frame. In the INERTIAL frame an unpowered projectile simply travels
 * in a straight line. So we:
 *
 *     1. convert the launch state from ring space into the inertial frame,
 *     2. move in a straight line (plus air drag against the co-rotating air),
 *     3. convert back to ring space for collision, rendering and gameplay.
 *
 * This is exact rather than approximate, needs no numerical integration in the
 * drag-free case, cannot go unstable, and makes the aim solver tractable. All
 * the dramatic banana-arcs the player sees are a consequence of step 3 alone.
 *
 * WHAT THIS MEANS FOR GAMEPLAY
 * The floor moves at ~147 m/s in the inertial frame, which is the same order as
 * artillery muzzle velocity. Consequently:
 *
 *   - Firing ANTISPINWARD subtracts from your inertial speed, so the shell is
 *     "slower" around the ring, the floor rushes up to meet it later, and the
 *     range is LONG.
 *   - Firing SPINWARD adds to it, apparent gravity roughly doubles, and the
 *     range is SHORT.
 *   - Fire antispinward hard enough and the shell is nearly stationary in the
 *     inertial frame: it hangs while the world rotates underneath it.
 *
 * So where you stand relative to your target changes what your artillery can
 * do. That asymmetry is a core strategic mechanic, not a bug to be smoothed
 * away, and the trajectory preview exists to make it legible.
 */

import {
  ATMOSPHERE_HEIGHT,
  RING_OMEGA,
  RING_RADIUS,
} from '@core/constants';
import { deltaS, wrapS } from '@core/ringMath';

/**
 * Inertial-frame projectile state.
 * (X, Y) lie in the ring's cross-section plane; Z is along the ring axis.
 */
export interface BallisticState {
  X: number;
  Y: number;
  Z: number;
  VX: number;
  VY: number;
  VZ: number;
  /** Absolute simulation time, needed to know how far the ring has turned. */
  t: number;
}

/** A point expressed in ring space. */
export interface RingPoint {
  /** Arc length around the ring, metres. */
  s: number;
  /** Height above the floor, metres. */
  h: number;
  /** Axial position, metres. */
  z: number;
}

/** Ring-frame velocity: tangential (spinward +), vertical (up +), axial. */
export interface RingVelocity {
  vt: number;
  vh: number;
  vz: number;
}

// ---------------------------------------------------------------------------
// Frame conversion
// ---------------------------------------------------------------------------

/**
 * Build an inertial state from a ring-space launch.
 *
 * The ring frame is rotating, so the inertial velocity is the ring-frame
 * velocity plus the local floor velocity (omega x r).
 */
export function launchToInertial(
  p: RingPoint,
  v: RingVelocity,
  t: number,
  out: BallisticState = { X: 0, Y: 0, Z: 0, VX: 0, VY: 0, VZ: 0, t: 0 },
): BallisticState {
  const r = RING_RADIUS - p.h;
  const thetaI = p.s / RING_RADIUS + RING_OMEGA * t;
  const c = Math.cos(thetaI);
  const sn = Math.sin(thetaI);

  // Radial unit vector (outward) and tangential unit vector (spinward).
  // Outward is "down" for an inhabitant, so vh (up) contributes -radially.
  const vRadial = -v.vh;
  const vTangential = v.vt + RING_OMEGA * r;

  out.X = r * c;
  out.Y = r * sn;
  out.Z = p.z;
  out.VX = vRadial * c - vTangential * sn;
  out.VY = vRadial * sn + vTangential * c;
  out.VZ = v.vz;
  out.t = t;
  return out;
}

/** Recover the ring-space position of an inertial state at its current time. */
export function inertialToRing(st: BallisticState, out: RingPoint): RingPoint {
  const r = Math.hypot(st.X, st.Y);
  const thetaI = Math.atan2(st.Y, st.X);
  const theta = thetaI - RING_OMEGA * st.t;
  out.s = wrapS(theta * RING_RADIUS);
  out.h = RING_RADIUS - r;
  out.z = st.Z;
  return out;
}

/** Recover the ring-frame (co-rotating) velocity of an inertial state. */
export function inertialToRingVelocity(st: BallisticState, out: RingVelocity): RingVelocity {
  const r = Math.hypot(st.X, st.Y) || 1e-9;
  const c = st.X / r;
  const sn = st.Y / r;
  const vRadial = st.VX * c + st.VY * sn;
  const vTangential = -st.VX * sn + st.VY * c;
  out.vh = -vRadial;
  out.vt = vTangential - RING_OMEGA * r;
  out.vz = st.VZ;
  return out;
}

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

/**
 * Advance a drag-free projectile by dt. Exact: straight line in the inertial
 * frame. The visible curvature comes entirely from the frame conversion.
 */
export function stepFree(st: BallisticState, dt: number): void {
  st.X += st.VX * dt;
  st.Y += st.VY * dt;
  st.Z += st.VZ * dt;
  st.t += dt;
}

/**
 * Drag coefficient profile. Air co-rotates with the ring, so drag acts on the
 * RING-frame velocity, not the inertial one. Density falls off with height and
 * reaches zero at the top of the atmosphere shell, which is what lets heavy
 * "chord" munitions coast across the interior of the ring unimpeded.
 */
function airDensityAt(h: number): number {
  if (h <= 0) return 1;
  if (h >= ATMOSPHERE_HEIGHT) return 0;
  const x = 1 - h / ATMOSPHERE_HEIGHT;
  return x * x;
}

/**
 * Advance a projectile by dt including drag. Uses midpoint integration, which
 * is plenty for a term this small and keeps the cost predictable.
 *
 * @param ballisticCoefficient larger = less affected by drag.
 */
export function stepWithDrag(
  st: BallisticState,
  dt: number,
  ballisticCoefficient: number,
): void {
  if (ballisticCoefficient <= 0) {
    stepFree(st, dt);
    return;
  }

  const r = Math.hypot(st.X, st.Y) || 1e-9;
  const h = RING_RADIUS - r;
  const density = airDensityAt(h);
  if (density <= 0) {
    stepFree(st, dt);
    return;
  }

  // Velocity of the co-rotating air at this point, in the inertial frame.
  const airVX = -RING_OMEGA * st.Y;
  const airVY = RING_OMEGA * st.X;

  const rvx = st.VX - airVX;
  const rvy = st.VY - airVY;
  const rvz = st.VZ;
  const speed = Math.hypot(rvx, rvy, rvz);
  if (speed < 1e-6) {
    stepFree(st, dt);
    return;
  }

  const k = (density * speed) / ballisticCoefficient;
  const ax = -k * rvx;
  const ay = -k * rvy;
  const az = -k * rvz;

  st.X += (st.VX + 0.5 * ax * dt) * dt;
  st.Y += (st.VY + 0.5 * ay * dt) * dt;
  st.Z += (st.VZ + 0.5 * az * dt) * dt;
  st.VX += ax * dt;
  st.VY += ay * dt;
  st.VZ += az * dt;
  st.t += dt;
}

// ---------------------------------------------------------------------------
// Trajectory sampling (shared by the flight code and the preview UI)
// ---------------------------------------------------------------------------

export interface TrajectorySample {
  s: number;
  h: number;
  z: number;
  t: number;
}

export interface TrajectoryOptions {
  /** Seconds of flight to simulate at most. */
  maxTime?: number;
  /** Integration step, seconds. */
  dt?: number;
  /** Larger = less drag. Infinity/0 disables drag. */
  ballisticCoefficient?: number;
  /** Terrain query; return floor height at a surface point. */
  groundAt?: (s: number, z: number) => number;
  /** Stop as soon as the trajectory dips below the ground. */
  stopOnImpact?: boolean;
}

/**
 * Sample a full trajectory. The preview ribbon the player sees and the rocket
 * that actually flies are produced by this same function -- there is
 * deliberately no second implementation that could disagree with the first.
 */
export function sampleTrajectory(
  from: RingPoint,
  v: RingVelocity,
  t0: number,
  opts: TrajectoryOptions = {},
): TrajectorySample[] {
  const maxTime = opts.maxTime ?? 60;
  const dt = opts.dt ?? 1 / 30;
  const bc = opts.ballisticCoefficient ?? 0;
  const groundAt = opts.groundAt;
  const stopOnImpact = opts.stopOnImpact ?? true;

  const st = launchToInertial(from, v, t0);
  const pt: RingPoint = { s: 0, h: 0, z: 0 };
  const out: TrajectorySample[] = [{ s: from.s, h: from.h, z: from.z, t: 0 }];

  const steps = Math.ceil(maxTime / dt);
  for (let i = 0; i < steps; i++) {
    if (bc > 0) stepWithDrag(st, dt, bc);
    else stepFree(st, dt);

    inertialToRing(st, pt);
    const floor = groundAt ? groundAt(pt.s, pt.z) : 0;

    out.push({ s: pt.s, h: pt.h, z: pt.z, t: st.t - t0 });

    if (stopOnImpact && pt.h <= floor && i > 1) break;
    // A shot that reaches the far side of the ring has left the playfield.
    if (pt.h > RING_RADIUS * 1.98) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aim solving
// ---------------------------------------------------------------------------

export interface AimSolution {
  /** Ring-frame launch velocity to use. */
  velocity: RingVelocity;
  /** Predicted time of flight, seconds. */
  flightTime: number;
  /** Ring-frame launch speed. */
  speed: number;
  /** Elevation angle above the local horizon, radians. Diagnostic. */
  elevation: number;
}

/**
 * Inertial position of a fixed ring-space point at absolute time t.
 * A stationary target still moves in the inertial frame, because the world
 * it is standing on is turning.
 */
function targetInertialAt(p: RingPoint, t: number, out: { x: number; y: number; z: number }): void {
  const r = RING_RADIUS - p.h;
  const thetaI = p.s / RING_RADIUS + RING_OMEGA * t;
  out.x = r * Math.cos(thetaI);
  out.y = r * Math.sin(thetaI);
  out.z = p.z;
}

const _tgt = { x: 0, y: 0, z: 0 };

/**
 * The ring-frame launch speed required to hit `to` from `from` in exactly
 * `flightTime` seconds, ignoring drag.
 *
 * Because motion is a straight line in the inertial frame, the required
 * inertial velocity is just displacement / time -- no root finding needed at
 * this level. All the difficulty is pushed into choosing the flight time.
 */
export function requiredLaunch(
  from: RingPoint,
  to: RingPoint,
  t0: number,
  flightTime: number,
  out: RingVelocity,
): number {
  const r0 = RING_RADIUS - from.h;
  const theta0 = from.s / RING_RADIUS + RING_OMEGA * t0;
  const x0 = r0 * Math.cos(theta0);
  const y0 = r0 * Math.sin(theta0);

  targetInertialAt(to, t0 + flightTime, _tgt);

  const VX = (_tgt.x - x0) / flightTime;
  const VY = (_tgt.y - y0) / flightTime;
  const VZ = (_tgt.z - from.z) / flightTime;

  // Convert that inertial velocity back into the rotating frame.
  const c = Math.cos(theta0);
  const sn = Math.sin(theta0);
  const vRadial = VX * c + VY * sn;
  const vTangential = -VX * sn + VY * c;

  out.vh = -vRadial;
  out.vt = vTangential - RING_OMEGA * r0;
  out.vz = VZ;
  return Math.hypot(out.vt, out.vh, out.vz);
}

export interface AimOptions {
  /** Desired ring-frame launch speed. */
  speed: number;
  /** Prefer the high arc (lob) rather than the flat one. */
  lofted?: boolean;
  /** Longest flight time to consider, seconds. */
  maxFlightTime?: number;
  /** Reject solutions whose arc clips terrain. */
  groundAt?: (s: number, z: number) => number;
  ballisticCoefficient?: number;
}

/**
 * Find a launch velocity that hits the target at the given launch speed.
 *
 * Method: `requiredLaunch` gives the speed needed for any candidate flight
 * time, so we sweep flight time, look for sign changes against the desired
 * speed, and bisect. Typically two roots exist -- a flat, fast shot and a
 * lofted, slow one -- exactly as with ordinary artillery. On this ring many
 * spinward shots have NO root at a given speed, which is the range asymmetry
 * showing up honestly in the maths.
 *
 * Returns null when the target cannot be reached.
 */
export function solveAim(
  from: RingPoint,
  to: RingPoint,
  t0: number,
  opts: AimOptions,
): AimSolution | null {
  if ((opts.ballisticCoefficient ?? 0) > 0 && opts.groundAt) {
    return solveDragAim(from, to, t0, opts);
  }
  const maxT = opts.maxFlightTime ?? 45;
  const samples = 96;
  const v: RingVelocity = { vt: 0, vh: 0, vz: 0 };

  let prevT = 0.25;
  let prevErr = requiredLaunch(from, to, t0, prevT, v) - opts.speed;

  const roots: number[] = [];
  for (let i = 1; i <= samples; i++) {
    const T = 0.25 + (maxT - 0.25) * (i / samples);
    const err = requiredLaunch(from, to, t0, T, v) - opts.speed;
    if (prevErr === 0) roots.push(prevT);
    else if ((prevErr < 0) !== (err < 0)) {
      // Bisect into the bracket.
      let lo = prevT;
      let hi = T;
      let loErr = prevErr;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) * 0.5;
        const midErr = requiredLaunch(from, to, t0, mid, v) - opts.speed;
        if ((loErr < 0) !== (midErr < 0)) {
          hi = mid;
        } else {
          lo = mid;
          loErr = midErr;
        }
      }
      roots.push((lo + hi) * 0.5);
    }
    prevT = T;
    prevErr = err;
  }

  if (roots.length === 0) return null;

  // Shorter flight time = flatter shot; longer = lofted.
  roots.sort((a, b) => a - b);
  const ordered = opts.lofted ? roots.slice().reverse() : roots;

  for (const T of ordered) {
    const speed = requiredLaunch(from, to, t0, T, v);
    const sol: AimSolution = {
      velocity: { vt: v.vt, vh: v.vh, vz: v.vz },
      flightTime: T,
      speed,
      elevation: Math.atan2(v.vh, Math.hypot(v.vt, v.vz)),
    };

    // Reject shots that burrow into the ground on the way.
    if (opts.groundAt) {
      const path = sampleTrajectory(from, sol.velocity, t0, {
        maxTime: T * 0.97,
        dt: Math.max(1 / 30, T / 80),
        ballisticCoefficient: opts.ballisticCoefficient ?? 0,
        groundAt: opts.groundAt,
        stopOnImpact: false,
      });
      let blocked = false;
      for (let i = 3; i < path.length; i++) {
        const p = path[i]!;
        if (p.h < opts.groundAt(p.s, p.z) - 1) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
    }
    return sol;
  }
  return null;
}

function solveDragAim(from: RingPoint, to: RingPoint, t0: number, opts: AimOptions): AimSolution | null {
  const azimuth = Math.atan2(to.z - from.z, deltaS(from.s, to.s));
  const elevations = Array.from({ length: 18 }, (_, index) => 0.08 + index * 0.075);
  if (opts.lofted) elevations.reverse();
  for (const elevation of elevations) {
    const horizontal = Math.cos(elevation) * opts.speed;
    const initial: AimSolution = {
      velocity: {
        vt: Math.cos(azimuth) * horizontal,
        vh: Math.sin(elevation) * opts.speed,
        vz: Math.sin(azimuth) * horizontal,
      },
      flightTime: opts.maxFlightTime ?? 60,
      speed: opts.speed,
      elevation,
    };
    const refined = refineDragSolution(from, to, t0, initial, opts);
    if (refined) return refined;
  }
  return null;
}

function refineDragSolution(
  from: RingPoint,
  to: RingPoint,
  t0: number,
  initial: AimSolution,
  opts: AimOptions,
): AimSolution | null {
  const groundAt = opts.groundAt!;
  const coefficient = opts.ballisticCoefficient!;
  const speed = opts.speed;
  let azimuth = Math.atan2(initial.velocity.vz, initial.velocity.vt);
  let elevation = initial.elevation;

  const evaluate = (az: number, el: number): { es: number; ez: number; time: number; velocity: RingVelocity } => {
    const horizontal = Math.cos(el) * speed;
    const velocity = {
      vt: Math.cos(az) * horizontal,
      vh: Math.sin(el) * speed,
      vz: Math.sin(az) * horizontal,
    };
    const path = sampleTrajectory(from, velocity, t0, {
      maxTime: opts.maxFlightTime ?? 60,
      dt: 1 / 30,
      ballisticCoefficient: coefficient,
      groundAt,
      stopOnImpact: true,
    });
    const impact = path[path.length - 1]!;
    return {
      es: deltaS(to.s, impact.s),
      ez: impact.z - to.z,
      time: impact.t,
      velocity,
    };
  };

  for (let iteration = 0; iteration < 10; iteration++) {
    const base = evaluate(azimuth, elevation);
    if (Math.hypot(base.es, base.ez) < 2) {
      return {
        velocity: base.velocity,
        flightTime: base.time,
        speed,
        elevation,
      };
    }

    const epsilon = 0.002;
    const byAzimuth = evaluate(azimuth + epsilon, elevation);
    const byElevation = evaluate(azimuth, elevation + epsilon);
    const a = (byAzimuth.es - base.es) / epsilon;
    const b = (byElevation.es - base.es) / epsilon;
    const c = (byAzimuth.ez - base.ez) / epsilon;
    const d = (byElevation.ez - base.ez) / epsilon;
    const determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-5) return null;

    const deltaAzimuth = (-base.es * d + b * base.ez) / determinant;
    const deltaElevation = (c * base.es - a * base.ez) / determinant;
    azimuth += clamp(deltaAzimuth, -0.16, 0.16);
    elevation = clamp(elevation + clamp(deltaElevation, -0.12, 0.12), 0.03, Math.PI * 0.49);
  }

  const final = evaluate(azimuth, elevation);
  if (Math.hypot(final.es, final.ez) >= 4) return null;
  return { velocity: final.velocity, flightTime: final.time, speed, elevation };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Maximum reachable range in a given direction, found by expanding search.
 * Used by the AI and by the HUD's range overlay, which has to show a lopsided
 * footprint rather than the usual circle.
 */
export function maxRangeInDirection(
  from: RingPoint,
  spinwardSign: number,
  speed: number,
  groundAt?: (s: number, z: number) => number,
): number {
  let lo = 0;
  let hi = 8000;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5;
    const to: RingPoint = {
      s: wrapS(from.s + spinwardSign * mid),
      h: groundAt ? groundAt(wrapS(from.s + spinwardSign * mid), from.z) : 0,
      z: from.z,
    };
    const sol = solveAim(from, to, 0, { speed, lofted: true, groundAt });
    if (sol) lo = mid;
    else hi = mid;
  }
  return lo;
}
