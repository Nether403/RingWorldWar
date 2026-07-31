import { describe, expect, it } from 'vitest';
import {
  RING_CIRCUMFERENCE,
  RING_OMEGA,
  RING_PERIOD,
  RING_RADIUS,
  RING_SURFACE_SPEED,
  SURFACE_GRAVITY,
} from '@core/constants';
import { deltaS } from '@core/ringMath';
import {
  inertialToRing,
  inertialToRingVelocity,
  launchToInertial,
  maxRangeInDirection,
  requiredLaunch,
  sampleTrajectory,
  solveAim,
  stepFree,
  type RingPoint,
  type RingVelocity,
} from '@sim/ballistics';

const origin: RingPoint = { s: 0, h: 2, z: 0 };

/** Fire and report where it lands, relative to the launcher (+ = spinward). */
function shoot(speed: number, elevationDeg: number, spinwardSign: number) {
  const e = (elevationDeg * Math.PI) / 180;
  const v: RingVelocity = {
    vt: spinwardSign * speed * Math.cos(e),
    vh: speed * Math.sin(e),
    vz: 0,
  };
  const path = sampleTrajectory(origin, v, 0, { maxTime: 200, dt: 1 / 60 });
  const last = path[path.length - 1]!;
  return { range: deltaS(origin.s, last.s), time: last.t, apex: Math.max(...path.map((p) => p.h)) };
}

describe('frame conversion', () => {
  it('round-trips a launch state', () => {
    const p: RingPoint = { s: 1234, h: 40, z: -300 };
    const v: RingVelocity = { vt: 60, vh: 95, vz: -12 };
    const st = launchToInertial(p, v, 7.5);

    const backP: RingPoint = { s: 0, h: 0, z: 0 };
    const backV: RingVelocity = { vt: 0, vh: 0, vz: 0 };
    inertialToRing(st, backP);
    inertialToRingVelocity(st, backV);

    expect(backP.h).toBeCloseTo(p.h, 6);
    expect(backP.z).toBeCloseTo(p.z, 6);
    expect(Math.abs(deltaS(backP.s, p.s))).toBeLessThan(1e-6);
    expect(backV.vt).toBeCloseTo(v.vt, 6);
    expect(backV.vh).toBeCloseTo(v.vh, 6);
    expect(backV.vz).toBeCloseTo(v.vz, 6);
  });

  it('does not let a co-rotating object drift around the ring', () => {
    // An object with zero ring-frame velocity is in FREE FALL, not resting on
    // anything -- inertially it flies off on a tangent and sinks below the
    // floor. What must not happen is lateral drift: for the moments before it
    // hits the ground it should stay put in arc length.
    const st = launchToInertial({ s: 500, h: 0, z: 100 }, { vt: 0, vh: 0, vz: 0 }, 0);
    const p: RingPoint = { s: 0, h: 0, z: 0 };
    for (let i = 0; i < 30; i++) stepFree(st, 1 / 60);
    inertialToRing(st, p);
    expect(Math.abs(deltaS(p.s, 500))).toBeLessThan(0.1);
    expect(p.h).toBeLessThan(0);
    expect(p.z).toBeCloseTo(100, 6);
  });
});

describe('rotating-frame effects', () => {
  it('accelerates a dropped object downward at roughly the local gravity', () => {
    const st = launchToInertial({ s: 0, h: 100, z: 0 }, { vt: 0, vh: 0, vz: 0 }, 0);
    const p: RingPoint = { s: 0, h: 0, z: 0 };
    const t = 1.0;
    for (let i = 0; i < 60; i++) stepFree(st, t / 60);
    inertialToRing(st, p);
    const drop = 100 - p.h;
    const expected = 0.5 * SURFACE_GRAVITY * t * t;
    expect(drop).toBeGreaterThan(expected * 0.9);
    expect(drop).toBeLessThan(expected * 1.1);
  });

  it('deflects a dropped object antispinward', () => {
    // The classic rotating-habitat result: released objects lag behind the
    // floor, landing antispinward of the drop point.
    const st = launchToInertial({ s: 0, h: 300, z: 0 }, { vt: 0, vh: 0, vz: 0 }, 0);
    const p: RingPoint = { s: 0, h: 0, z: 0 };
    for (let i = 0; i < 600; i++) stepFree(st, 1 / 60);
    inertialToRing(st, p);
    expect(deltaS(0, p.s)).toBeLessThan(0);
  });

  it('gives antispinward shots far greater range than spinward ones', () => {
    const spin = shoot(90, 45, +1);
    const anti = shoot(90, 45, -1);
    expect(Math.abs(anti.range)).toBeGreaterThan(Math.abs(spin.range) * 1.5);
  });
});

describe('aim solver', () => {
  const cases: Array<[string, number]> = [
    ['antispinward', -1],
    ['spinward', +1],
  ];

  for (const [label, sign] of cases) {
    it(`hits a target ${label} of the launcher`, () => {
      const target: RingPoint = { s: (RING_CIRCUMFERENCE + sign * 700) % RING_CIRCUMFERENCE, h: 0, z: 250 };
      const sol = solveAim(origin, target, 0, { speed: 140, lofted: true });
      expect(sol).not.toBeNull();

      const path = sampleTrajectory(origin, sol!.velocity, 0, { maxTime: 200, dt: 1 / 120 });
      const last = path[path.length - 1]!;
      const miss = Math.hypot(deltaS(last.s, target.s), last.z - target.z);
      expect(miss).toBeLessThan(12);
    });
  }

  it('reports the required speed consistently', () => {
    const target: RingPoint = { s: 900, h: 0, z: 0 };
    const v: RingVelocity = { vt: 0, vh: 0, vz: 0 };
    const speed = requiredLaunch(origin, target, 0, 9, v);
    expect(speed).toBeGreaterThan(0);
    expect(Math.hypot(v.vt, v.vh, v.vz)).toBeCloseTo(speed, 9);
  });

  it('returns null for an unreachable target', () => {
    const target: RingPoint = { s: RING_CIRCUMFERENCE * 0.5, h: 0, z: 0 };
    expect(solveAim(origin, target, 0, { speed: 5, maxFlightTime: 20 })).toBeNull();
  });
});

describe('world dimension sanity', () => {
  it('reports the tuning numbers', () => {
    const rows = [
      ['ring radius', `${RING_RADIUS} m`],
      ['circumference', `${RING_CIRCUMFERENCE.toFixed(0)} m`],
      ['far side overhead', `${(2 * RING_RADIUS).toFixed(0)} m`],
      ['rotation period', `${RING_PERIOD.toFixed(1)} s`],
      ['floor speed (inertial)', `${RING_SURFACE_SPEED.toFixed(1)} m/s`],
      ['omega', `${RING_OMEGA.toFixed(5)} rad/s`],
    ];
    for (const speed of [70, 100, 130, 160, 200]) {
      const spin = maxRangeInDirection(origin, +1, speed);
      const anti = maxRangeInDirection(origin, -1, speed);
      rows.push([
        `max range @ ${speed} m/s`,
        `spinward ${spin.toFixed(0)} m / antispinward ${anti.toFixed(0)} m` +
          `  (x${(anti / Math.max(1, spin)).toFixed(2)})`,
      ]);
    }
    // eslint-disable-next-line no-console
    console.log('\n' + rows.map(([k, v]) => `  ${k.padEnd(24)} ${v}`).join('\n') + '\n');
    expect(rows.length).toBeGreaterThan(0);
  });
});
