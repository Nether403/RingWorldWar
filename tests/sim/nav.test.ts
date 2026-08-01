import { describe, expect, it } from 'vitest';
import { RING_CIRCUMFERENCE } from '@core/constants';
import { surfaceDist, wrapS } from '@core/ringMath';
import type { Terrain } from '@gen/terrain';
import { SurfaceNav } from '@sim/nav';

describe('SurfaceNav', () => {
  it('takes the short route across the ring seam', () => {
    const nav = new SurfaceNav(flatTerrain());
    const direction = nav.directionAt(RING_CIRCUMFERENCE - 80, 0, 80, 0);

    expect(direction.ds).toBeGreaterThan(0);
    expect(Math.abs(direction.dz)).toBeLessThan(0.2);
  });

  it('routes around impassable terrain', () => {
    const blocked = (s: number, z: number): boolean => s > 80 && s < 240 && Math.abs(z) < 120;
    const terrain = flatTerrain(blocked);
    const nav = new SurfaceNav(terrain);
    let s = 0;
    let z = 0;
    let deviation = 0;
    for (let i = 0; i < 80 && surfaceDist(s, z, 320, 0) > 45; i++) {
      const direction = nav.directionAt(s, z, 320, 0);
      s = wrapS(s + direction.ds * 20);
      z += direction.dz * 20;
      deviation = Math.max(deviation, Math.abs(z));
      expect(blocked(s, z)).toBe(false);
    }

    expect(deviation).toBeGreaterThan(120);
    expect(surfaceDist(s, z, 320, 0)).toBeLessThan(50);
  });

  it('does not use direct steering through a narrow nearby ridge', () => {
    const blocked = (s: number, z: number): boolean => s > 30 && s < 55 && Math.abs(z) < 80;
    const nav = new SurfaceNav(flatTerrain(blocked));

    expect(nav.segmentPassable(0, 0, 80, 0)).toBe(false);
    expect(Math.abs(nav.directionAt(0, 0, 80, 0).dz)).toBeGreaterThan(0.2);
    let s = 0;
    let z = 0;
    for (let i = 0; i < 200 && surfaceDist(s, z, 80, 0) > 12; i++) {
      const direction = nav.directionAt(s, z, 80, 0);
      s = wrapS(s + direction.ds * 4);
      z += direction.dz * 4;
      expect(blocked(s, z)).toBe(false);
    }
    expect(surfaceDist(s, z, 80, 0)).toBeLessThan(12);
  });

  it('reuses a field for destinations in the same cell', () => {
    const nav = new SurfaceNav(flatTerrain());
    nav.directionAt(0, 0, 500, 100);
    nav.directionAt(20, 0, 510, 110);

    expect(nav.cachedFieldCount).toBe(1);
  });

  it('does not thrash when more than eight squads have distinct goals', () => {
    const nav = new SurfaceNav(flatTerrain());
    const goals = Array.from({ length: 12 }, (_, index) => 400 + index * 240);
    for (const goal of goals) nav.directionAt(0, 0, goal, 0);
    const builds = nav.fieldBuildCount;
    for (const goal of goals) nav.directionAt(20, 0, goal, 0);

    expect(builds).toBe(12);
    expect(nav.fieldBuildCount).toBe(builds);
  });
});

function flatTerrain(blocked?: (s: number, z: number) => boolean): Terrain {
  return {
    heightAt: () => 0,
    slopeAt: (s: number, z: number) => (blocked?.(s, z) ? 1 : 0),
    isBuildable: (s: number, z: number) => !blocked?.(s, z),
  } as unknown as Terrain;
}
