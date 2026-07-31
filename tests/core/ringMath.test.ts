import { describe, expect, it } from 'vitest';
import { RING_CIRCUMFERENCE, RING_RADIUS } from '@core/constants';
import {
  deltaS,
  renderToRing,
  ringToRender,
  surfaceDist,
  tangentAt,
  upAt,
  wrapS,
  type Vec3Out,
} from '@core/ringMath';

const v = (): Vec3Out => ({ x: 0, y: 0, z: 0 });
const C = RING_CIRCUMFERENCE;

describe('wrapping', () => {
  it('wraps arc length into [0, C)', () => {
    expect(wrapS(0)).toBeCloseTo(0);
    expect(wrapS(C)).toBeCloseTo(0);
    expect(wrapS(C + 100)).toBeCloseTo(100);
    expect(wrapS(-100)).toBeCloseTo(C - 100);
    expect(wrapS(-C - 100)).toBeCloseTo(C - 100);
  });

  it('takes the short way around', () => {
    expect(deltaS(0, 100)).toBeCloseTo(100);
    expect(deltaS(100, 0)).toBeCloseTo(-100);
    // Crossing the seam must behave exactly like anywhere else.
    expect(deltaS(C - 50, 50)).toBeCloseTo(100);
    expect(deltaS(50, C - 50)).toBeCloseTo(-100);
  });

  it('never returns more than half the circumference', () => {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * C;
      for (let j = 0; j < 64; j++) {
        const b = (j / 64) * C;
        expect(Math.abs(deltaS(a, b))).toBeLessThanOrEqual(C / 2 + 1e-6);
      }
    }
  });

  it('measures distance identically across the seam', () => {
    const inner = surfaceDist(1000, 0, 1300, 400);
    const acrossSeam = surfaceDist(C - 150, 0, 150, 400);
    expect(acrossSeam).toBeCloseTo(inner, 6);
  });
});

describe('ring -> render projection', () => {
  it('places the anchor at the origin', () => {
    const p = ringToRender(1234, 0, 567, 1234, 567, v());
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(0);
  });

  it('maps height to +y', () => {
    const p = ringToRender(0, 50, 0, 0, 0, v());
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(50);
  });

  it('curves distant ground upward into the sky', () => {
    // 400 m along the floor should be very slightly raised...
    const near = ringToRender(400, 0, 0, 0, 0, v());
    expect(near.x).toBeGreaterThan(390);
    expect(near.y).toBeGreaterThan(0);
    expect(near.y).toBeLessThan(30);

    // ...and further away, dramatically so.
    const far = ringToRender(C / 8, 0, 0, 0, 0, v());
    expect(far.y).toBeGreaterThan(200);
  });

  it('puts the far side of the ring directly overhead', () => {
    const antipode = ringToRender(C / 2, 0, 0, 0, 0, v());
    expect(antipode.x).toBeCloseTo(0, 6);
    expect(antipode.y).toBeCloseTo(2 * RING_RADIUS, 6);
  });

  it('round-trips through renderToRing', () => {
    for (const s of [0, 500, C / 4, C / 2, C - 10]) {
      for (const h of [0, 20, 900]) {
        const p = ringToRender(s, h, 300, 100, -50, v());
        const back = renderToRing(p.x, p.y, p.z, 100, -50);
        expect(back.h).toBeCloseTo(h, 5);
        expect(back.z).toBeCloseTo(300, 5);
        expect(Math.abs(deltaS(back.s, s))).toBeLessThan(1e-5);
      }
    }
  });
});

describe('local frame', () => {
  it('is orthonormal everywhere', () => {
    for (let i = 0; i < 16; i++) {
      const s = (i / 16) * C;
      const u = upAt(s, 0, v());
      const t = tangentAt(s, 0, v());
      expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1);
      expect(Math.hypot(t.x, t.y, t.z)).toBeCloseTo(1);
      expect(u.x * t.x + u.y * t.y + u.z * t.z).toBeCloseTo(0, 9);
    }
  });

  it('points up and spinward at the anchor', () => {
    const u = upAt(0, 0, v());
    expect(u.y).toBeCloseTo(1);
    const t = tangentAt(0, 0, v());
    expect(t.x).toBeCloseTo(1);
  });

  it('is inverted on the far side, as it must be', () => {
    const u = upAt(C / 2, 0, v());
    expect(u.y).toBeCloseTo(-1);
  });
});
