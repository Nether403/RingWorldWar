import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { RING_HALF_WIDTH } from '../../src/core/constants';
import { createTerrain, MAX_TERRAIN_HEIGHT, RIM_WALL_HEIGHT, TERRAIN_CELL, Terrain, standardFlatZones } from '../../src/gen/terrain';

/**
 * Erosion is the one part of the graphics overhaul that is not purely
 * presentational: `heights` is authoritative for pathing and buildability as well
 * as for rendering. So it gets held to the simulation standard, not the art
 * standard.
 *
 * A full ring is ~355k cells and generation is over a second, so the suite shares
 * one standard terrain across every assertion that does not specifically need a
 * fresh one, and the whole describe carries a raised timeout.
 */
function digest(data: Float32Array): string {
  return createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
}

describe('terrain erosion', { timeout: 60_000 }, () => {
  let standard: Terrain;

  beforeAll(() => {
    standard = createTerrain(6060);
  });

  it('is byte-for-byte deterministic for a given seed', () => {
    const first = createTerrain(20260822);
    const second = createTerrain(20260822);
    expect(digest(second.heights)).toBe(digest(first.heights));
    expect(digest(second.slope)).toBe(digest(first.slope));
    expect(digest(second.flow)).toBe(digest(first.flow));
    expect(digest(second.deposition)).toBe(digest(first.deposition));
    expect(digest(second.curvature)).toBe(digest(first.curvature));
    expect(digest(second.splat)).toBe(digest(first.splat));
    // And a different seed has to give a different surface, or the seed is being
    // dropped somewhere in the erosion path.
    expect(digest(createTerrain(20260823).heights)).not.toBe(digest(first.heights));
  });

  /**
   * Load-time generation cost, measured only when asked for.
   *
   * OPT-IN, AND THAT IS THE POINT. `docs/procedural-assets.md` section 9 allows
   * under three seconds for all load-time generation and terrain is the largest
   * single consumer, so the cost matters. But it cannot be honestly asserted from
   * inside this suite, and three attempts established that rather than assumed it:
   *
   *   - An absolute 1900 ms bound, from the isolated 1544 ms median. Failed at
   *     3012 ms in a full-suite run.
   *   - A loose 6000 ms bound. Failed at 6326 ms in a later run on a warmer
   *     machine.
   *   - A ratio against a reference workload run in the same process, so that
   *     contention would scale both. The ratio itself came out between 24 and 45
   *     across three consecutive runs, because a tight `Math.sqrt` loop over a
   *     cache-resident array does not scale with 355k-cell noise generation. The
   *     proxy was no more stable than the thing it was proxying for.
   *
   * Vitest runs files across parallel workers, so any wall-clock figure here is
   * mostly a measurement of what else happened to be scheduled. A test that fails
   * on machine load is worse than no test, because it teaches everyone to ignore a
   * red suite.
   *
   * So: skipped by default, and runnable deliberately with RWW_MEASURE=1, where it
   * reports rather than gates. The real figures are recorded per-phase in the
   * Task 8, 9, and 10 sections of docs/procedural-graphics-overhaul.md, and
   * gating them properly belongs in `npm run rww -- perf`, which already does
   * warmup, medians, and receipts. That is noted as owed work rather than done.
   */
  it.runIf(process.env['RWW_MEASURE'] === '1')('reports load-time generation cost', () => {
    const samples: number[] = [];
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      createTerrain(4242 + run);
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.log(`createTerrain median ${samples[2]!.toFixed(0)} ms, min ${samples[0]!.toFixed(0)} ms`);
    // Only a sanity floor: if this ever comes back near zero, generation has been
    // short-circuited and every other test in this file is checking nothing.
    expect(samples[0]!).toBeGreaterThan(50);
  });

  it('relaxes over-steep ground without amplifying relief', () => {
    // THIS IS THE REGRESSION GUARD FOR A REAL BUG. The thermal pass is explicit
    // diffusion of the above-talus excess, so its transfer fraction has a
    // stability limit of 1/(N+1) = 0.2 on a four-neighbour grid. The first
    // implementation moved half, which diverged: seed 6060 went from a
    // [-65, 387] m surface to [-2111, 2208] m over eight sweeps.
    //
    // Asserting only "finite, and under the ceiling" did NOT catch that, because
    // the ceiling re-clamp in erode() truncated the upward half of the divergence
    // into whole ranges shorn off flat at exactly 540 m. So this checks the three
    // things that actually distinguish erosion from divergence: the height
    // envelope, that nothing is pinned against the ceiling, and that the steep
    // tail of the slope distribution came down rather than up.
    //
    // Bounds are set from measurement across 11 seeds: min -60.3..-34.5,
    // max 318.6..403.4, zero cells at the ceiling, grade p999 0.635..1.353.
    const ceiling = MAX_TERRAIN_HEIGHT + RIM_WALL_HEIGHT;
    let minimum = Infinity;
    let maximum = -Infinity;
    let pinned = 0;
    let nonFinite = 0;
    // Scanned into counters and asserted once. A per-cell expect() over 355k
    // cells builds 355k assertion objects and costs tens of seconds.
    for (const height of standard.heights) {
      if (!Number.isFinite(height)) nonFinite++;
      if (height < minimum) minimum = height;
      if (height > maximum) maximum = height;
      if (height >= ceiling - 0.01) pinned++;
    }
    expect(nonFinite).toBe(0);
    expect(minimum).toBeGreaterThan(-120);
    expect(maximum).toBeLessThan(460);
    expect(pinned / standard.heights.length).toBeLessThan(0.001);

    // Steep tail, sampled over the open field only: the rim walls are shielded
    // from erosion by design and are near-vertical, so including them would
    // measure the containment structure instead of the landscape.
    const { cols, rows, heights } = standard;
    const grades: number[] = [];
    for (let j = 40; j < rows - 40; j += 3) {
      for (let i = 0; i < cols; i += 3) {
        const index = j * cols + i;
        const west = j * cols + ((i - 1 + cols) % cols);
        const east = j * cols + ((i + 1) % cols);
        const dhds = (heights[east]! - heights[west]!) / (2 * TERRAIN_CELL);
        const dhdz = (heights[index + cols]! - heights[index - cols]!) / (2 * TERRAIN_CELL);
        grades.push(Math.hypot(dhds, dhdz));
      }
    }
    grades.sort((a, b) => a - b);
    expect(grades[Math.floor(grades.length * 0.999)]!).toBeLessThan(1.8);
  });

  it('wraps spinward without a seam', () => {
    const { cols, rows, heights, splat } = standard;
    // The first and last columns are neighbours. Erosion exchanges material
    // across that boundary, so a bug there shows up as a discontinuity.
    for (let j = 0; j < rows; j += 17) {
      const first = heights[j * cols]!;
      const last = heights[j * cols + cols - 1]!;
      expect(Math.abs(first - last)).toBeLessThan(60);
      const firstSplat = splat[j * cols * 4]!;
      const lastSplat = splat[(j * cols + cols - 1) * 4]!;
      expect(Math.abs(firstSplat - lastSplat)).toBeLessThan(0.9);
    }
  });

  it('leaves the rim walls standing', () => {
    // They are engineered containment, not sediment. Eroding them would breach
    // the axial bound the map relies on.
    const centre = standard.heightAt(5_000, 0);
    const rim = standard.heightAt(5_000, RING_HALF_WIDTH - TERRAIN_CELL);
    expect(rim).toBeGreaterThan(centre + RIM_WALL_HEIGHT * 0.5);
  });

  it('carves drainage rather than isotropic dents', () => {
    const { flow } = standard;
    // A drainage network is sparse: a few cells carry most of the water. An
    // isotropic scatter would leave flow roughly uniform, so the distribution is
    // the evidence that the hydraulic pass found channels.
    let channelled = 0;
    for (const value of flow) if (value > 0.5) channelled++;
    const fraction = channelled / flow.length;
    expect(fraction).toBeGreaterThan(0.0001);
    expect(fraction).toBeLessThan(0.35);
  });

  it('emits normalised, finite surface fields', () => {
    // The renderer will read these straight into vertex attributes in Task 9, so
    // an out-of-range or NaN cell becomes a visible artefact with no other symptom.
    // Ranges are checked by scanning to extremes and asserting once, for the same
    // cost reason as above.
    function extremes(field: Float32Array): { min: number; max: number; nonFinite: number } {
      let min = Infinity;
      let max = -Infinity;
      let nonFinite = 0;
      for (const value of field) {
        if (!Number.isFinite(value)) { nonFinite++; continue; }
        if (value < min) min = value;
        if (value > max) max = value;
      }
      return { min, max, nonFinite };
    }

    const flow = extremes(standard.flow);
    expect(flow.nonFinite).toBe(0);
    expect(flow.min).toBeGreaterThanOrEqual(0);
    expect(flow.max).toBeLessThanOrEqual(1.0001);
    // Normalisation is only meaningful if it actually reaches the top of the range.
    expect(flow.max).toBeGreaterThan(0.99);

    const deposition = extremes(standard.deposition);
    expect(deposition.nonFinite).toBe(0);
    expect(deposition.min).toBeGreaterThanOrEqual(0);
    expect(deposition.max).toBeLessThanOrEqual(1.0001);
    expect(deposition.max).toBeGreaterThan(0.99);

    const curvature = extremes(standard.curvature);
    expect(curvature.nonFinite).toBe(0);
    expect(curvature.min).toBeGreaterThanOrEqual(-1.0001);
    expect(curvature.max).toBeLessThanOrEqual(1.0001);
    // Both signs have to be present, or curvature is not distinguishing bowls
    // from crests and the shader has nothing to key wear off in Task 12.
    expect(curvature.min).toBeLessThan(-0.05);
    expect(curvature.max).toBeGreaterThan(0.05);
  });

  it('emits splat weights that sum to one per cell', () => {
    const { splat } = standard;
    for (let index = 0; index < splat.length; index += 4 * 997) {
      const sum = splat[index]! + splat[index + 1]! + splat[index + 2]! + splat[index + 3]!;
      // The renderer blends these directly, so a cell that does not sum to one
      // would either wash out or over-saturate.
      expect(sum).toBeGreaterThan(0.98);
      expect(sum).toBeLessThan(1.02);
    }
  });

  it('keeps the authored flat pads flat after erosion', () => {
    // Erosion runs before flattening precisely so the pads survive it. If that
    // order ever inverts, bases become unbuildable.
    for (const zone of standardFlatZones()) {
      expect(standard.isBuildable(zone.s, zone.z)).toBe(true);
    }
  });

  it('withdraws drainage from ground the authored carving regraded', () => {
    // Erosion has to run before the flat pads are cut, but the fields it produces
    // are consumed by the renderer, which draws the FINAL surface. Left alone the
    // two disagree and Task 10 paints a river across a landing pad.
    //
    // Measured against the same pads gameplay uses, so this fails if the damping
    // is dropped or if the pads ever stop being carved after erosion.
    const { cols, flow } = standard;
    let padCells = 0;
    let wetPadCells = 0;
    for (const zone of standardFlatZones()) {
      const centreCol = Math.round(zone.s / TERRAIN_CELL) % cols;
      const centreRow = Math.round((zone.z + RING_HALF_WIDTH) / TERRAIN_CELL);
      // Sample well inside the pad, where flattening fully overrode the surface
      // rather than feathering into it.
      const reach = Math.floor((zone.radius * 0.5) / TERRAIN_CELL);
      for (let dj = -reach; dj <= reach; dj++) {
        for (let di = -reach; di <= reach; di++) {
          const index = (centreRow + dj) * cols + (((centreCol + di) % cols) + cols) % cols;
          padCells++;
          if (flow[index]! > 0.5) wetPadCells++;
        }
      }
    }
    expect(padCells).toBeGreaterThan(500);
    expect(wetPadCells / padCells).toBeLessThan(0.01);
  });

  it('keeps the mid-ring corridor traversable', () => {
    // The standard corridors connect the required strategic locations. Erosion
    // must not cut a gorge across one.
    expect(standard.segmentSlopePassable(0, 0, 2_000, 0, 64, 0.34)).toBe(true);
  });

  it('produces slope consistent with the eroded heights', () => {
    // computeSlopes has to run after erosion, and the summed-area prefix used by
    // pathing is keyed only on its threshold, so a stale slope field would go
    // unnoticed by every other test.
    const { cols, heights, slope } = standard;
    const j = 120;
    const i = 700;
    const index = j * cols + i;
    const dhds = (heights[index + 1]! - heights[index - 1]!) / (2 * TERRAIN_CELL);
    const dhdz = (heights[index + cols]! - heights[index - cols]!) / (2 * TERRAIN_CELL);
    expect(slope[index]!).toBeCloseTo(Math.min(1, Math.hypot(dhds, dhdz)), 5);
  });
});
