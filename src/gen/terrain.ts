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
import { clamp, clamp01, Noise, smoothstep, worley2 } from './noise';
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

interface TerrainCorridor {
  fromS: number;
  fromZ: number;
  toS: number;
  toZ: number;
  radius: number;
}

export interface TerrainConfig {
  seed: number;
  /** Flat zones carved for the two starting bases and expansions. */
  flatZones: TerrainFeature[];
  /** Optional narrow routes that keep required strategic locations connected. */
  corridors?: TerrainCorridor[];
}

export class Terrain {
  readonly cols: number;
  readonly rows: number;
  readonly heights: Float32Array;
  /** Steepness (0 flat, 1 sheer) precomputed for pathing and build validation. */
  readonly slope: Float32Array;
  /**
   * Normalised upstream drainage area, 0..1. High where water concentrates.
   * Produced by erosion and consumed by the renderer so material follows the
   * landform rather than unrelated noise.
   */
  readonly flow: Float32Array;
  /** Normalised sediment settled by the hydraulic pass, 0..1. */
  readonly deposition: Float32Array;
  /** Discrete Laplacian of height: positive in bowls, negative on crests, -1..1. */
  readonly curvature: Float32Array;
  /** Four splat weights per cell: dust, rock, exposed deck, rim wall. */
  readonly splat: Float32Array;
  /**
   * Fraction of the sky each point can see, 0 fully enclosed and 1 fully open.
   *
   * Held on a deliberately coarse grid; see `computeSkyView`.
   */
  readonly skyView: Float32Array;
  readonly seed: number;
  private blockedSlopePrefix: Uint32Array | null = null;
  private blockedSlopeMaximum = Number.NaN;

  constructor(cfg: TerrainConfig) {
    this.seed = cfg.seed;
    this.cols = Math.round(RING_CIRCUMFERENCE / TERRAIN_CELL);
    this.rows = Math.round((RING_HALF_WIDTH * 2) / TERRAIN_CELL) + 1;
    this.heights = new Float32Array(this.cols * this.rows);
    this.slope = new Float32Array(this.cols * this.rows);
    const cells = this.cols * this.rows;
    this.flow = new Float32Array(cells);
    this.deposition = new Float32Array(cells);
    this.curvature = new Float32Array(cells);
    this.splat = new Float32Array(cells * 4);
    this.skyView = new Float32Array(SKY_COLS * SKY_ROWS);
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

    // Erosion runs on the raw noise, before any authored carving. Doing it after
    // would chew up the flat pads and corridors that gameplay depends on.
    this.erode();

    // Keep the eroded surface so the surface fields can tell where the authored
    // carving below overrode it. Without this, the drainage field describes a
    // landscape that no longer exists under the base pads.
    const erodedHeights = this.heights.slice();

    // Flatten the requested zones so bases have somewhere sane to sit.
    for (const zone of cfg.flatZones) this.flatten(zone);

    // Capture all route endpoint heights before carving so shared junctions use
    // exactly the same elevation regardless of corridor order.
    const corridors = cfg.corridors?.map((corridor) => ({
      corridor,
      fromHeight: this.heightAt(corridor.fromS, corridor.fromZ),
      toHeight: this.heightAt(corridor.toS, corridor.toZ),
    })) ?? [];
    for (const route of corridors) {
      this.carveCorridor(route.corridor, route.fromHeight, route.toHeight);
    }

    this.computeSlopes();

    // Curvature and splat weights depend on the final surface, so they come last:
    // after erosion, after the flat pads, after the corridors, and after slope.
    this.computeSurfaceFields(erodedHeights);
    this.computeSkyView();
  }

  /**
   * Erode the noise into landforms.
   *
   * Two passes, in the order the physics happens.
   *
   * THERMAL, or talus. Material standing above a critical angle slides to its
   * lower neighbours. This turns the ridged-noise crests into ranges with real
   * scree slopes instead of the uniform crumple noise gives on its own, and it
   * makes steepness consistent rather than accidental, which the navigation grid
   * reads directly.
   *
   * HYDRAULIC, as stream-power incision over a flow-accumulation field. Cells are
   * visited highest first, each handing its accumulated upstream area to its
   * steepest downhill neighbour, so a single sweep yields a real drainage network.
   * Incision is proportional to the square root of that area times local grade,
   * which is the standard stream-power form and carves branching valleys rather
   * than the isotropic dents a droplet scatter produces. Material removed upstream
   * is carried and redeposited where the water slows, which is what fills basins.
   *
   * WHY NOT A DROPLET SIMULATION: it needs tens of thousands of random walks to
   * converge, which is both slower and more awkward to keep deterministic. This is
   * one sort and two sweeps.
   *
   * The rim walls are excluded. They are engineered containment structure rather
   * than sediment, so eroding them would look wrong and would breach the axial
   * bound the map depends on.
   */
  private erode(): void {
    const { cols, rows, heights } = this;
    const count = cols * rows;

    // Erosion resistance: 1 in the open field, 0 on the containment walls.
    const erodible = new Float32Array(count);
    for (let j = 0; j < rows; j++) {
      const z = -RING_HALF_WIDTH + j * TERRAIN_CELL;
      const shielded = smoothstep(0.74, 0.94, Math.abs(z) / RING_HALF_WIDTH);
      for (let i = 0; i < cols; i++) erodible[j * cols + i] = 1 - shielded;
    }

    this.erodeThermal(erodible);
    this.erodeHydraulic(erodible);

    // Deposition only ever adds material, so re-apply the ceiling.
    const ceiling = MAX_TERRAIN_HEIGHT + RIM_WALL_HEIGHT;
    for (let index = 0; index < count; index++) {
      if (heights[index]! > ceiling) heights[index] = ceiling;
    }
  }

  /** Talus relaxation: anything steeper than the critical angle slides downhill. */
  private erodeThermal(erodible: Float32Array): void {
    const { cols, rows, heights } = this;
    const count = cols * rows;
    const delta = new Float32Array(count);
    // Metres of fall per cell a slope can hold. At a 16 m cell this is close to a
    // 1:4 grade, which reads as coarse scree rather than as sand.
    const talus = 4;
    const iterations = 8;

    for (let iteration = 0; iteration < iterations; iteration++) {
      delta.fill(0);
      for (let j = 0; j < rows; j++) {
        // Row bases hoisted, and the neighbour fan unrolled into scalars. The
        // obvious version allocates a four-element array per cell per iteration
        // -- about eleven million short-lived arrays -- and spends more time in
        // the allocator than in the erosion.
        const rowBase = j * cols;
        const northBase = j > 0 ? rowBase - cols : -1;
        const southBase = j < rows - 1 ? rowBase + cols : -1;

        for (let i = 0; i < cols; i++) {
          const index = rowBase + i;
          const strength = erodible[index]!;
          if (strength <= 0.001) continue;
          const height = heights[index]!;

          // Wrapping spinward, clamped axially.
          const west = rowBase + (i === 0 ? cols - 1 : i - 1);
          const east = rowBase + (i === cols - 1 ? 0 : i + 1);
          const north = northBase < 0 ? -1 : northBase + i;
          const south = southBase < 0 ? -1 : southBase + i;

          const dropWest = height - heights[west]!;
          const dropEast = height - heights[east]!;
          const dropNorth = north < 0 ? 0 : height - heights[north]!;
          const dropSouth = south < 0 ? 0 : height - heights[south]!;

          let excess = 0;
          if (dropWest > talus) excess += dropWest - talus;
          if (dropEast > talus) excess += dropEast - talus;
          if (dropNorth > talus) excess += dropNorth - talus;
          if (dropSouth > talus) excess += dropSouth - talus;
          if (excess <= 0) continue;

          // Move a fifth of the excess, shared out by how far each neighbour sits
          // below the critical angle.
          //
          // The fraction is not a taste knob, it is the stability limit. The
          // update is explicit diffusion of the excess, so for a cell with N
          // qualifying neighbours each at drop d the post-sweep drop is
          // d - (N+1)*alpha*(d - talus). Staying at or above the talus angle
          // therefore needs alpha <= 1/(N+1), and N is at most 4 on a
          // four-neighbour grid, giving 0.2. That is exact for N = 4 and
          // conservative below it, where the drop still contracts toward the
          // talus angle by a factor of 0.6 a sweep -- under 2% of the original
          // excess left after the eight sweeps below.
          //
          // Moving half instead, which is the intuitive choice, overshoots as soon
          // as a drop is a few multiples of the talus angle, and the ridged-noise
          // crests here clear that easily. The overshoot then amplifies: measured
          // on seed 6060 it took a [-65, 387] m surface to [-2111, 2208] m in
          // eight sweeps, and the height ceiling hid the top half of that damage
          // by shearing whole ranges off flat.
          const moved = excess * 0.2 * strength;
          delta[index] = delta[index]! - moved;
          if (dropWest > talus) delta[west] = delta[west]! + moved * ((dropWest - talus) / excess);
          if (dropEast > talus) delta[east] = delta[east]! + moved * ((dropEast - talus) / excess);
          if (dropNorth > talus) delta[north] = delta[north]! + moved * ((dropNorth - talus) / excess);
          if (dropSouth > talus) delta[south] = delta[south]! + moved * ((dropSouth - talus) / excess);
        }
      }
      for (let index = 0; index < count; index++) heights[index] = heights[index]! + delta[index]!;
    }
  }

  /**
   * Cell indices ordered highest first, ties broken by ascending index.
   *
   * Flow accumulation needs every cell handled after everything draining into it,
   * and the tie-break is what makes the drainage network reproducible.
   *
   * WHY NOT `Array.from(indices).sort(compare)`: that boxes every one of the
   * ~355k indices into a heap object and then calls back into JS for each of the
   * ~6M comparisons. Instead each cell is packed into one float64 as
   * `orderable(height) * 2^19 + (2^19 - 1 - index)` and handed to the native
   * typed-array sort, which needs no callback and no boxing.
   *
   * `orderable` is the standard IEEE-754 trick: reinterpret the float32 as a
   * uint32, then invert negatives and flip the sign bit on positives. That makes
   * unsigned integer order agree exactly with float order, so no precision is
   * lost and no height range has to be assumed. 32 rank bits plus 19 index bits
   * is 51, inside the 53 a float64 carries exactly.
   */
  private orderByDescendingHeight(): Int32Array {
    const { heights } = this;
    const count = heights.length;
    const reinterpret = new Float32Array(1);
    const asBits = new Uint32Array(reinterpret.buffer);
    // One bit more than the grid needs, so the index never collides with rank.
    const indexScale = 2 ** Math.ceil(Math.log2(count + 1));

    const packed = new Float64Array(count);
    for (let index = 0; index < count; index++) {
      reinterpret[0] = heights[index]!;
      const bits = asBits[0]!;
      const rank = (bits & 0x80000000) !== 0 ? (~bits >>> 0) : ((bits | 0x80000000) >>> 0);
      // Index stored complemented so that reading the ascending sort backwards
      // yields descending height with ascending index within each tie.
      packed[index] = rank * indexScale + (indexScale - 1 - index);
    }
    packed.sort();

    const ordered = new Int32Array(count);
    for (let step = 0; step < count; step++) {
      ordered[step] = indexScale - 1 - (packed[count - 1 - step]! % indexScale);
    }
    return ordered;
  }

  /** Stream-power incision over a single-sweep flow-accumulation field. */
  private erodeHydraulic(erodible: Float32Array): void {
    const { cols, rows, heights, flow, deposition } = this;
    const count = cols * rows;

    const ordered = this.orderByDescendingHeight();

    const downhill = new Int32Array(count).fill(-1);
    /** Grade to the chosen downstream cell: rise over run, so stream power is real. */
    const gradeTo = new Float32Array(count);
    /** Drop to the LOWEST neighbour, which is what bounds how far a cell may be cut. */
    const headroom = new Float32Array(count);
    flow.fill(1);

    // Eight neighbours, not four. A four-neighbour descent can only send water in
    // four directions, so channels come out as rectilinear staircases turning
    // through ninety degrees -- clearly visible in a hillshade and nothing like a
    // river system. Adding the diagonals is the standard D8 fix and costs four
    // more array reads per cell.
    //
    // Diagonals are longer, so the comparison has to be on GRADE (drop over run),
    // not on raw drop. Comparing raw drop biases every choice toward the diagonals
    // simply because they reach further.
    const diagonalRun = Math.SQRT2 * TERRAIN_CELL;

    for (let step = 0; step < count; step++) {
      const index = ordered[step]!;
      const j = (index / cols) | 0;
      const i = index - j * cols;
      const rowBase = index - i;
      const height = heights[index]!;

      // Wrapping spinward, clamped axially. Unrolled for the same allocation
      // reason as the thermal pass.
      const westOffset = (i === 0 ? cols - 1 : i - 1) - i;
      const eastOffset = (i === cols - 1 ? 0 : i + 1) - i;
      const hasNorth = j > 0;
      const hasSouth = j < rows - 1;

      let best = -1;
      let bestGrade = 0;
      let lowest = height;
      let neighbourHeight = 0;
      let grade = 0;

      // Fully unrolled rather than a helper closure, because a closure here is one
      // allocation per cell and undoes the point of the unrolling. Ties keep the
      // first candidate, in this fixed order, which is what makes the drainage
      // network reproducible.
      const west = rowBase + i + westOffset;
      neighbourHeight = heights[west]!;
      if (neighbourHeight < lowest) lowest = neighbourHeight;
      grade = (height - neighbourHeight) / TERRAIN_CELL;
      if (grade > bestGrade) { bestGrade = grade; best = west; }

      const east = rowBase + i + eastOffset;
      neighbourHeight = heights[east]!;
      if (neighbourHeight < lowest) lowest = neighbourHeight;
      grade = (height - neighbourHeight) / TERRAIN_CELL;
      if (grade > bestGrade) { bestGrade = grade; best = east; }

      if (hasNorth) {
        const north = index - cols;
        neighbourHeight = heights[north]!;
        if (neighbourHeight < lowest) lowest = neighbourHeight;
        grade = (height - neighbourHeight) / TERRAIN_CELL;
        if (grade > bestGrade) { bestGrade = grade; best = north; }

        const northWest = north + westOffset;
        neighbourHeight = heights[northWest]!;
        if (neighbourHeight < lowest) lowest = neighbourHeight;
        grade = (height - neighbourHeight) / diagonalRun;
        if (grade > bestGrade) { bestGrade = grade; best = northWest; }

        const northEast = north + eastOffset;
        neighbourHeight = heights[northEast]!;
        if (neighbourHeight < lowest) lowest = neighbourHeight;
        grade = (height - neighbourHeight) / diagonalRun;
        if (grade > bestGrade) { bestGrade = grade; best = northEast; }
      }

      if (hasSouth) {
        const south = index + cols;
        neighbourHeight = heights[south]!;
        if (neighbourHeight < lowest) lowest = neighbourHeight;
        grade = (height - neighbourHeight) / TERRAIN_CELL;
        if (grade > bestGrade) { bestGrade = grade; best = south; }

        const southWest = south + westOffset;
        neighbourHeight = heights[southWest]!;
        if (neighbourHeight < lowest) lowest = neighbourHeight;
        grade = (height - neighbourHeight) / diagonalRun;
        if (grade > bestGrade) { bestGrade = grade; best = southWest; }

        const southEast = south + eastOffset;
        neighbourHeight = heights[southEast]!;
        if (neighbourHeight < lowest) lowest = neighbourHeight;
        grade = (height - neighbourHeight) / diagonalRun;
        if (grade > bestGrade) { bestGrade = grade; best = southEast; }
      }

      downhill[index] = best;
      gradeTo[index] = bestGrade;
      headroom[index] = height - lowest;
      if (best >= 0) flow[best] = flow[best]! + flow[index]!;
    }

    // Incise, and carry what is removed downstream.
    const incision = 0.55;
    const carried = new Float32Array(count);
    deposition.fill(0);
    for (let step = 0; step < count; step++) {
      const index = ordered[step]!;
      const target = downhill[index]!;
      const grade = gradeTo[index]!;
      // Stream power: root area times slope. Flow is counted in cells, so it is
      // already an area measure.
      //
      // The cap is 40% of the drop to the LOWEST neighbour, not to the downstream
      // one. Those differ, and using the downstream drop lets a cell be cut below
      // a sideways neighbour it does not drain to, punching a fresh one-cell pit
      // -- which shows up as dark speckle in a hillshade and, worse, breaks the
      // drainage the field is supposed to describe. Capping on the lowest
      // neighbour makes the post-cut height 0.6h + 0.4*lowest, which is provably
      // still above that neighbour.
      const cut = target >= 0
        ? Math.min(headroom[index]! * 0.4, incision * Math.sqrt(flow[index]!) * grade * erodible[index]!)
        : 0;
      if (cut > 0) heights[index] = heights[index]! - cut;

      const load = carried[index]! + cut;
      if (target < 0) {
        // A pit: everything settles here.
        deposition[index] = deposition[index]! + load;
        heights[index] = heights[index]! + load * 0.5;
        continue;
      }
      // Slack water drops its load; fast water keeps carrying.
      const settled = load * (1 - Math.min(1, grade * 3.2));
      if (settled > 0) {
        deposition[target] = deposition[target]! + settled;
        heights[target] = heights[target]! + settled * 0.35;
      }
      carried[target] = carried[target]! + (load - settled);
    }

    // Normalise both fields to 0..1 so consumers never depend on the grid size.
    // Flow is log-scaled because drainage area spans several orders of magnitude
    // and a linear normalisation would leave everything but the trunk at zero.
    let peak = 1;
    for (let index = 0; index < count; index++) if (flow[index]! > peak) peak = flow[index]!;
    const logPeak = Math.log(1 + peak);
    for (let index = 0; index < count; index++) flow[index] = Math.log(1 + flow[index]!) / logPeak;

    let settledPeak = 1e-4;
    for (let index = 0; index < count; index++) {
      if (deposition[index]! > settledPeak) settledPeak = deposition[index]!;
    }
    for (let index = 0; index < count; index++) deposition[index] = deposition[index]! / settledPeak;
  }

  /**
   * Curvature and splat weights for the finished surface.
   *
   * These exist so the renderer stops inventing its own regions. The terrain
   * shader previously derived deck zones and colour belts from noise unrelated to
   * the landforms it was drawing, which is the reason material never corresponded
   * to shape. This is the one authoritative answer; Task 9 bakes it into vertex
   * attributes.
   */
  private computeSurfaceFields(erodedHeights: Float32Array): void {
    const { cols, rows, heights, slope, flow, deposition, curvature, splat } = this;

    // Drainage was solved on the eroded surface, but the flat pads and corridors
    // were bulldozed into it afterwards. Where that regrading moved the ground,
    // the channels it describes are gone, so the fields have to go with them --
    // otherwise Task 10 paints a river across a landing pad. Fading rather than
    // zeroing keeps the shoulder of a pad reading as a graded site rather than a
    // hard stencil edge.
    const count = cols * rows;

    // How far each cell moved, then dilated over a small neighbourhood.
    //
    // THE DILATION IS NOT COSMETIC. A pad flattens toward its own mean height, so
    // cells that already sat near that mean barely move and a per-cell test reads
    // them as untouched -- leaving isolated wet cells stranded on flat ground in
    // the middle of a base. Taking the neighbourhood maximum asks the right
    // question, which is whether this ground was regraded, not whether this one
    // cell happened to need moving.
    for (let index = 0; index < count; index++) {
      erodedHeights[index] = Math.abs(heights[index]! - erodedHeights[index]!);
    }
    const spread = 2;
    const dilated = new Float32Array(count);
    for (let j = 0; j < rows; j++) {
      const rowBase = j * cols;
      for (let i = 0; i < cols; i++) {
        let peak = 0;
        for (let d = -spread; d <= spread; d++) {
          const value = erodedHeights[rowBase + (((i + d) % cols) + cols) % cols]!;
          if (value > peak) peak = value;
        }
        dilated[rowBase + i] = peak;
      }
    }
    for (let j = 0; j < rows; j++) {
      const rowBase = j * cols;
      for (let i = 0; i < cols; i++) {
        let peak = 0;
        for (let d = -spread; d <= spread; d++) {
          const row = Math.min(rows - 1, Math.max(0, j + d));
          const value = dilated[row * cols + i]!;
          if (value > peak) peak = value;
        }
        const survives = 1 - smoothstep(0.5, 4.0, peak);
        if (survives >= 1) continue;
        const index = rowBase + i;
        flow[index] = flow[index]! * survives;
        deposition[index] = deposition[index]! * survives;
      }
    }

    for (let j = 0; j < rows; j++) {
      const north = Math.max(0, j - 1);
      const south = Math.min(rows - 1, j + 1);
      const z = -RING_HALF_WIDTH + j * TERRAIN_CELL;
      const rim = smoothstep(0.80, 0.97, Math.abs(z) / RING_HALF_WIDTH);

      for (let i = 0; i < cols; i++) {
        const index = j * cols + i;
        const west = j * cols + ((i - 1 + cols) % cols);
        const east = j * cols + ((i + 1) % cols);
        const height = heights[index]!;

        // Discrete Laplacian: positive in bowls, negative on crests. Scaled to
        // roughly -1..1 across the relief this terrain actually carries.
        const laplacian =
          (heights[west]! + heights[east]! + heights[north * cols + i]! + heights[south * cols + i]!)
          - 4 * height;
        curvature[index] = clamp(laplacian / 12, -1, 1);

        const steep = clamp01(slope[index]! * 2.3);
        const wet = flow[index]!;
        const settled = deposition[index]!;

        // Four layers, matching what the shader already draws: wind-blown dust,
        // exposed rock, scoured megastructure deck, and the rim wall.
        //
        // Dust gathers where water slows and the grade is gentle. Rock shows where
        // it is steep or where flow has stripped the cover. Deck is bared in the
        // channels carrying the most water, which is the one place the regolith is
        // genuinely gone rather than merely thin.
        const dust = clamp01((1 - steep) * (0.55 + settled * 1.4));
        const rock = clamp01(steep * 1.2 + wet * 0.35);
        const deck = clamp01(smoothstep(0.72, 0.95, wet) * (1 - steep * 0.8));
        const total = Math.max(1e-4, dust + rock + deck);

        const base = index * 4;
        splat[base] = (dust / total) * (1 - rim);
        splat[base + 1] = (rock / total) * (1 - rim);
        splat[base + 2] = (deck / total) * (1 - rim);
        splat[base + 3] = rim;
      }
    }
  }

  /**
   * Horizon-based sky visibility over the finished surface.
   *
   * For each of eight azimuths, walk outward and keep the steepest elevation angle
   * to the terrain. Visibility is one minus the mean sine of those angles, which
   * is the fraction of the hemisphere the landform leaves open. Baked into the
   * ring mesh as `aAO` by Task 9.
   *
   * WHY THIS EXISTS ALONGSIDE THE SCREEN-SPACE AO FROM TASK 4: that pass works
   * from the depth buffer over a small radius, so it can find where a mech's foot
   * meets the ground but is blind to a valley floor or the base of a rim wall
   * sitting inside a bowl hundreds of metres across. This is the low-frequency
   * term the depth pass cannot see, and being baked it costs nothing per frame.
   *
   * WHY THE GRID IS COARSE. Occlusion at these radii is inherently smooth, and
   * the first implementation evaluated it per ring-mesh vertex instead: 164,864
   * vertices times eight azimuths times four radii is 5.3M bilinear `heightAt`
   * calls, which took 1.25 s and more than doubled the load budget on its own.
   * At roughly 64 m spacing the same walk is about 714k reads, and those reads go
   * straight to the grid by integer index rather than through bilinear sampling,
   * because a horizon walk does not need sub-cell precision. Cost falls to a few
   * milliseconds for a field the eye cannot tell apart.
   *
   * Radii are geometric rather than uniform so near-field detail and
   * several-hundred-metre enclosure both register from four samples. The longest
   * reach is 480 m, enough to catch a rim wall from well out on the floor.
   */
  private computeSkyView(): void {
    const { cols, rows, heights, skyView } = this;
    const radii = [24, 64, 160, 480];
    const directions = 8;

    // The sample pattern is precomputed as integer CELL OFFSETS, not as metre
    // displacements resolved per point. The offsets are identical for every point
    // on the grid, so resolving them once turns the inner loop into pure integer
    // indexing with no trigonometry, no rounding, and no wrap helper calls. The
    // run length is recomputed from the quantised offset so the elevation tangent
    // stays honest rather than using the nominal radius.
    const offsetI: number[] = [];
    const offsetJ: number[] = [];
    const offsetRun: number[] = [];
    for (let k = 0; k < directions; k++) {
      const angle = (k / directions) * Math.PI * 2;
      const ds = Math.cos(angle);
      const dz = Math.sin(angle);
      for (const radius of radii) {
        const di = Math.round((ds * radius) / TERRAIN_CELL);
        const dj = Math.round((dz * radius) / TERRAIN_CELL);
        // A sample that quantises onto the origin carries no horizon information.
        if (di === 0 && dj === 0) continue;
        offsetI.push(di);
        offsetJ.push(dj);
        offsetRun.push(Math.hypot(di, dj) * TERRAIN_CELL);
      }
    }
    const samplesPerDirection = offsetI.length / directions;

    for (let cj = 0; cj < SKY_ROWS; cj++) {
      const z = -RING_HALF_WIDTH + cj * SKY_ROW_SPACING;
      const baseJ = Math.min(rows - 1, Math.max(0, Math.round((z + RING_HALF_WIDTH) / TERRAIN_CELL)));
      for (let ci = 0; ci < SKY_COLS; ci++) {
        const baseI = Math.round((ci * SKY_COL_SPACING) / TERRAIN_CELL) % cols;
        // Nearest-cell read of the point itself, so it is quantised the same way
        // as the samples it is compared against.
        const height = heights[baseJ * cols + baseI]!;

        let occlusion = 0;
        let steepest = 0;
        for (let sample = 0; sample < offsetI.length; sample++) {
          let i = baseI + offsetI[sample]!;
          if (i >= cols) i -= cols;
          else if (i < 0) i += cols;
          let j = baseJ + offsetJ[sample]!;
          if (j < 0) j = 0;
          else if (j >= rows) j = rows - 1;

          const rise = heights[j * cols + i]! - height;
          if (rise > 0) {
            const tangent = rise / offsetRun[sample]!;
            if (tangent > steepest) steepest = tangent;
          }

          if ((sample + 1) % samplesPerDirection === 0) {
            // sin(atan(t)), without the trig.
            occlusion += steepest / Math.sqrt(1 + steepest * steepest);
            steepest = 0;
          }
        }

        skyView[cj * SKY_COLS + ci] = Math.max(0, 1 - occlusion / directions);
      }
    }

    // Smooth the result. Each node reads single 16 m cells, so it picks up
    // whatever one-cell noise happens to sit under its samples, and bilinear
    // reconstruction then spreads that speckle out into 64 m blocks -- clearly
    // visible when the raw field is rendered. Occlusion over hundreds of metres is
    // genuinely smooth, so the speckle is sampling noise rather than signal and
    // blurring it away loses nothing real.
    //
    // Separable 1-2-1, twice, which approximates a Gaussian of about one and a
    // half cells. Costs a fraction of a millisecond on a 354 x 64 grid.
    const scratch = new Float32Array(skyView.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let cj = 0; cj < SKY_ROWS; cj++) {
        const rowBase = cj * SKY_COLS;
        for (let ci = 0; ci < SKY_COLS; ci++) {
          // Spinward wraps: the field has to close up around the ring.
          const west = rowBase + (ci === 0 ? SKY_COLS - 1 : ci - 1);
          const east = rowBase + (ci === SKY_COLS - 1 ? 0 : ci + 1);
          scratch[rowBase + ci] = (skyView[west]! + 2 * skyView[rowBase + ci]! + skyView[east]!) * 0.25;
        }
      }
      for (let cj = 0; cj < SKY_ROWS; cj++) {
        const rowBase = cj * SKY_COLS;
        // Axial clamps: there is nothing beyond the rim to average with.
        const northBase = (cj === 0 ? cj : cj - 1) * SKY_COLS;
        const southBase = (cj === SKY_ROWS - 1 ? cj : cj + 1) * SKY_COLS;
        for (let ci = 0; ci < SKY_COLS; ci++) {
          skyView[rowBase + ci] = (scratch[northBase + ci]! + 2 * scratch[rowBase + ci]! + scratch[southBase + ci]!) * 0.25;
        }
      }
    }
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

  /** Blend a narrow route toward a shallow linear grade with soft shoulders. */
  private carveCorridor(corridor: TerrainCorridor, fromHeight: number, toHeight: number): void {
    const routeS = deltaWrapped(corridor.fromS, corridor.toS);
    const routeZ = corridor.toZ - corridor.fromZ;
    const lengthSquared = routeS * routeS + routeZ * routeZ;
    const outerRadius = corridor.radius * 1.5;

    for (let j = 0; j < this.rows; j++) {
      const z = -RING_HALF_WIDTH + j * TERRAIN_CELL;
      if (
        z < Math.min(corridor.fromZ, corridor.toZ) - outerRadius ||
        z > Math.max(corridor.fromZ, corridor.toZ) + outerRadius
      ) continue;

      for (let i = 0; i < this.cols; i++) {
        const s = i * TERRAIN_CELL;
        const pointS = deltaWrapped(corridor.fromS, s);
        const pointZ = z - corridor.fromZ;
        const along = lengthSquared === 0
          ? 0
          : clamp01((pointS * routeS + pointZ * routeZ) / lengthSquared);
        const nearestS = routeS * along;
        const nearestZ = routeZ * along;
        const distance = Math.hypot(pointS - nearestS, pointZ - nearestZ);
        const blend = 1 - smoothstep(corridor.radius, outerRadius, distance);
        if (blend <= 0) continue;
        const target = fromHeight + (toHeight - fromHeight) * along;
        const index = j * this.cols + i;
        this.heights[index] = this.heights[index]! * (1 - blend) + target * blend;
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
    return this.slope[this.slopeIndexAt(s, z)]!;
  }

  /**
   * Test the same fixed samples as repeated slopeAt calls while avoiding
   * duplicate reads when several 4 m samples round to one 16 m terrain cell.
   */
  segmentSlopePassable(
    fromS: number,
    fromZ: number,
    toS: number,
    toZ: number,
    samples: number,
    maximum: number,
  ): boolean {
    if (this.segmentBoundsClear(fromS, fromZ, toS, toZ, maximum)) return true;
    const ds = deltaWrapped(fromS, toS);
    const dz = toZ - fromZ;
    let previousIndex = -1;
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const index = this.slopeIndexAt(fromS + ds * t, fromZ + dz * t);
      if (index === previousIndex) continue;
      if (this.slope[index]! >= maximum) return false;
      previousIndex = index;
    }
    return true;
  }

  private segmentBoundsClear(
    fromS: number,
    fromZ: number,
    toS: number,
    toZ: number,
    maximum: number,
  ): boolean {
    this.ensureBlockedSlopePrefix(maximum);
    const startS = wrapS(fromS);
    const endS = startS + deltaWrapped(fromS, toS);
    const minS = Math.min(startS, endS);
    const maxS = Math.max(startS, endS);
    const minZ = Math.min(clampAxial(fromZ), clampAxial(toZ));
    const maxZ = Math.max(clampAxial(fromZ), clampAxial(toZ));
    const minCol = Math.floor(minS / TERRAIN_CELL) - 1;
    const maxCol = Math.ceil(maxS / TERRAIN_CELL) + 1;
    const minRow = Math.max(0, Math.floor((minZ + RING_HALF_WIDTH) / TERRAIN_CELL) - 1);
    const maxRow = Math.min(
      this.rows - 1,
      Math.ceil((maxZ + RING_HALF_WIDTH) / TERRAIN_CELL) + 1,
    );
    const width = maxCol - minCol + 1;
    if (width >= this.cols) return false;
    const firstCol = ((minCol % this.cols) + this.cols) % this.cols;
    const lastCol = firstCol + width - 1;
    if (lastCol < this.cols) return !this.blockedInRect(firstCol, lastCol, minRow, maxRow);
    return !this.blockedInRect(firstCol, this.cols - 1, minRow, maxRow) &&
      !this.blockedInRect(0, lastCol - this.cols, minRow, maxRow);
  }

  private ensureBlockedSlopePrefix(maximum: number): void {
    if (this.blockedSlopePrefix && this.blockedSlopeMaximum === maximum) return;
    const stride = this.cols + 1;
    const prefix = new Uint32Array((this.rows + 1) * stride);
    for (let row = 0; row < this.rows; row++) {
      let rowTotal = 0;
      for (let col = 0; col < this.cols; col++) {
        if (this.slope[row * this.cols + col]! >= maximum) rowTotal++;
        prefix[(row + 1) * stride + col + 1] = prefix[row * stride + col + 1]! + rowTotal;
      }
    }
    this.blockedSlopePrefix = prefix;
    this.blockedSlopeMaximum = maximum;
  }

  private blockedInRect(minCol: number, maxCol: number, minRow: number, maxRow: number): boolean {
    const prefix = this.blockedSlopePrefix!;
    const stride = this.cols + 1;
    const left = minCol;
    const right = maxCol + 1;
    const top = minRow;
    const bottom = maxRow + 1;
    const count = prefix[bottom * stride + right]! - prefix[top * stride + right]! -
      prefix[bottom * stride + left]! + prefix[top * stride + left]!;
    return count > 0;
  }

  private slopeIndexAt(s: number, z: number): number {
    const i = ((Math.round(wrapS(s) / TERRAIN_CELL) % this.cols) + this.cols) % this.cols;
    const j = Math.min(
      this.rows - 1,
      Math.max(0, Math.round((clampAxial(z) + RING_HALF_WIDTH) / TERRAIN_CELL)),
    );
    return j * this.cols + i;
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

  /**
   * Bilinear weights and cell indices for a surface point.
   *
   * Shared by every field sampler so they all agree with `heightAt` exactly. The
   * render mesh samples at a coarser spacing than the 16 m grid, so nearest-cell
   * lookup would alias the fields against the heights they describe and put
   * material boundaries in visibly the wrong place.
   */
  private bilinearAt(s: number, z: number, out: BilinearWeights): void {
    const { cols, rows } = this;
    const fs = wrapS(s) / TERRAIN_CELL;
    const fz = (clampAxial(z) + RING_HALF_WIDTH) / TERRAIN_CELL;

    const i0 = Math.floor(fs);
    const j0 = Math.floor(fz);
    const ia = ((i0 % cols) + cols) % cols;
    const ib = (ia + 1) % cols;
    const ja = Math.min(rows - 1, Math.max(0, j0));
    const jb = Math.min(rows - 1, ja + 1);

    out.tx = fs - i0;
    out.tz = fz - j0;
    out.aa = ja * cols + ia;
    out.ba = ja * cols + ib;
    out.ab = jb * cols + ia;
    out.bb = jb * cols + ib;
  }

  /**
   * Bilinearly interpolated sky visibility, 0 fully enclosed and 1 fully open.
   *
   * Sampled off its own coarse grid rather than the 16 m one, so this cannot share
   * `bilinearAt`. The spinward axis wraps and the axial axis clamps, matching
   * `heightAt`.
   */
  skyViewAt(s: number, z: number): number {
    const { skyView } = this;
    const fs = wrapS(s) / SKY_COL_SPACING;
    const fz = (clampAxial(z) + RING_HALF_WIDTH) / SKY_ROW_SPACING;

    const i0 = Math.floor(fs);
    const j0 = Math.floor(fz);
    const tx = fs - i0;
    const tz = fz - j0;

    const ia = ((i0 % SKY_COLS) + SKY_COLS) % SKY_COLS;
    const ib = (ia + 1) % SKY_COLS;
    const ja = Math.min(SKY_ROWS - 1, Math.max(0, j0));
    const jb = Math.min(SKY_ROWS - 1, ja + 1);

    const lower = skyView[ja * SKY_COLS + ia]! + (skyView[ja * SKY_COLS + ib]! - skyView[ja * SKY_COLS + ia]!) * tx;
    const upper = skyView[jb * SKY_COLS + ia]! + (skyView[jb * SKY_COLS + ib]! - skyView[jb * SKY_COLS + ia]!) * tx;
    return lower + (upper - lower) * tz;
  }

  /**
   * Every field the renderer bakes, at one surface point, in one call.
   *
   * ONE CALL RATHER THAN THREE because the ring mesh asks for all of these at the
   * same 165k points, and the bilinear cell lookup is the bulk of the cost:
   * measured with the samplers stubbed out, the quantisation and attribute writes
   * around them account for 5 ms of a 120 ms bake. Splat and curvature share the
   * 16 m grid so they share one lookup; sky visibility has its own coarser grid.
   *
   * The splat weights stay a partition of unity through the interpolation,
   * because bilinear blending is a convex combination and every input cell already
   * sums to one. So the renderer can blend straight from these without
   * renormalising.
   */
  surfaceFieldsAt(s: number, z: number, out: SurfaceFields): void {
    const w = sharedWeights;
    this.bilinearAt(s, z, w);
    const { splat, curvature } = this;

    const curveLower = curvature[w.aa]! + (curvature[w.ba]! - curvature[w.aa]!) * w.tx;
    const curveUpper = curvature[w.ab]! + (curvature[w.bb]! - curvature[w.ab]!) * w.tx;
    out.curvature = curveLower + (curveUpper - curveLower) * w.tz;
    out.skyView = this.skyViewAt(s, z);
    const aa = w.aa * 4;
    const ba = w.ba * 4;
    const ab = w.ab * 4;
    const bb = w.bb * 4;
    const { tx, tz } = w;
    // Unrolled. This runs once per ring-mesh vertex, 165k times, and a loop with
    // a four-way branch to pick the output field costs more than the arithmetic.
    let lower = splat[aa]! + (splat[ba]! - splat[aa]!) * tx;
    let upper = splat[ab]! + (splat[bb]! - splat[ab]!) * tx;
    out.dust = lower + (upper - lower) * tz;

    lower = splat[aa + 1]! + (splat[ba + 1]! - splat[aa + 1]!) * tx;
    upper = splat[ab + 1]! + (splat[bb + 1]! - splat[ab + 1]!) * tx;
    out.rock = lower + (upper - lower) * tz;

    lower = splat[aa + 2]! + (splat[ba + 2]! - splat[aa + 2]!) * tx;
    upper = splat[ab + 2]! + (splat[bb + 2]! - splat[ab + 2]!) * tx;
    out.deck = lower + (upper - lower) * tz;

    lower = splat[aa + 3]! + (splat[ba + 3]! - splat[aa + 3]!) * tx;
    upper = splat[ab + 3]! + (splat[bb + 3]! - splat[ab + 3]!) * tx;
    out.rim = lower + (upper - lower) * tz;
  }
}

/** The renderer-facing field set at a surface point. */
export interface SurfaceFields {
  /** Splat weights, summing to one: wind-blown dust, exposed rock, bared deck, rim wall. */
  dust: number;
  rock: number;
  deck: number;
  rim: number;
  /** Negative on crests, positive in bowls, -1..1. */
  curvature: number;
  /** Fraction of the sky visible, 0 enclosed to 1 open. */
  skyView: number;
}

interface BilinearWeights {
  tx: number;
  tz: number;
  aa: number;
  ba: number;
  ab: number;
  bb: number;
}

/**
 * Scratch for the field samplers. They are called a few hundred thousand times
 * while baking the ring mesh, and allocating a weights object per call is the
 * kind of thing that turns a 100 ms bake into a 400 ms one. Safe because
 * generation is single-threaded and no sampler calls another.
 */
const sharedWeights: BilinearWeights = { tx: 0, tz: 0, aa: 0, ba: 0, ab: 0, bb: 0 };

/**
 * Resolution of the sky-visibility field, about 64 m in both axes.
 *
 * Column count divides the circumference exactly so the field wraps without a
 * seam, which a plain "every fourth cell" decimation of the 1414-column grid
 * would not: 1414 / 4 is not an integer, and the discontinuity would land as a
 * shading stripe running the full width of the ring.
 */
const SKY_COLS = 354;
const SKY_ROWS = 64;
const SKY_COL_SPACING = RING_CIRCUMFERENCE / SKY_COLS;
const SKY_ROW_SPACING = (RING_HALF_WIDTH * 2) / (SKY_ROWS - 1);



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
    // Exact Spinal Node pads from World.setup are applied last so they win any overlap.
    { s: C * 0.25, z: 0, radius: 220 },
    { s: C * 0.75, z: 0, radius: 220 },
    { s: C * 0.125, z: RING_HALF_WIDTH * 0.6, radius: 220 },
    { s: C * 0.625, z: -RING_HALF_WIDTH * 0.6, radius: 220 },
  ];
}

function standardCorridors(): TerrainCorridor[] {
  const C = RING_CIRCUMFERENCE;
  const radius = 160;
  const centerFractions = [0, 0.125, 0.25, 0.5, 0.625, 0.75, 1];
  const corridors: TerrainCorridor[] = [];
  for (let i = 1; i < centerFractions.length; i++) {
    corridors.push({
      fromS: C * centerFractions[i - 1]!,
      fromZ: 0,
      toS: C * centerFractions[i]!,
      toZ: 0,
      radius,
    });
  }
  corridors.push(
    {
      fromS: C * 0.125,
      fromZ: 0,
      toS: C * 0.125,
      toZ: RING_HALF_WIDTH * 0.6,
      radius,
    },
    {
      fromS: C * 0.625,
      fromZ: 0,
      toS: C * 0.625,
      toZ: -RING_HALF_WIDTH * 0.6,
      radius,
    },
  );
  return corridors;
}

/** Convenience: build the standard match terrain. */
export function createTerrain(seed: number): Terrain {
  return new Terrain({
    seed,
    flatZones: standardFlatZones(),
    corridors: standardCorridors(),
  });
}
