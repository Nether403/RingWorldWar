/**
 * Procedural terrain for the ring floor.
 *
 * SEAMLESSNESS: the surface has to join up perfectly after 22.6 km, and tiling
 * 2D noise is a fragile way to achieve that. Instead we sample 3D noise along a
 * circle -- arc length maps to an angle, and we feed the (cos, sin) of that
 * angle into 3D noise. The path is a closed loop, so there is no seam to hide.
 *
 * The heightfield is authoritative for BOTH the simulation (movement, collision,
 * building placement, artillery impact) and rendering, so there is exactly one
 * definition of where the ground is.
 */

import { RING_CIRCUMFERENCE, RING_HALF_WIDTH } from '@core/constants';
import { clamp01, Noise, smoothstep, worley2 } from './noise';
import { Rng } from '@core/rng';
import { wrapS } from '@core/ringMath';

/** Metres per heightfield cell. */
export const TERRAIN_CELL = 16;

/** Height of the containment walls at the rim, metres. */
export const RIM_WALL_HEIGHT = 260;

/** Terrain never exceeds this, keeping the sky readable. */
export const MAX_TERRAIN_HEIGHT = 280;

export interface TerrainFeature {
  /** Surface position. */
  s: number;
  z: number;
  radius: number;
}

export interface TerrainConfig {
  seed: number;
  /** Flat zones carved for the two starting bases and expansions. */
  flatZones: TerrainFeature[];
}

export class Terrain {
  readonly cols: number;
  readonly rows: number;
  readonly heights: Float32Array;
  /** Steepness (0 flat, 1 sheer) precomputed for pathing and build validation. */
  readonly slope: Float32Array;
  readonly seed: number;

  constructor(cfg: TerrainConfig) {
    this.seed = cfg.seed;
    this.cols = Math.round(RING_CIRCUMFERENCE / TERRAIN_CELL);
    this.rows = Math.round((RING_HALF_WIDTH * 2) / TERRAIN_CELL) + 1;
    this.heights = new Float32Array(this.cols * this.rows);
    this.slope = new Float32Array(this.cols * this.rows);
    this.generate(cfg);
  }

  private generate(cfg: TerrainConfig): void {
    const base = new Noise(cfg.seed);
    const warp = new Noise(cfg.seed + 101);
    const ridge = new Noise(cfg.seed + 202);
    const detail = new Noise(cfg.seed + 303);
    const rng = new Rng(cfg.seed + 909);

    // Scatter a handful of impact craters ("breach scars") around the ring.
    const craters: Array<TerrainFeature & { depth: number }> = [];
    for (let i = 0; i < 14; i++) {
      craters.push({
        s: rng.range(0, RING_CIRCUMFERENCE),
        z: rng.range(-RING_HALF_WIDTH * 0.75, RING_HALF_WIDTH * 0.75),
        radius: rng.range(90, 300),
        depth: rng.range(14, 46),
      });
    }

    // Frequency in "loops around the ring". Integer-ish values keep features
    // at a natural scale relative to the circumference.
    const ringFreq = 7.5;
    const scale = ringFreq / RING_CIRCUMFERENCE;

    for (let j = 0; j < this.rows; j++) {
      const z = -RING_HALF_WIDTH + j * TERRAIN_CELL;
      // Normalised distance from the centre line, 0 at middle, 1 at the rim.
      const rim = Math.abs(z) / RING_HALF_WIDTH;

      for (let i = 0; i < this.cols; i++) {
        const s = i * TERRAIN_CELL;
        const ang = (s / RING_CIRCUMFERENCE) * Math.PI * 2;
        // Circle radius chosen so that arc-length frequency matches `scale`.
        const cr = (RING_CIRCUMFERENCE * scale) / (Math.PI * 2);
        const nx = Math.cos(ang) * cr;
        const ny = Math.sin(ang) * cr;
        const nz = z * scale;

        // Domain warp -- the cheapest way to stop noise looking like noise.
        const wx = warp.fbm3(nx * 0.6, ny * 0.6, nz * 0.6, 3) * 0.45;
        const wy = warp.fbm3(nx * 0.6 + 31.7, ny * 0.6, nz * 0.6, 3) * 0.45;

        // Rolling base terrain.
        let h = base.fbm3(nx + wx, ny + wy, nz, 5) * 44;

        // Ridge belts, masked so they form discrete ranges rather than a
        // uniform crumple. These become the map's natural chokepoints, and they
        // need real height: artillery here is short-ranged and direction-biased,
        // so terrain that blocks line of fire is a primary strategic asset.
        const ridgeMask = clamp01(base.fbm3(nx * 0.35, ny * 0.35, nz * 0.35 + 55, 2) * 1.9 + 0.45);
        const r = ridge.ridged3(nx * 1.35 + wx, ny * 1.35 + wy, nz * 1.35, 4);
        h += Math.max(0, r) * 150 * ridgeMask * ridgeMask;

        // Fine detail so close-up ground is not glassy.
        h += detail.fbm3(nx * 6.5, ny * 6.5, nz * 6.5, 3) * 3.2;

        // Broken plating: worley cell borders scratch shallow canyons into the
        // scrith, reading as structural panel joins in the megastructure floor.
        const w = worley2(s * 0.0016, z * 0.0016, cfg.seed & 0xffff);
        const border = 1 - smoothstep(0.0, 0.16, w.f2 - w.f1);
        h -= border * 4;

        // Craters.
        for (const c of craters) {
          const ds = deltaWrapped(s, c.s);
          const dz = z - c.z;
          const d = Math.hypot(ds, dz);
          if (d < c.radius) {
            const t = d / c.radius;
            // Bowl plus raised ejecta lip.
            h += (-Math.cos(t * Math.PI) * 0.5 - 0.5) * c.depth * (1 - t * 0.2);
            h += Math.exp(-((t - 0.88) * (t - 0.88)) / 0.006) * c.depth * 0.42;
          }
        }

        // Rim walls: the ground sweeps up into the containment structure. This
        // bounds the map on the axial axis and frames every camera angle.
        const rimT = smoothstep(0.82, 1.0, rim);
        h = h * (1 - rimT) + (h + RIM_WALL_HEIGHT) * rimT;

        this.heights[j * this.cols + i] = Math.min(h, MAX_TERRAIN_HEIGHT + RIM_WALL_HEIGHT);
      }
    }

    // Flatten the requested zones so bases have somewhere sane to sit.
    for (const zone of cfg.flatZones) this.flatten(zone);

    this.computeSlopes();
  }

  /** Blend a region toward its mean height, with a soft edge. */
  private flatten(zone: TerrainFeature): void {
    const target = this.heightAt(zone.s, zone.z);
    const cellRadius = Math.ceil((zone.radius * 1.8) / TERRAIN_CELL);
    const ci = Math.round(zone.s / TERRAIN_CELL);
    const cj = Math.round((zone.z + RING_HALF_WIDTH) / TERRAIN_CELL);

    for (let dj = -cellRadius; dj <= cellRadius; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= this.rows) continue;
      for (let di = -cellRadius; di <= cellRadius; di++) {
        const i = (((ci + di) % this.cols) + this.cols) % this.cols;
        const s = i * TERRAIN_CELL;
        const z = -RING_HALF_WIDTH + j * TERRAIN_CELL;
        const d = Math.hypot(deltaWrapped(s, zone.s), z - zone.z);
        const t = 1 - smoothstep(zone.radius * 0.6, zone.radius * 1.6, d);
        if (t <= 0) continue;
        const idx = j * this.cols + i;
        this.heights[idx] = this.heights[idx]! * (1 - t) + target * t;
      }
    }
  }

  private computeSlopes(): void {
    const { cols, rows, heights, slope } = this;
    for (let j = 0; j < rows; j++) {
      const jm = Math.max(0, j - 1);
      const jp = Math.min(rows - 1, j + 1);
      for (let i = 0; i < cols; i++) {
        const im = (i - 1 + cols) % cols;
        const ip = (i + 1) % cols;
        const dhds = (heights[j * cols + ip]! - heights[j * cols + im]!) / (2 * TERRAIN_CELL);
        const dhdz = (heights[jp * cols + i]! - heights[jm * cols + i]!) / ((jp - jm) * TERRAIN_CELL);
        slope[j * cols + i] = Math.min(1, Math.hypot(dhds, dhdz));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Sampling
  // -------------------------------------------------------------------------

  /** Bilinearly interpolated floor height at a surface point. */
  heightAt(s: number, z: number): number {
    const { cols, rows, heights } = this;
    const fs = wrapS(s) / TERRAIN_CELL;
    const fz = (clampAxial(z) + RING_HALF_WIDTH) / TERRAIN_CELL;

    const i0 = Math.floor(fs);
    const j0 = Math.floor(fz);
    const tx = fs - i0;
    const tz = fz - j0;

    const ia = ((i0 % cols) + cols) % cols;
    const ib = (ia + 1) % cols;
    const ja = Math.min(rows - 1, Math.max(0, j0));
    const jb = Math.min(rows - 1, ja + 1);

    const h00 = heights[ja * cols + ia]!;
    const h10 = heights[ja * cols + ib]!;
    const h01 = heights[jb * cols + ia]!;
    const h11 = heights[jb * cols + ib]!;

    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  }

  /** Steepness at a surface point, 0 (flat) to 1 (sheer). */
  slopeAt(s: number, z: number): number {
    const { cols, rows, slope } = this;
    const i = ((Math.round(wrapS(s) / TERRAIN_CELL) % cols) + cols) % cols;
    const j = Math.min(rows - 1, Math.max(0, Math.round((clampAxial(z) + RING_HALF_WIDTH) / TERRAIN_CELL)));
    return slope[j * cols + i]!;
  }

  /**
   * Surface normal in the LOCAL tangent frame (x = spinward, y = up, z = axial).
   * Used for planting units and for terrain shading.
   */
  normalAt(s: number, z: number, out: { x: number; y: number; z: number }): void {
    const e = TERRAIN_CELL;
    const dhds = (this.heightAt(s + e, z) - this.heightAt(s - e, z)) / (2 * e);
    const dhdz = (this.heightAt(s, z + e) - this.heightAt(s, z - e)) / (2 * e);
    const len = Math.hypot(dhds, 1, dhdz);
    out.x = -dhds / len;
    out.y = 1 / len;
    out.z = -dhdz / len;
  }

  /** True where a structure could reasonably be placed. */
  isBuildable(s: number, z: number): boolean {
    if (Math.abs(z) > RING_HALF_WIDTH - 140) return false;
    return this.slopeAt(s, z) < 0.34;
  }
}

// ---------------------------------------------------------------------------

function deltaWrapped(a: number, b: number): number {
  const c = RING_CIRCUMFERENCE;
  let d = (b - a) % c;
  if (d > c / 2) d -= c;
  else if (d < -c / 2) d += c;
  return d;
}

function clampAxial(z: number): number {
  return z < -RING_HALF_WIDTH ? -RING_HALF_WIDTH : z > RING_HALF_WIDTH ? RING_HALF_WIDTH : z;
}

/**
 * Standard match layout: two bases on opposite sides of the ring, so the
 * shortest path between them is the same in both directions and neither player
 * starts with the antispinward artillery advantage.
 */
export function standardFlatZones(): TerrainFeature[] {
  const C = RING_CIRCUMFERENCE;
  return [
    { s: 0, z: 0, radius: 420 },
    { s: C * 0.5, z: 0, radius: 420 },
    // Contested expansions at the quarter points.
    { s: C * 0.25, z: RING_HALF_WIDTH * 0.45, radius: 260 },
    { s: C * 0.75, z: -RING_HALF_WIDTH * 0.45, radius: 260 },
    { s: C * 0.25, z: -RING_HALF_WIDTH * 0.45, radius: 200 },
    { s: C * 0.75, z: RING_HALF_WIDTH * 0.45, radius: 200 },
    // Side expansions near each main base.
    { s: C * 0.12, z: RING_HALF_WIDTH * 0.55, radius: 220 },
    { s: C * 0.88, z: -RING_HALF_WIDTH * 0.55, radius: 220 },
    { s: C * 0.38, z: -RING_HALF_WIDTH * 0.55, radius: 220 },
    { s: C * 0.62, z: RING_HALF_WIDTH * 0.55, radius: 220 },
  ];
}

/** Convenience: build the standard match terrain. */
export function createTerrain(seed: number): Terrain {
  return new Terrain({ seed, flatZones: standardFlatZones() });
}
