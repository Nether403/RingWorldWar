import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGradeLut, LUT_SIZE } from '../../src/render/materials/grading';

/**
 * The grade tables are generated rather than shipped as a binary, which
 * `docs/procedural-assets.md` requires. That only holds if generation is
 * reproducible, so determinism is asserted on the bytes rather than assumed.
 */
function bytesOf(kind: 'day' | 'night'): Uint8Array {
  return createGradeLut(kind).image.data as Uint8Array;
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Read one entry out of the horizontal slice strip. */
function sample(data: Uint8Array, red: number, green: number, blue: number): [number, number, number] {
  const width = LUT_SIZE * LUT_SIZE;
  const x = blue * LUT_SIZE + red;
  const offset = (green * width + x) * 4;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!];
}

describe('grade lookup tables', () => {
  it('produces identical bytes for repeated builds', () => {
    expect(digest(bytesOf('day'))).toBe(digest(bytesOf('day')));
    expect(digest(bytesOf('night'))).toBe(digest(bytesOf('night')));
  });

  it('produces different grades for day and night', () => {
    expect(digest(bytesOf('day'))).not.toBe(digest(bytesOf('night')));
  });

  it('is laid out as a full slice strip with opaque alpha', () => {
    const texture = createGradeLut('day');
    expect(texture.image.width).toBe(LUT_SIZE * LUT_SIZE);
    expect(texture.image.height).toBe(LUT_SIZE);
    const data = texture.image.data as Uint8Array;
    expect(data).toHaveLength(LUT_SIZE * LUT_SIZE * LUT_SIZE * 4);
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] !== 255) throw new Error(`alpha not opaque at byte ${index}`);
    }
  });

  it('keeps both grades monotonic along every axis', () => {
    // A non-monotonic table would produce banding and hue inversions on smooth
    // gradients, which is hard to spot in a screenshot and obvious in motion.
    for (const kind of ['day', 'night'] as const) {
      const data = bytesOf(kind);
      for (let step = 1; step < LUT_SIZE; step++) {
        const [previousRed] = sample(data, step - 1, 16, 16);
        const [currentRed] = sample(data, step, 16, 16);
        expect(currentRed, `${kind} red decreased at ${step}`).toBeGreaterThanOrEqual(previousRed);

        const previousGreen = sample(data, 16, step - 1, 16)[1];
        const currentGreen = sample(data, 16, step, 16)[1];
        expect(currentGreen, `${kind} green decreased at ${step}`).toBeGreaterThanOrEqual(previousGreen);

        const previousBlue = sample(data, 16, 16, step - 1)[2];
        const currentBlue = sample(data, 16, 16, step)[2];
        expect(currentBlue, `${kind} blue decreased at ${step}`).toBeGreaterThanOrEqual(previousBlue);
      }
    }
  });

  it('lifts night shadows instead of crushing them', () => {
    // docs/art-direction.md section 2 requires night to stay legible. A night
    // grade that crushed black would hide the terrain and silhouettes the player
    // still has to read, so the floor must sit above the day grade's.
    const day = sample(bytesOf('day'), 0, 0, 0);
    const night = sample(bytesOf('night'), 0, 0, 0);
    const dayFloor = Math.max(...day);
    const nightFloor = Math.max(...night);
    expect(nightFloor).toBeGreaterThan(dayFloor);
    // And it must not lift so far that black becomes grey haze.
    expect(nightFloor).toBeLessThan(48);
  });

  it('makes night cooler and day warmer at the midpoint', () => {
    const day = sample(bytesOf('day'), 16, 16, 16);
    const night = sample(bytesOf('night'), 16, 16, 16);
    // Warm means red above blue; cool means the reverse.
    expect(day[0]).toBeGreaterThan(day[2]);
    expect(night[2]).toBeGreaterThan(night[0]);
  });

  it('keeps white from clipping to a tint in either grade', () => {
    for (const kind of ['day', 'night'] as const) {
      const white = sample(bytesOf(kind), LUT_SIZE - 1, LUT_SIZE - 1, LUT_SIZE - 1);
      // Highlights may be tinted, but not so far that the brightest value in the
      // frame reads as coloured rather than as white.
      expect(Math.max(...white) - Math.min(...white), `${kind} white is tinted`).toBeLessThan(56);
    }
  });
});
