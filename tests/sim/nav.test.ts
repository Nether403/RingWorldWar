import { describe, expect, it } from 'vitest';
import { RING_CIRCUMFERENCE, RING_HALF_WIDTH } from '@core/constants';
import { surfaceDist, wrapS } from '@core/ringMath';
import { createTerrain, type Terrain } from '@gen/terrain';
import { SurfaceNav } from '@sim/nav';

const STANDARD_SEEDS = [
  17, 101, 257, 501, 777, 1001, 1002, 1003, 1004, 1005,
  1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 1015,
] as const;

const STANDARD_BASE_LOCATIONS = [
  [0, 0],
  [RING_CIRCUMFERENCE * 0.5, 0],
] as const;

// Keep these coordinates identical to World.setup's standard Spinal Nodes.
const STANDARD_NODE_LOCATIONS = [
  [RING_CIRCUMFERENCE * 0.25, 0],
  [RING_CIRCUMFERENCE * 0.75, 0],
  [RING_CIRCUMFERENCE * 0.125, RING_HALF_WIDTH * 0.6],
  [RING_CIRCUMFERENCE * 0.625, -RING_HALF_WIDTH * 0.6],
] as const;

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

  it('retains the representative late-match working set without rebuilding fields', () => {
    const nav = new SurfaceNav(flatTerrain());
    const goals = Array.from({ length: 72 }, (_, index) => 400 + index * 240);
    for (const goal of goals) nav.directionAt(0, 0, goal, 0);
    const builds = nav.fieldBuildCount;
    for (const goal of goals) nav.directionAt(20, 0, goal, 0);

    expect(builds).toBe(72);
    expect(nav.fieldBuildCount).toBe(builds);
    expect(nav.cachedFieldCount).toBe(72);
  }, 30_000);

  it('keeps accelerated terrain segment sampling identical to canonical slope samples', () => {
    const terrain = createTerrain(501);
    const nav = new SurfaceNav(terrain);
    const segments = [
      [0, 0, 180, 0],
      [400, -320, 720, 180],
      [RING_CIRCUMFERENCE - 100, 80, 120, -120],
      [8_000, -1_200, 8_500, -900],
      ...Array.from({ length: 40 }, (_, index) => {
        const fromS = wrapS(index * 587.3 - 200);
        const fromZ = -1_700 + (index * 193) % 3_400;
        return [fromS, fromZ, wrapS(fromS + (index % 2 === 0 ? 1 : -1) * (80 + index * 17)), -fromZ * 0.7] as const;
      }),
    ] as const;

    for (const [fromS, fromZ, toS, toZ] of segments) {
      expect(nav.segmentPassable(fromS, fromZ, toS, toZ)).toBe(
        canonicalSegmentPassable(terrain, fromS, fromZ, toS, toZ),
      );
    }
  }, 30_000);

  it.each(STANDARD_SEEDS)('keeps standard strategic nodes connected for seed %i', (seed) => {
    const nav = new SurfaceNav(createTerrain(seed));

    for (const [nodeS, nodeZ] of STANDARD_NODE_LOCATIONS) {
      expect(navCellIsPassable(nav, nodeS, nodeZ),
        `seed ${seed} node (${nodeS}, ${nodeZ})`).toBe(true);
    }

    for (const [baseS, baseZ] of STANDARD_BASE_LOCATIONS) {
      const reachable = STANDARD_NODE_LOCATIONS.filter(([nodeS, nodeZ]) =>
        nav.directionAt(baseS, baseZ, nodeS, nodeZ).reachable,
      );
      expect(reachable.length, `seed ${seed} base (${baseS}, ${baseZ})`).toBeGreaterThan(0);
      expect(reachable.length, `seed ${seed} base (${baseS}, ${baseZ})`).toBe(
        STANDARD_NODE_LOCATIONS.length,
      );
    }
  }, 30_000);

  it('returns deterministic standard-map directions after corridor generation', () => {
    const terrain = createTerrain(1010);
    const first = new SurfaceNav(terrain);
    const second = new SurfaceNav(terrain);

    for (const [baseS, baseZ] of STANDARD_BASE_LOCATIONS) {
      for (const [nodeS, nodeZ] of STANDARD_NODE_LOCATIONS) {
        expect(first.directionAt(baseS, baseZ, nodeS, nodeZ)).toEqual(
          second.directionAt(baseS, baseZ, nodeS, nodeZ),
        );
      }
    }
  }, 30_000);
});

function navCellIsPassable(nav: SurfaceNav, s: number, z: number): boolean {
  const col = Math.floor(wrapS(s) / nav.cellS) % nav.cols;
  const row = Math.max(0, Math.min(nav.rows - 1, Math.round((z + RING_HALF_WIDTH) / nav.cellZ)));
  const passable = (nav as unknown as { passable: Uint8Array }).passable;
  return passable[row * nav.cols + col] === 1;
}

function flatTerrain(blocked?: (s: number, z: number) => boolean): Terrain {
  return {
    heightAt: () => 0,
    slopeAt: (s: number, z: number) => (blocked?.(s, z) ? 1 : 0),
    isBuildable: (s: number, z: number) => !blocked?.(s, z),
  } as unknown as Terrain;
}

function canonicalSegmentPassable(
  terrain: Terrain,
  fromS: number,
  fromZ: number,
  toS: number,
  toZ: number,
): boolean {
  let ds = (toS - fromS) % RING_CIRCUMFERENCE;
  if (ds > RING_CIRCUMFERENCE / 2) ds -= RING_CIRCUMFERENCE;
  else if (ds < -RING_CIRCUMFERENCE / 2) ds += RING_CIRCUMFERENCE;
  const dz = toZ - fromZ;
  const steps = Math.max(1, Math.ceil(Math.hypot(ds, dz) / 4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const s = wrapS(fromS + ds * t);
    const z = fromZ + dz * t;
    if (Math.abs(z) > RING_HALF_WIDTH - 60 || terrain.slopeAt(s, z) >= 0.72) return false;
  }
  return true;
}
