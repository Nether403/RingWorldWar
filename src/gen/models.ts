/**
 * Procedural hard-surface models.
 *
 * Every mech and building in the game is built here out of code. The style is
 * machined industrial sci-fi, which is the one look procedural generation is
 * genuinely good at: bevelled chassis blocks, inset panel lines, greebles
 * clustered at joints, and emissive strips in faction colour.
 *
 * Two techniques carry most of the result:
 *
 *   BEVELS. A cube reads as a cube. A cube with 5 cm chamfers on every edge
 *   catches a highlight along each one and reads as a machined part. It costs
 *   24 vertices instead of 8 and it is the cheapest realism available.
 *
 *   MASK CHANNELS. Each vertex carries `aMask`: 0 = hull, 1 = faction emissive,
 *   2 = dark recess, 3 = worn metal. One material reads it to paint both
 *   factions and all surface variation, so the entire army is a handful of
 *   draw calls with no textures at all.
 */

import * as THREE from 'three';
import { Rng } from '@core/rng';
import { SURFACE_GLSL } from '@render/materials/surface.glsl';

export const MASK_HULL = 0;
export const MASK_EMISSIVE = 1;
export const MASK_RECESS = 2;
export const MASK_METAL = 3;

// ---------------------------------------------------------------------------
// Geometry building blocks
// ---------------------------------------------------------------------------

/** Accumulates triangles and produces one indexed BufferGeometry. */
class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private mask: number[] = [];
  private idx: number[] = [];

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** Add a quad using the generator's clockwise exterior-corner order. */
  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    mask: number,
  ): void {
    const base = this.pos.length / 3;
    _e1.subVectors(b, a);
    _e2.subVectors(d, a);
    _n.crossVectors(_e2, _e1).normalize();

    for (const [v, u, w] of [
      [a, 0, 0],
      [b, 1, 0],
      [c, 1, 1],
      [d, 0, 1],
    ] as const) {
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(_n.x, _n.y, _n.z);
      this.uv.push(u, w);
      this.mask.push(mask);
    }
    this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  /** Add one non-degenerate triangle in the same exterior-corner order. */
  triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, mask: number): void {
    const base = this.pos.length / 3;
    _e1.subVectors(b, a);
    _e2.subVectors(c, a);
    _n.crossVectors(_e2, _e1).normalize();
    for (const [v, u, w] of [
      [a, 0.5, 0.5],
      [b, 0, 0],
      [c, 1, 0],
    ] as const) {
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(_n.x, _n.y, _n.z);
      this.uv.push(u, w);
      this.mask.push(mask);
    }
    this.idx.push(base, base + 2, base + 1);
  }

  /** Append another builder's contents, transformed. */
  append(other: MeshBuilder, m: THREE.Matrix4): void {
    const base = this.pos.length / 3;
    _nm.getNormalMatrix(m);
    for (let i = 0; i < other.pos.length; i += 3) {
      _v.set(other.pos[i]!, other.pos[i + 1]!, other.pos[i + 2]!).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.set(other.nrm[i]!, other.nrm[i + 1]!, other.nrm[i + 2]!)
        .applyMatrix3(_nm)
        .normalize();
      this.nrm.push(_v.x, _v.y, _v.z);
    }
    this.uv.push(...other.uv);
    this.mask.push(...other.mask);
    for (const t of other.idx) this.idx.push(base + t);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aMask', new THREE.Float32BufferAttribute(this.mask, 1));
    g.setIndex(this.idx);
    // Convexity and occlusion travel as ONE vec2 rather than two float attributes.
    // Every attribute is a vertex fetch and every varying an interpolator slot, and
    // the hull shader is already carrying fifteen floats of varyings; see the note
    // on the frame budget in makeHullMaterial.
    const { curvature, occlusion } = this.weldedSurfaceFields();
    const field = new Float32Array(curvature.length * 2);
    for (let vertex = 0; vertex < curvature.length; vertex++) {
      field[vertex * 2] = curvature[vertex]!;
      field[vertex * 2 + 1] = occlusion[vertex]!;
    }
    g.setAttribute('aSurfaceField', new THREE.Float32BufferAttribute(field, 2));
    g.computeBoundingSphere();
    return g;
  }

  /**
   * Per-vertex convexity and ambient occlusion, derived by welding on position.
   *
   * WHY THIS EXISTS. `quad` pushes four fresh vertices per quad so that every face
   * can carry its own flat normal, which is what gives the chamfers their hard
   * highlight. The cost is that nothing in the mesh knows where an edge is, or
   * which side of one it is on. So edge wear was faked as
   * `smoothstep(0.55, 1.0, grain)` on a noise field -- bright metal wherever the
   * noise happened to peak, which is not where a machine actually wears.
   *
   * WELDED FOR DATA ONLY, NOT FOR GEOMETRY. Vertices are never merged and normals
   * are never averaged: doing either would round off the chamfers and lose the
   * hard-surface read that `docs/art-direction.md` section 7 depends on. The weld
   * exists purely to answer two questions per position, which are then written back
   * to every vertex sharing it.
   */
  private weldedSurfaceFields(): { curvature: number[]; occlusion: number[] } {
    const vertexCount = this.pos.length / 3;

    // Positions are keyed as ONE PACKED NUMBER, not as a formatted string.
    //
    // The obvious version builds a `${x},${y},${z}` key per vertex, and measured on
    // the full roster -- twelve mechs across two factions plus twenty-four
    // structures, about 150k vertices -- that cost 104 ms of a 142 ms build. It is
    // the same allocation fault as the boxed sort in Task 8, in a different costume.
    //
    // Quantising to a millimetre over a +/-64 m range is 17 bits an axis and 51
    // bits for the three, which a float64 holds exactly. A millimetre is far below
    // any feature on this geometry, where the smallest greeble is around 0.1 m, and
    // the positions that need to match are usually bit-identical anyway because
    // they were computed by the same expression.
    const quantum = 1_000;
    const bias = 64 * quantum;
    const axisSpan = bias * 2;
    const keyOf = (vertex: number): number => {
      const x = Math.round(this.pos[vertex * 3]! * quantum) + bias;
      const y = Math.round(this.pos[vertex * 3 + 1]! * quantum) + bias;
      const z = Math.round(this.pos[vertex * 3 + 2]! * quantum) + bias;
      return (x * axisSpan + y) * axisSpan + z;
    };

    // Position groups, their summed face normal, and their neighbours.
    const groupOf = new Int32Array(vertexCount);
    const groups = new Map<number, number>();
    const normalSum: number[] = [];
    const groupVertex: number[] = [];
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const key = keyOf(vertex);
      let group = groups.get(key);
      if (group === undefined) {
        group = groupVertex.length;
        groups.set(key, group);
        groupVertex.push(vertex);
        normalSum.push(0, 0, 0);
      }
      groupOf[vertex] = group;
      normalSum[group * 3] = normalSum[group * 3]! + this.nrm[vertex * 3]!;
      normalSum[group * 3 + 1] = normalSum[group * 3 + 1]! + this.nrm[vertex * 3 + 1]!;
      normalSum[group * 3 + 2] = normalSum[group * 3 + 2]! + this.nrm[vertex * 3 + 2]!;
    }

    const groupCount = groupVertex.length;
    // Adjacency in compressed-row form: a count pass, a prefix sum, then a fill.
    // Not deduplicated, and not by accident -- a neighbour shared by two triangles
    // is listed twice, which weights the curvature mean by incident area rather
    // than by neighbour count. It is also the reason this can be flat typed arrays
    // instead of a Set per group, which is where this pass used to spend its time.
    const degree = new Int32Array(groupCount + 1);
    const triangleGroups = new Int32Array(this.idx.length);
    for (let at = 0; at < this.idx.length; at++) triangleGroups[at] = groupOf[this.idx[at]!]!;
    for (let triangle = 0; triangle < triangleGroups.length; triangle += 3) {
      degree[triangleGroups[triangle]!]! += 2;
      degree[triangleGroups[triangle + 1]!]! += 2;
      degree[triangleGroups[triangle + 2]!]! += 2;
    }
    const start = new Int32Array(groupCount + 1);
    for (let group = 0; group < groupCount; group++) start[group + 1] = start[group]! + degree[group]!;
    const cursor = start.slice();
    const adjacency = new Int32Array(start[groupCount]!);
    for (let triangle = 0; triangle < triangleGroups.length; triangle += 3) {
      const a = triangleGroups[triangle]!;
      const b = triangleGroups[triangle + 1]!;
      const c = triangleGroups[triangle + 2]!;
      adjacency[cursor[a]!++] = b; adjacency[cursor[a]!++] = c;
      adjacency[cursor[b]!++] = a; adjacency[cursor[b]!++] = c;
      adjacency[cursor[c]!++] = a; adjacency[cursor[c]!++] = b;
    }

    // Convexity: the mean, over the ring of neighbours, of how far this position
    // stands out along its own averaged normal. A chamfer corner sticks out past
    // its neighbours and comes out positive; the floor of a panel channel is set
    // back behind them and comes out negative.
    const groupCurvature = new Float32Array(groupCount);
    for (let group = 0; group < groupCount; group++) {
      const vertex = groupVertex[group]!;
      let nx = normalSum[group * 3]!;
      let ny = normalSum[group * 3 + 1]!;
      let nz = normalSum[group * 3 + 2]!;
      const length = Math.hypot(nx, ny, nz);
      if (length < 1e-6) continue;
      nx /= length; ny /= length; nz /= length;

      const px = this.pos[vertex * 3]!;
      const py = this.pos[vertex * 3 + 1]!;
      const pz = this.pos[vertex * 3 + 2]!;
      let sum = 0;
      let count = 0;
      for (let slot = start[group]!; slot < start[group + 1]!; slot++) {
        const at = groupVertex[adjacency[slot]!]!;
        const dx = px - this.pos[at * 3]!;
        const dy = py - this.pos[at * 3 + 1]!;
        const dz = pz - this.pos[at * 3 + 2]!;
        const span = Math.hypot(dx, dy, dz);
        if (span < 1e-6) continue;
        sum += (dx * nx + dy * ny + dz * nz) / span;
        count++;
      }
      // Scaled up because a chamfer band is shallow: raw values on real hull
      // geometry sit around a tenth, and the shader wants a 0..1 signal.
      if (count > 0) groupCurvature[group] = clampNumber((sum / count) * 3.2, -1, 1);
    }

    const groupOcclusion = this.groupOcclusion(groupVertex);

    const curvature = new Array<number>(vertexCount);
    const occlusion = new Array<number>(vertexCount);
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const group = groupOf[vertex]!;
      curvature[vertex] = groupCurvature[group]!;
      occlusion[vertex] = groupOcclusion[group]!;
    }
    return { curvature, occlusion };
  }

  /**
   * Ambient occlusion per position, from a coarse occupancy grid.
   *
   * CURVATURE WOULD NOT HAVE ANSWERED THIS. Convexity is local to the surface, so
   * it knows a channel floor is recessed but has no idea that a greeble box is
   * sitting on the plate next to it, or that a ram runs down the outside of a
   * thigh. Those are the contacts that actually read as assembled hardware, and
   * they need to know about geometry that is nearby rather than adjacent.
   *
   * Triangle centroids are dropped into a 24-cube grid over the part's bounds, and
   * each position then probes a short distance along its own normal and around it.
   * A ray cast against every triangle would be exact and is not affordable at load
   * for six mech classes and twelve structures; an occupancy probe is a few
   * thousand integer lookups a part and lands the shading in the same places.
   */
  private groupOcclusion(groupVertex: number[]): Float32Array {
    const groupCount = groupVertex.length;
    const occlusion = new Float32Array(groupCount).fill(1);
    if (this.idx.length === 0) return occlusion;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let vertex = 0; vertex < this.pos.length; vertex += 3) {
      const x = this.pos[vertex]!, y = this.pos[vertex + 1]!, z = this.pos[vertex + 2]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const resolution = 24;
    const spanX = Math.max(maxX - minX, 1e-3);
    const spanY = Math.max(maxY - minY, 1e-3);
    const spanZ = Math.max(maxZ - minZ, 1e-3);
    const cell = Math.max(spanX, spanY, spanZ) / resolution;

    const occupied = new Uint8Array(resolution * resolution * resolution);
    const cellIndex = (x: number, y: number, z: number): number => {
      const i = Math.min(resolution - 1, Math.max(0, Math.floor((x - minX) / spanX * (resolution - 1))));
      const j = Math.min(resolution - 1, Math.max(0, Math.floor((y - minY) / spanY * (resolution - 1))));
      const k = Math.min(resolution - 1, Math.max(0, Math.floor((z - minZ) / spanZ * (resolution - 1))));
      return (k * resolution + j) * resolution + i;
    };
    for (let triangle = 0; triangle < this.idx.length; triangle += 3) {
      let cx = 0, cy = 0, cz = 0;
      for (let corner = 0; corner < 3; corner++) {
        const at = this.idx[triangle + corner]!;
        cx += this.pos[at * 3]!; cy += this.pos[at * 3 + 1]!; cz += this.pos[at * 3 + 2]!;
      }
      occupied[cellIndex(cx / 3, cy / 3, cz / 3)] = 1;
    }

    // Probe directions in the upper hemisphere of the vertex normal, plus the
    // normal itself. Few enough to be cheap, spread enough to notice a neighbour.
    const probes: Array<[number, number, number]> = [
      [0, 1, 0], [0.82, 0.57, 0], [-0.82, 0.57, 0], [0, 0.57, 0.82], [0, 0.57, -0.82],
      [0.58, 0.58, 0.58], [-0.58, 0.58, 0.58], [0.58, 0.58, -0.58], [-0.58, 0.58, -0.58],
    ];
    const reach = cell * 2.2;

    for (let group = 0; group < groupCount; group++) {
      const vertex = groupVertex[group]!;
      const px = this.pos[vertex * 3]!;
      const py = this.pos[vertex * 3 + 1]!;
      const pz = this.pos[vertex * 3 + 2]!;
      let nx = this.nrm[vertex * 3]!;
      let ny = this.nrm[vertex * 3 + 1]!;
      let nz = this.nrm[vertex * 3 + 2]!;
      const length = Math.hypot(nx, ny, nz);
      if (length < 1e-6) continue;
      nx /= length; ny /= length; nz /= length;

      // Rotate the probe set so its pole follows the normal.
      let tx: number, ty: number, tz: number;
      if (Math.abs(ny) < 0.99) { tx = -nz; ty = 0; tz = nx; } else { tx = 1; ty = 0; tz = 0; }
      const tLength = Math.hypot(tx, ty, tz) || 1;
      tx /= tLength; ty /= tLength; tz /= tLength;
      const bx = ny * tz - nz * ty;
      const by = nz * tx - nx * tz;
      const bz = nx * ty - ny * tx;

      let blocked = 0;
      for (const [ax, ay, az] of probes) {
        const dx = tx * ax + nx * ay + bx * az;
        const dy = ty * ax + ny * ay + by * az;
        const dz = tz * ax + nz * ay + bz * az;
        // Two steps out, so a surface one cell away registers and the vertex's own
        // cell does not count against it.
        let hit = false;
        for (let step = 1; step <= 2; step++) {
          const distance = reach * step * 0.5;
          if (occupied[cellIndex(px + dx * distance, py + dy * distance, pz + dz * distance)] === 1) {
            hit = true;
            break;
          }
        }
        if (hit) blocked++;
      }
      // Never fully dark: this is a contact shading term, not a light block.
      occlusion[group] = 1 - (blocked / probes.length) * 0.55;
    }

    return occlusion;
  }
}

function clampNumber(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _m = new THREE.Matrix4();

export interface BlockSpec {
  size: [number, number, number];
  pos?: [number, number, number];
  /** Fraction of the smallest dimension chamfered off each edge, 0..0.35. */
  bevel?: number;
  /** Top face scale relative to the bottom, for wedge shapes. */
  taper?: number;
  /** Skew the top face along x/z, for leaning forms. */
  lean?: [number, number];
  mask?: number;
  /** Horizontal inset channels ringing the four side faces. */
  panels?: number;
  /**
   * Per-plate offset jitter, 0..1, so the divisions do not read as a regular
   * grid. Needs `panelSeed` to be deterministic.
   */
  panelVariation?: number;
  panelSeed?: number;
}

/**
 * A bevelled, optionally tapered box.
 *
 * Built as an explicit vertex ring rather than by CSG: two rectangles (bottom
 * and top), each inset by the bevel amount, plus chamfer bands between them.
 * Cheap, watertight, and the chamfers give every silhouette edge a highlight.
 */
function addBlock(mb: MeshBuilder, spec: BlockSpec): void {
  const [sx, sy, sz] = spec.size;
  const [px, py, pz] = spec.pos ?? [0, 0, 0];
  const taper = spec.taper ?? 1;
  const [lx, lz] = spec.lean ?? [0, 0];
  const mask = spec.mask ?? MASK_HULL;
  const b = Math.min(sx, sy, sz) * Math.min(spec.bevel ?? 0.12, 0.35);

  const hx = sx / 2;
  const hz = sz / 2;
  const txw = hx * taper;
  const tzw = hz * taper;

  // Four corner columns: [bottom-inset, bottom-full, top-full, top-inset]
  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  const ring = (yOff: number, xw: number, zw: number, inset: number, ox: number, oz: number) =>
    corners.map(([cx, cz]) =>
      new THREE.Vector3(
        px + ox + cx * Math.max(xw - inset, 0.001),
        py + yOff,
        pz + oz + cz * Math.max(zw - inset, 0.001),
      ),
    );

  const r0 = ring(0, hx, hz, b, 0, 0); // bottom, inset
  const r1 = ring(b, hx, hz, 0, 0, 0); // bottom of the straight section
  const r2 = ring(sy - b, txw, tzw, 0, lx, lz); // top of the straight section
  const r3 = ring(sy, txw, tzw, b, lx, lz); // top, inset

  // Bottom cap, top cap.
  mb.quad(r0[3]!, r0[2]!, r0[1]!, r0[0]!, mask);
  mb.quad(r3[0]!, r3[1]!, r3[2]!, r3[3]!, mask);

  // Chamfer bands, top and bottom. The main wall between them is emitted by
  // addPanelledWall, which subdivides it around any inset channels.
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    mb.quad(r0[i]!, r0[j]!, r1[j]!, r1[i]!, mask);
    mb.quad(r2[i]!, r2[j]!, r3[j]!, r3[i]!, mask);
  }

  const centre = new THREE.Vector3(px + lx * 0.5, 0, pz + lz * 0.5);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    addPanelledWall(mb, r1[i]!, r1[j]!, r2[j]!, r2[i]!, centre, mask, spec);
  }
}

/**
 * One side wall of a block, subdivided around its inset channels.
 *
 * WHY THIS REPLACED A FLOATING STRIP. The previous version emitted the wall as a
 * single quad and then a second quad pulled slightly inward across it. That is
 * not a channel: the wall still spans the full height, so the strip sits behind
 * solid geometry, and the two coplanar-ish surfaces have no side walls between
 * them. It read as a faint tone change rather than as a groove, and having no
 * concave geometry it could not catch the occlusion Task 4 and Task 10 added.
 *
 * A real channel needs the wall broken into bands with gaps where the channels
 * go, and each channel closed with two lips and a floor. That is three quads a
 * channel plus one a band, so a wall with N horizontal channels is 5N+1 quads
 * against the 2 it used to be. The cost is real and is paid for out of the
 * greeble budget in PROFILES, which is a good exchange: a channel reads as
 * machined surface, a scattered box reads as noise.
 */
function addPanelledWall(
  mb: MeshBuilder,
  bottomLeft: THREE.Vector3,
  bottomRight: THREE.Vector3,
  topRight: THREE.Vector3,
  topLeft: THREE.Vector3,
  centre: THREE.Vector3,
  mask: number,
  spec: BlockSpec,
): void {
  // HORIZONTAL CHANNELS ONLY, and identical on every face.
  //
  // Vertical divisions were attempted and withdrawn. The reason is structural
  // rather than a matter of taste, so it is recorded here.
  //
  // A horizontal channel closes cleanly. It splits the wall into bands whose side
  // edges run up the block's corners, where they meet the neighbouring face's
  // bands exactly, and whose top and bottom edges span the full face width, where
  // they meet the single-quad chamfer bands exactly.
  //
  // A vertical channel does neither. Its bands are split across the width, so the
  // wall's boundary at the chamfer is subdivided while the chamfer quad is not --
  // a T-junction, which is a hole. Closing it means subdividing the chamfer bands
  // to match, and cutting both axes into one face additionally means matching
  // every lip to its neighbour's subdivision in both axes, per band. That is a
  // genuine 2D subdivision of the whole block rather than a small addition, and
  // the read it buys is modest next to the horizontal channels, because plate
  // joins on armour are dominated by the horizontal run. Left out rather than
  // shipped leaking.
  const channelCount = Math.max(0, Math.floor(spec.panels ?? 0));
  if (channelCount === 0) {
    mb.quad(bottomLeft, bottomRight, topRight, topLeft, mask);
    return;
  }

  const [sx, , sz] = spec.size;
  // Channel width as a fraction of the wall, and depth in metres. Depth is
  // clamped so a channel in a thin plate cannot punch through the far side.
  const span = Math.min(sx, sz);
  const halfWidth = 0.055;
  const depth = Math.min(span * 0.06, span * 0.24);
  const jitter = Math.min(Math.max(spec.panelVariation ?? 0, 0), 1);
  // PER BLOCK, NOT PER FACE. Seeding this with the face index was the other hole
  // the watertightness test found: each face then put its channel at a slightly
  // different height, so the band edges meeting at a corner spanned different
  // ranges and nothing paired. It was also wrong to look at -- a channel machined
  // into a housing continues around the corner, it does not step at every edge.
  const seed = spec.panelSeed ?? 0;

  // Deterministic per-plate offset, so a run of plates is irregular but repeats
  // exactly for a given seed.
  const offsetAt = (index: number): number => {
    if (jitter <= 0) return 0;
    const hashed = Math.sin((seed + index * 31.7) * 12.9898) * 43758.5453;
    return (hashed - Math.floor(hashed) - 0.5) * jitter * 0.16;
  };

  // Bilinear point on the wall: u across, v up.
  const at = (u: number, v: number): THREE.Vector3 => {
    const bottom = new THREE.Vector3().lerpVectors(bottomLeft, bottomRight, u);
    const top = new THREE.Vector3().lerpVectors(topLeft, topRight, u);
    return bottom.lerp(top, v);
  };
  const sunk = (u: number, v: number): THREE.Vector3 => {
    const point = at(u, v);
    // Inward along the horizontal direction to the block's axis, so the floor of
    // the channel stays parallel to the wall it is cut into.
    const inward = new THREE.Vector3(centre.x - point.x, 0, centre.z - point.z);
    const length = Math.hypot(inward.x, inward.z);
    if (length > 1e-5) point.addScaledVector(inward.multiplyScalar(1 / length), depth);
    return point;
  };

  const centres: number[] = [];
  for (let c = 1; c <= channelCount; c++) centres.push(c / (channelCount + 1) + offsetAt(c));

  // Flat bands between the channels, each spanning the full face width so its top
  // and bottom edges pair with the chamfer quads and its side edges pair with the
  // neighbouring face.
  let cursor = 0;
  for (const centre of centres) {
    const low = Math.max(cursor, centre - halfWidth);
    if (low > cursor) mb.quad(at(0, cursor), at(1, cursor), at(1, low), at(0, low), mask);
    cursor = Math.min(1, centre + halfWidth);
  }
  if (cursor < 1) mb.quad(at(0, cursor), at(1, cursor), at(1, 1), at(0, 1), mask);

  // The channels themselves: a recessed floor and the two lips that make it a
  // channel rather than a plate. No end caps needed, because the channel runs the
  // full width of the face and continues into the neighbouring face's channel at
  // the same height, closing around the block.
  for (const centre of centres) {
    const low = Math.max(0, centre - halfWidth);
    const high = Math.min(1, centre + halfWidth);
    if (high - low < 1e-4) continue;
    mb.quad(sunk(0, low), sunk(1, low), sunk(1, high), sunk(0, high), MASK_RECESS);
    mb.quad(at(0, low), at(1, low), sunk(1, low), sunk(0, low), MASK_RECESS);
    mb.quad(sunk(0, high), sunk(1, high), at(1, high), at(0, high), MASK_RECESS);
  }
}



/**
 * Detail tier for greeble passes.
 *
 * `full` is what a mech in front of the camera gets. `reduced` drops the smallest
 * forms and thins the count, and `silhouette` keeps only what changes the outline.
 * Task 11 introduces the parameter and every caller asks for `full`; Task 13 is
 * what will select between them per LOD. Adding it here rather than there keeps
 * the LOD work from having to reshape this function while also building a mesh
 * cache around it.
 */
export type GreebleTier = 'full' | 'reduced' | 'silhouette';

export interface GreebleOptions {
  /**
   * Where detail is worth spending. Greebles cluster toward these heights as
   * fractions of the volume, which is what puts hardware at joints and vents
   * instead of scattering it evenly over a flat plate. An even scatter is the
   * thing that reads as noise.
   */
  clusters?: number[];
  tier?: GreebleTier;
  /** Fraction that come out as cylinders or pipes rather than boxes. */
  roundFraction?: number;
}

/** Scatter small hardware over the top and sides of a volume. */
function addGreebles(
  mb: MeshBuilder,
  bounds: [number, number, number],
  origin: [number, number, number],
  count: number,
  rng: Rng,
  options: GreebleOptions = {},
): void {
  const [sx, sy, sz] = bounds;
  const tier = options.tier ?? 'full';
  const clusters = options.clusters ?? [];
  const roundFraction = options.roundFraction ?? 0.28;

  const effective = tier === 'full' ? count : tier === 'reduced' ? Math.ceil(count * 0.5) : Math.ceil(count * 0.2);
  // Below this fraction of the volume a greeble is smaller than a pixel at
  // tactical range, so at reduced tiers it is cost with no read.
  const minimumScale = tier === 'full' ? 0.08 : 0.16;

  for (let i = 0; i < effective; i++) {
    const w = rng.range(minimumScale, 0.26) * Math.min(sx, sz);
    const h = rng.range(0.04, 0.16) * sy;

    // Pull the height toward a cluster when there is one, leaving some scatter so
    // the result does not read as a row of identical fittings.
    let heightFraction = rng.range(0.15, 0.8);
    if (clusters.length > 0 && rng.chance(0.72)) {
      const target = clusters[rng.int(0, clusters.length - 1)]!;
      heightFraction = Math.min(1, Math.max(0, target + rng.signed() * 0.09));
    }

    const round = rng.chance(roundFraction);
    const onTop = rng.chance(0.45);

    if (onTop) {
      const pos: [number, number, number] = [
        origin[0] + rng.signed() * sx * 0.34,
        origin[1] + sy,
        origin[2] + rng.signed() * sz * 0.34,
      ];
      if (round) {
        // A short stack reads as a vent or a capped port.
        addCylinder(mb, w * 0.5, h * 1.4, pos, tier === 'full' ? 8 : 6, MASK_METAL, w * 0.42);
        if (rng.chance(0.4)) {
          addCylinder(mb, w * 0.56, h * 0.3, [pos[0], pos[1] + h * 1.4, pos[2]], 6, MASK_EMISSIVE);
        }
      } else {
        addBlock(mb, {
          size: [w, h, w * rng.range(0.6, 1.6)],
          pos,
          bevel: 0.2,
          mask: rng.chance(0.16) ? MASK_EMISSIVE : MASK_METAL,
        });
      }
      continue;
    }

    const side = rng.int(0, 1);
    const off = rng.chance(0.5) ? 1 : -1;
    const pos: [number, number, number] = [
      origin[0] + (side === 0 ? off * sx * 0.5 : rng.signed() * sx * 0.32),
      origin[1] + heightFraction * sy,
      origin[2] + (side === 1 ? off * sz * 0.5 : rng.signed() * sz * 0.32),
    ];

    if (round) {
      // A pipe run down the flank, following the surface rather than sitting on it.
      const length = rng.range(0.16, 0.42) * sy;
      const from = new THREE.Vector3(pos[0], pos[1], pos[2]);
      const to = new THREE.Vector3(pos[0], pos[1] - length, pos[2]);
      addTube(mb, [from, to], w * 0.24, tier === 'full' ? 6 : 5, MASK_METAL);
      continue;
    }

    addBlock(mb, {
      size: side === 0 ? [w * 0.4, h, w] : [w, h, w * 0.4],
      pos,
      bevel: 0.22,
      mask: rng.chance(0.2) ? MASK_EMISSIVE : MASK_METAL,
    });
  }
}

/**
 * A hydraulic ram: a cylinder body with a narrower rod emerging from it.
 *
 * Actuators are the single clearest "this is a machine that moves" cue on a walker,
 * and there was exactly one on the whole mech, alongside the thigh. Joints without
 * visible hardware read as if the limbs are simply glued together.
 */
function addRam(
  mb: MeshBuilder,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  segments = 5,
): void {
  const axis = new THREE.Vector3().subVectors(to, from);
  const length = axis.length();
  if (length < 1e-4) return;
  axis.multiplyScalar(1 / length);

  // Body over the lower 62%, rod over the rest, so the joint reads as extended.
  //
  // Two tubes, not three. An earlier version added a collar ring where the rod
  // leaves the body, which is the detail that would catch a highlight -- but a ram
  // on an 11 m mech is a few pixels across at tactical range, the collar was never
  // going to resolve, and the third tube took the frozen Low frame budget from a
  // 16.8 ms p95 to 33.3 ms. The step change in mask between body and rod does the
  // same job for nothing.
  const bodyEnd = new THREE.Vector3().copy(from).addScaledVector(axis, length * 0.62);
  addTube(mb, [from, bodyEnd], radius, segments, MASK_METAL);
  addTube(mb, [bodyEnd, to], radius * 0.52, segments, MASK_HULL);
}

/** A cylinder, for pistons, barrels and masts. */
function addCylinder(
  mb: MeshBuilder,
  radius: number,
  height: number,
  pos: [number, number, number],
  segments: number,
  mask: number,
  topRadius = radius,
): void {
  const [px, py, pz] = pos;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    mb.quad(
      new THREE.Vector3(px + c0 * radius, py, pz + s0 * radius),
      new THREE.Vector3(px + c1 * radius, py, pz + s1 * radius),
      new THREE.Vector3(px + c1 * topRadius, py + height, pz + s1 * topRadius),
      new THREE.Vector3(px + c0 * topRadius, py + height, pz + s0 * topRadius),
      mask,
    );
    // Caps, both ends. The bottom one used to be missing, which left every
    // cylinder in the game open: a piston seen from below, or any of the ones
    // mounted clear of a hull, showed its inside face and read as a hole. It also
    // meant no cylinder was watertight, so the geometry could not be checked.
    mb.triangle(
      new THREE.Vector3(px, py + height, pz),
      new THREE.Vector3(px + c0 * topRadius, py + height, pz + s0 * topRadius),
      new THREE.Vector3(px + c1 * topRadius, py + height, pz + s1 * topRadius),
      mask,
    );
    mb.triangle(
      new THREE.Vector3(px, py, pz),
      new THREE.Vector3(px + c1 * radius, py, pz + s1 * radius),
      new THREE.Vector3(px + c0 * radius, py, pz + s0 * radius),
      mask,
    );
  }
}

/**
 * A tube swept along a polyline, for trim and piping.
 *
 * Each segment gets its own ring, oriented by the segment direction, and rings
 * are joined by quads. Corners are mitred by averaging the two adjacent segment
 * directions, which keeps a bend from pinching.
 *
 * Piping is worth its triangles because it does something no box can: it crosses
 * between parts and follows the chassis, which is what reads as a machine that was
 * assembled rather than a pile of blocks. `docs/art-direction.md` section 7 wants
 * silhouette first, so these are routed along edges where they break the outline.
 */
function addTube(
  mb: MeshBuilder,
  path: THREE.Vector3[],
  radius: number,
  segments: number,
  mask: number,
): void {
  if (path.length < 2 || segments < 3) return;

  // Per-node frame. A reference axis that is never parallel to the direction keeps
  // the basis stable through a bend.
  const rings: THREE.Vector3[][] = [];
  for (let index = 0; index < path.length; index++) {
    const previous = path[Math.max(0, index - 1)]!;
    const next = path[Math.min(path.length - 1, index + 1)]!;
    const direction = new THREE.Vector3().subVectors(next, previous);
    if (direction.lengthSq() < 1e-10) direction.set(0, 1, 0);
    direction.normalize();

    const reference = Math.abs(direction.y) < 0.95
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    const tangent = new THREE.Vector3().crossVectors(direction, reference).normalize();
    const bitangent = new THREE.Vector3().crossVectors(direction, tangent).normalize();

    const ring: THREE.Vector3[] = [];
    for (let step = 0; step < segments; step++) {
      const angle = (step / segments) * Math.PI * 2;
      ring.push(new THREE.Vector3()
        .copy(path[index]!)
        .addScaledVector(tangent, Math.cos(angle) * radius)
        .addScaledVector(bitangent, Math.sin(angle) * radius));
    }
    rings.push(ring);
  }

  for (let index = 0; index < rings.length - 1; index++) {
    const a = rings[index]!;
    const b = rings[index + 1]!;
    for (let step = 0; step < segments; step++) {
      const next = (step + 1) % segments;
      mb.quad(a[step]!, a[next]!, b[next]!, b[step]!, mask);
    }
  }

  // Close both ends, so a tube is watertight like every other primitive.
  const first = rings[0]!;
  const last = rings[rings.length - 1]!;
  for (let step = 0; step < segments; step++) {
    const next = (step + 1) % segments;
    mb.triangle(path[0]!, first[next]!, first[step]!, mask);
    mb.triangle(path[path.length - 1]!, last[step]!, last[next]!, mask);
  }
}

// ---------------------------------------------------------------------------
// Shared hull material
// ---------------------------------------------------------------------------

export interface HullUniforms {
  uFaction: { value: THREE.Color };
  uFactionStyle: { value: number };
  uEmissive: { value: number };
  uDamage: { value: number };
  uTime: { value: number };
  uLowQuality: { value: number };
}

/**
 * One material for every mech and structure in the game.
 *
 * Reads `aMask` to pick a surface, then adds procedural wear: edge highlights
 * from the vertex normal, downward grime streaks, and a faction-coloured
 * emissive on the tagged faces. Extends MeshStandardMaterial so shadows, fog
 * and tone mapping keep working.
 */
export type FactionStyle = 'compact' | 'choir' | 'neutral';

export function makeHullMaterial(factionColor: number, factionStyle = 0): {
  material: THREE.MeshStandardMaterial;
  uniforms: HullUniforms;
} {
  const uniforms: HullUniforms = {
    uFaction: { value: new THREE.Color(factionColor) },
    uFactionStyle: { value: factionStyle },
    uEmissive: { value: 1 },
    uDamage: { value: 0 },
    uTime: { value: 0 },
    uLowQuality: { value: 0 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.58,
    // Fully metallic surfaces go black without an environment map to reflect.
    // Backing off to a semi-metal keeps the diffuse term doing real work while
    // still catching a specular highlight along every chamfer.
    metalness: 0.35,
    dithering: true,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aMask;
         // Welded per-vertex convexity (x) and contact occlusion (y). See
         // MeshBuilder.weldedSurfaceFields.
         attribute vec2 aSurfaceField;
         #ifdef USE_INSTANCING
         attribute float instanceDamage;
         // x is animation phase, y is weathering. Packed into one attribute
         // because every instanced attribute costs a buffer upload per frame; see
         // withInstanceDamage in entityRenderer.ts.
         attribute vec2 instanceVariation;
         #endif
         varying float vMask;
         // Convexity, contact occlusion, per-unit weathering. One varying, for the
         // same reason the attribute is one: interpolator slots are not free on the
         // hardware the Low budget is frozen against.
         varying vec3 vWear;
         varying vec3 vObjPos;
         varying vec3 vObjNormal;
         varying vec3 vViewTangent;
         varying vec3 vViewBitangent;
         varying float vInstanceDamage;
         varying float vInstancePhase;
         // Deterministic tangent basis from a normal alone. Recomputed identically
         // in the fragment stage, which is what lets an object-space gradient be
         // rotated into view space without a tangent attribute.
         void rww_basis(vec3 n, out vec3 t, out vec3 b) {
           vec3 reference = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
           t = normalize(cross(n, reference));
           b = cross(n, t);
         }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vMask = aMask;
         vObjPos = position;
         // Object-space normal, carried so the fragment stage can project surface
         // detail triplanar without needing UVs or tangents. Generated hull parts
         // have neither.
         vObjNormal = normal;
         {
           // normalMatrix exists only in the vertex prefix, so the object basis is
           // rotated to view space here and interpolated.
           vec3 basisT;
           vec3 basisB;
           rww_basis(normalize(normal), basisT, basisB);
           vViewTangent = normalize(normalMatrix * basisT);
           vViewBitangent = normalize(normalMatrix * basisB);
         }
         vInstanceDamage = 0.0;
         vInstancePhase = 0.0;
         // A mid weathering value, so a non-instanced mech on the contact sheet is
         // weathered like an average one rather than like a factory-fresh one.
         vWear = vec3(aSurfaceField, 0.5);
         #ifdef USE_INSTANCING
         vInstanceDamage = instanceDamage;
         vInstancePhase = instanceVariation.x;
         vWear.z = instanceVariation.y;
         #endif`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uFaction;
         uniform float uFactionStyle;
         uniform float uEmissive;
         uniform float uDamage;
         uniform float uTime;
         uniform float uLowQuality;
         varying float vMask;
         varying vec3 vObjPos;
         varying vec3 vObjNormal;
         varying vec3 vViewTangent;
         varying vec3 vViewBitangent;
         varying float vInstanceDamage;
         varying float vInstancePhase;
         varying vec3 vWear;
         void rww_basis(vec3 n, out vec3 t, out vec3 b) {
           vec3 reference = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
           t = normalize(cross(n, reference));
           b = cross(n, t);
         }
         float rww_damage() { return max(uDamage, vInstanceDamage); }
         // Noise, projection and wear come from the shared surface library, so a
         // hull scratch and a terrain crack are built from the same vocabulary.
         // The former hs_hash and hs_noise are rww_hash31 and rww_vnoise3, moved
         // verbatim. See src/render/materials/surface.glsl.ts.
         ${SURFACE_GLSL}

         /**
          * Height field for hull surface relief: recessed panel channels plus a
          * fine cast grain. Sampled four times per fragment to build a gradient,
          * so it is deliberately cheap.
          *
          * Two panel scales, matching the terrain's structural-bay and deck-plate
          * pair, so a mech standing on the deck shares its surface rhythm.
          */
         float rww_hullSurfaceField(vec3 position, vec3 objectNormal) {
           // Frequencies are deliberately low. A first pass used a 1.15 plate scale
           // and 5.5 grain, which put features around 0.2 m on a mech roughly 100
           // pixels tall at tactical zoom: sub-pixel, so it aliased into speckle and
           // read as crust rather than as machining. docs/art-direction.md section 7
           // is explicit that at RTS zoom the player sees shapes, not normal maps.
           // At these scales a bay band is about 2.9 m and a plate about 1.4 m, so
           // both survive to screen.
           float bay = rww_triplanarPanels(position, objectNormal, 0.34, 0.030, 4.0);
           float plate = rww_triplanarPanels(position, objectNormal, 0.70, 0.040, 4.0);
           float grain = rww_triplanarFbm(position, objectNormal, 2.0, 2, 4.0);
           return bay * 0.68 + plate * 0.32 + grain * 0.04;
         }`,
      )
      .replace(
        '#include <map_fragment>',
        `
        float m = vMask;
        // Machines are painted a mid grey, not black. Dark hulls look striking
        // in isolation and then disappear into terrain at RTS range, where the
        // player needs to identify a unit in well under a second.
        vec3 hull  = vec3(0.230, 0.238, 0.252);
        vec3 metal = vec3(0.330, 0.322, 0.305);
        vec3 recess = vec3(0.075, 0.080, 0.090);
        hull = mix(hull, vec3(0.275, 0.225, 0.180), max(-uFactionStyle, 0.0) * 0.42);
        hull = mix(hull, vec3(0.175, 0.235, 0.265), max(uFactionStyle, 0.0) * 0.42);

        vec3 base = hull;
        base = mix(base, metal, step(2.5, m));
        base = mix(base, recess, step(1.5, m) * step(m, 2.5));
        if (uLowQuality > 0.5) {
          base *= 0.92 + clamp(vNormal.y, 0.0, 1.0) * 0.08;
          base = mix(base, base * vec3(0.42, 0.38, 0.36), rww_damage() * 0.75);
        } else {
          // Fine cast-metal grain, plus larger blotches of discoloration.
          float grain = rww_vnoise3(vObjPos * 26.0);
          float blotch = rww_vnoise3(vObjPos * 2.4);
          base *= 0.82 + 0.36 * grain;

          // Grime collects on upward faces and streaks down vertical ones.
          float up = clamp(vNormal.y, 0.0, 1.0);
          base = mix(base, base * vec3(0.72, 0.70, 0.66), up * 0.35 * (0.4 + blotch));
          float streak = rww_vnoise3(vec3(vObjPos.x * 30.0, vObjPos.y * 2.5, vObjPos.z * 30.0));
          base *= 1.0 - (1.0 - up) * streak * 0.22;

          // Edge wear, from real convexity rather than from a noise threshold.
          //
          // This used to be smoothstep(0.55, 1.0, grain): bare metal wherever the
          // cast-grain noise happened to peak, which put bright scuffing in the
          // middle of flat plates and left the chamfers -- the only places a machine
          // actually rubs -- exactly as painted as everything else.
          //
          // aCurvature comes from the weld pass and is positive on convex edges, so
          // the wear now lands on the chamfers by construction. Broken up by the
          // grain so it does not read as a uniform outline, and scaled per instance
          // so a lance of the same class is not a row of clones.
          float wearAmount = 0.22 + 0.30 * vWear.z;
          float wear = rww_edgeWear(vWear.x, grain, wearAmount);
          base = mix(base, vec3(0.52, 0.50, 0.47), wear);

          // Grime and shading in the concave half, which is the same field read the
          // other way. Recesses collect dirt; that is the pairing
          // docs/procedural-assets.md section 2 calls out.
          base *= 1.0 - rww_cavityGrime(vWear.x, 0.34 + 0.2 * blotch);

          // Contact occlusion from the weld pass: where a greeble sits on a plate or
          // a ram runs down a thigh, the crease between them darkens. Curvature
          // cannot see this, because those surfaces are near each other without
          // being adjacent.
          base *= mix(1.0, vWear.y, 0.85);

          // Cavity darkening in the panel channels, from the same field that
          // drives the normal perturbation, so shading and relief agree.
          float channel = rww_triplanarPanels(vObjPos, normalize(vObjNormal), 0.34, 0.030, 4.0);
          base *= 1.0 - channel * 0.26;
          base = mix(base, base * vec3(0.42, 0.38, 0.36), rww_damage() * (0.35 + 0.25 * blotch));
        }

        diffuseColor.rgb *= base;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
         {
            if (uLowQuality > 0.5) roughnessFactor = 0.68 + rww_damage() * 0.2;
            else {
              float g = rww_vnoise3(vObjPos * 18.0);
              roughnessFactor = clamp(roughness - g * 0.22 + rww_damage() * 0.25, 0.16, 1.0);
            }
            roughnessFactor += max(-uFactionStyle, 0.0) * 0.07 - max(uFactionStyle, 0.0) * 0.05;
           if (vMask > 1.5 && vMask < 2.5) roughnessFactor = 0.9;
         }`,
      )
      // ---- Panel-line and grain normals -----------------------------------
      // makeHullMaterial has never injected this slot, so until now a bare hull
      // face was geometrically flat no matter how close the camera got: all of the
      // machined character came from albedo alone. docs/procedural-assets.md
      // section 2 asks for a procedural panel-line normal and AO pattern applied
      // triplanar, which is what this is.
      //
      // The perturbation is built in object space and rotated into view space at
      // the end, rather than working in tangent space. Generated hull geometry has
      // no UVs and no tangents, so a tangent-space bump has no frame to live in.
      .replace(
        '#include <normal_fragment_maps>',
        `{
           if (uLowQuality < 0.5) {
             vec3 objectNormal2 = normalize(vObjNormal);
             // Grooves plus fine cast grain in one field, so one gradient serves
             // both. Panels dominate; grain only breaks up the flats.
             float e = 0.035;
             float f0 = rww_hullSurfaceField(vObjPos, objectNormal2);
             float fx = rww_hullSurfaceField(vObjPos + vec3(e, 0.0, 0.0), objectNormal2);
             float fy = rww_hullSurfaceField(vObjPos + vec3(0.0, e, 0.0), objectNormal2);
             float fz = rww_hullSurfaceField(vObjPos + vec3(0.0, 0.0, e), objectNormal2);
             vec3 gradient = vec3(fx - f0, fy - f0, fz - f0) / e;
             // Strip the component along the normal: only the tangential part of
             // the gradient tilts the surface. Without this, flats get a spurious
             // inflation or deflation.
             gradient -= objectNormal2 * dot(gradient, objectNormal2);
             // Resolve the object-space gradient onto the same basis the vertex
             // stage rotated into view space, then perturb. Doing it this way
             // avoids needing normalMatrix here, which the fragment prefix does
             // not declare.
             vec3 basisT;
             vec3 basisB;
             rww_basis(objectNormal2, basisT, basisB);
             float alongT = dot(gradient, basisT);
             float alongB = dot(gradient, basisB);
             vec3 viewGradient = vViewTangent * alongT + vViewBitangent * alongB;
             if (length(viewGradient) > 1e-5) {
               normal = normalize(normal - normalize(viewGradient) * 0.22);
             }
           }
         }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           // Faction strips, pushed above 1.0 so the post stage's bright pass
           // finds them. This is the cheapest way to make a unit read as powered.
           //
           // The multiplier was 5.0 while no bloom pass existed, which was a
           // reasonable way to fake glow through ACES alone. With real bloom that
           // value blows the strip cores to white, which costs the faction hue at
           // exactly the pixels carrying it and swells a halo over the silhouette.
           // Both violate docs/art-direction.md sections 2 and 7. 2.2 stays clear
           // of the bright-pass threshold while keeping amber and cyan readable as
           // amber and cyan.
           float isEm = step(0.5, vMask) * step(vMask, 1.5);
             float flickerNoise = rww_vnoise3(vObjPos * 9.0 + vec3(vInstancePhase * 13.0, uTime * 2.7, 0.0));
             float flickerPulse = 0.72 + 0.28 * sin(uTime * 17.0 + vInstancePhase * 6.2831853);
             float flicker = uLowQuality > 0.5
               ? 1.0 - rww_damage() * 0.25
               : 1.0 - rww_damage() * 0.48 * step(0.55, flickerNoise) * flickerPulse;
            totalEmissiveRadiance += uFaction * isEm * uEmissive * 2.2 * flicker;
            // Exposed internals glow hot as damage rises.
             float internalGlow = uLowQuality > 0.5 ? 0.18 : step(0.82, rww_vnoise3(vObjPos * 7.0));
             totalEmissiveRadiance += vec3(1.0, 0.28, 0.06) * rww_damage() * rww_damage() * 0.24 * internalGlow;
         }`,
      );
  };

  material.customProgramCacheKey = () => 'rww-hull-v5';
  return { material, uniforms };
}

// ---------------------------------------------------------------------------
// Mechs
// ---------------------------------------------------------------------------

export type MechClass = 'vanguard' | 'longbow' | 'wisp' | 'aegis' | 'bulwark' | 'needle';

export interface MechRig {
  parts: {
    pelvis: THREE.BufferGeometry;
    torso: THREE.BufferGeometry;
    upperLeg: THREE.BufferGeometry;
    lowerLeg: THREE.BufferGeometry;
    foot: THREE.BufferGeometry;
  };
  height: number;
  radius: number;
  /** Hip separation, half-width. */
  hipOffset: number;
  /** Hip height above the ground when standing. */
  hipHeight: number;
  legUpper: number;
  legLower: number;
  /** Muzzle offsets in torso-local space. */
  muzzles: THREE.Vector3[];
}

interface MechProfile {
  height: number;
  /** Torso width, depth, height as fractions of overall height. */
  torso: [number, number, number];
  legThick: number;
  hipFrac: number;
  greebles: number;
  shoulderSpan: number;
  /** Barrel length as a fraction of height. */
  barrel: number;
  barrelRadius: number;
  /** A tall dorsal mount, for the artillery walker. */
  dorsal?: boolean;
  /** A wide dish, for the anti-air platform. */
  dish?: boolean;
}

/**
 * Proportions are expressed as fractions of the mech's standing height, which
 * keeps the four classes consistent with each other and makes rescaling a class
 * a one-number change.
 *
 * The numbers matter more than they look. An early pass had torsos 0.44 of
 * height wide with shoulders on top of that, which made every mech as wide as
 * it was tall -- from the tactical camera they read as flat gun platforms
 * rather than as walking machines. Keeping the torso narrow and the legs long
 * is what makes the silhouette say "this thing walks".
 */
const PROFILES: Record<MechClass, MechProfile> = {
  // Hunched and heavy-shouldered. Reads as a wall, but still clearly bipedal.
  vanguard: {
    height: 11,
    torso: [0.30, 0.26, 0.30],
    legThick: 0.105,
    hipFrac: 0.5,
    greebles: 10,
    shoulderSpan: 0.15,
    barrel: 0.21,
    barrelRadius: 0.024,
  },
  // Tall and back-heavy with a long dorsal artillery mount.
  longbow: {
    height: 10,
    torso: [0.24, 0.28, 0.26],
    legThick: 0.080,
    hipFrac: 0.56,
    greebles: 8,
    shoulderSpan: 0.10,
    barrel: 0.16,
    barrelRadius: 0.020,
    dorsal: true,
  },
  // Small, lean, forward-leaning. Reads as fast even standing still.
  wisp: {
    height: 7,
    torso: [0.20, 0.26, 0.22],
    legThick: 0.058,
    hipFrac: 0.60,
    greebles: 5,
    shoulderSpan: 0.085,
    barrel: 0.17,
    barrelRadius: 0.015,
  },
  // Squat and broad with a prominent interceptor array.
  aegis: {
    height: 9,
    torso: [0.29, 0.27, 0.27],
    legThick: 0.098,
    hipFrac: 0.48,
    greebles: 9,
    shoulderSpan: 0.13,
    barrel: 0.15,
    barrelRadius: 0.021,
    dish: true,
  },
  // Compact escort: broad, low, and visibly overbuilt.
  bulwark: {
    height: 12,
    torso: [0.36, 0.31, 0.31],
    legThick: 0.125,
    hipFrac: 0.48,
    greebles: 12,
    shoulderSpan: 0.19,
    barrel: 0.18,
    barrelRadius: 0.028,
  },
  // Choir hunter: narrow spear-like body and long stride.
  needle: {
    height: 8,
    torso: [0.16, 0.32, 0.20],
    legThick: 0.05,
    hipFrac: 0.64,
    greebles: 4,
    shoulderSpan: 0.055,
    barrel: 0.25,
    barrelRadius: 0.012,
  },
};

export function buildMech(cls: MechClass, seed: number, style: FactionStyle = 'neutral'): MechRig {
  const p = PROFILES[cls];
  const rng = new Rng(seed ^ 0x3ec4);
  const H = p.height;

  // Legs take roughly 60% of standing height, which is the single strongest
  // cue that a silhouette is a walker rather than a vehicle.
  const legUpper = H * 0.29;
  const legLower = H * 0.27;
  const footH = H * 0.045;
  const hipHeight = legUpper + legLower + footH;

  // ---- Pelvis -------------------------------------------------------------
  const pelvisMb = new MeshBuilder();
  const pw = H * p.torso[0] * 0.72;
  addBlock(pelvisMb, {
    size: [pw, H * 0.10, H * p.torso[1] * 0.7],
    pos: [0, -H * 0.05, 0],
    bevel: 0.22,
    panels: 1,
    panelVariation: 0.5,
    panelSeed: seed + 5,
  });
  // Waist actuators, one either side, tying the pelvis to the torso above it.
  for (const side of [-1, 1]) {
    addRam(
      pelvisMb,
      new THREE.Vector3(side * pw * 0.34, -H * 0.03, -H * p.torso[1] * 0.24),
      new THREE.Vector3(side * pw * 0.28, H * 0.055, -H * p.torso[1] * 0.16),
      H * 0.013,
    );
  }
  addGreebles(pelvisMb, [pw, H * 0.10, H * 0.16], [0, -H * 0.05, 0], 3, rng, {
    clusters: [0.5],
    roundFraction: 0.35,
  });

  // ---- Torso --------------------------------------------------------------
  const torsoMb = new MeshBuilder();
  const tw = H * p.torso[0];
  const td = H * p.torso[1];
  const th = H * p.torso[2];

  addBlock(torsoMb, {
    size: [tw, th, td],
    pos: [0, 0, 0],
    bevel: 0.16,
    taper: 0.88,
    lean: [0, cls === 'wisp' || cls === 'needle' ? td * 0.10 : 0],
    panels: 2,
    panelVariation: 0.55,
    panelSeed: seed + 41,
  });
  // Conduit run down the back of the torso, over the panel divisions rather than
  // between them, so it reads as routed on the outside of the armour.
  addTube(torsoMb, [
    new THREE.Vector3(-tw * 0.16, th * 0.62, -td * 0.5),
    new THREE.Vector3(-tw * 0.2, th * 0.3, -td * 0.54),
    new THREE.Vector3(-tw * 0.14, -th * 0.02, -td * 0.5),
  ], Math.min(tw, td) * 0.045, 6, MASK_METAL);

  // Chest emissive band -- the strongest faction read on the silhouette.
  addBlock(torsoMb, {
    size: [tw * 0.42, th * 0.14, td * 1.03],
    pos: [0, th * 0.58, 0],
    bevel: 0.3,
    mask: MASK_EMISSIVE,
  });
  // Cockpit / sensor head.
  addBlock(torsoMb, {
    size: [tw * 0.3, th * 0.30, td * 0.55],
    pos: [0, th * 0.92, td * 0.16],
    bevel: 0.3,
    taper: 0.7,
    mask: MASK_METAL,
  });
  addBlock(torsoMb, {
    size: [tw * 0.20, th * 0.09, td * 0.10],
    pos: [0, th * 1.06, td * 0.42],
    bevel: 0.3,
    mask: MASK_EMISSIVE,
  });

  // Shoulders and weapons.
  const muzzles: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    const sx = side * (tw * 0.5 + H * p.shoulderSpan * 0.5);
    addBlock(torsoMb, {
      size: [H * p.shoulderSpan, th * 0.62, td * 0.8],
      pos: [sx, th * 0.30, 0],
      bevel: 0.2,
      taper: 0.9,
      panels: 1,
    });
    addGreebles(torsoMb, [H * p.shoulderSpan, th * 0.6, td * 0.8], [sx, th * 0.3, 0], 3, rng);

    // Barrel, pointing forward (+z).
    const by = th * 0.42;
    const bl = H * p.barrel;
    const br = H * p.barrelRadius;
    _m.makeRotationX(Math.PI / 2);
    _m.setPosition(sx, by, td * 0.3);
    const barrel = new MeshBuilder();
    addCylinder(barrel, br, bl, [0, 0, 0], 8, MASK_METAL);
    addCylinder(barrel, br * 1.35, bl * 0.16, [0, bl * 0.84, 0], 8, MASK_HULL);
    torsoMb.append(barrel, _m);
    muzzles.push(new THREE.Vector3(sx, by, td * 0.3 + bl));
  }

  // Class silhouette features.
  if (p.dorsal) {
    // Long artillery tube angled up over the shoulder.
    const tube = new MeshBuilder();
    const tl = H * 0.72;
    addCylinder(tube, H * 0.045, tl, [0, 0, 0], 10, MASK_METAL);
    addCylinder(tube, H * 0.062, tl * 0.14, [0, tl * 0.86, 0], 10, MASK_HULL);
    _m.makeRotationX(-1.02);
    _m.setPosition(0, th * 0.75, -td * 0.22);
    torsoMb.append(tube, _m);
    muzzles.length = 0;
    muzzles.push(new THREE.Vector3(0, th * 0.75 + Math.cos(1.02) * tl, -td * 0.22 + Math.sin(1.02) * tl));
  }
  if (p.dish) {
    // Interceptor array: a stack of angled fins reads better at distance than
    // an actual dish, and costs a fraction of the triangles.
    for (let i = 0; i < 5; i++) {
      addBlock(torsoMb, {
        size: [tw * 0.9 - i * tw * 0.1, th * 0.035, td * 0.1],
        pos: [0, th * 0.72 + i * th * 0.09, -td * 0.34],
        bevel: 0.3,
        mask: i % 2 === 0 ? MASK_EMISSIVE : MASK_METAL,
      });
    }
  }
  if (style === 'compact') {
    // Layered shoulder armor and a blunt sensor brow keep the mass low and wide.
    for (const side of [-1, 1]) {
      addBlock(torsoMb, {
        size: [tw * 0.34, th * 0.22, td * 0.42],
        pos: [side * tw * 0.62, th * 0.62, -td * 0.08],
        bevel: 0.12,
        taper: 0.78,
        lean: [side * tw * 0.06, 0],
        mask: MASK_HULL,
      });
    }
    addBlock(torsoMb, {
      size: [tw * 0.72, th * 0.15, td * 0.24],
      pos: [0, th * 1.02, td * 0.23],
      bevel: 0.12,
      taper: 0.72,
      mask: MASK_METAL,
    });
  } else if (style === 'choir') {
    // A narrow sensor crown and asymmetric dorsal fins create vertical rhythm.
    for (let index = 0; index < 3; index++) {
      const side = index - 1;
      addBlock(torsoMb, {
        size: [tw * (index === 1 ? 0.07 : 0.05), th * (0.34 + index * 0.08), td * 0.14],
        pos: [side * tw * 0.23, th * 1.08, -td * (0.18 + index * 0.04)],
        bevel: 0.3,
        taper: 0.48,
        lean: [side * tw * 0.025, -td * 0.06],
        mask: index === 1 ? MASK_EMISSIVE : MASK_METAL,
      });
    }
    addBlock(torsoMb, {
      size: [tw * 0.18, th * 0.10, td * 0.48],
      pos: [tw * 0.31, th * 0.72, -td * 0.36],
      bevel: 0.3,
      taper: 0.58,
      mask: MASK_EMISSIVE,
    });
  }
  // Clustered at the shoulder line and the waist, which is where hardware belongs
  // on a walker, instead of evenly over the chest plate.
  addGreebles(torsoMb, [tw, th, td], [0, 0, 0], p.greebles, rng, {
    clusters: [0.12, 0.78],
    roundFraction: 0.32,
  });

  // ---- Legs ---------------------------------------------------------------
  const lt = H * p.legThick;

  const upperMb = new MeshBuilder();
  addBlock(upperMb, {
    size: [lt, legUpper, lt * 1.15],
    pos: [0, -legUpper, 0],
    bevel: 0.22,
    taper: 0.86,
  });
  // NO INSET CHANNELS ON THE LIMBS. A thigh on an 11 m mech is under a metre
  // across, so at tactical range a channel in it is sub-pixel: it costs triangles
  // and returns aliasing, which is the same mistake Task 6 corrected on the hull
  // shader frequencies. Channels go on the torso and pelvis, where the plate is
  // broad enough to carry them. The actuator stays, because it changes the
  // silhouette and a silhouette survives any distance.
  addRam(
    upperMb,
    new THREE.Vector3(lt * 0.52, -legUpper * 0.08, lt * 0.1),
    new THREE.Vector3(lt * 0.42, -legUpper * 0.86, -lt * 0.1),
    lt * 0.15,
  );
  addGreebles(upperMb, [lt, legUpper, lt], [0, -legUpper, 0], 3, rng, {
    clusters: [0.06, 0.92],
    roundFraction: 0.4,
  });

  const lowerMb = new MeshBuilder();
  addBlock(lowerMb, {
    size: [lt * 0.85, legLower, lt],
    pos: [0, -legLower, 0],
    bevel: 0.24,
    taper: 1.14,
  });
  addBlock(lowerMb, {
    size: [lt * 0.3, legLower * 0.5, lt * 0.16],
    pos: [0, -legLower * 0.7, lt * 0.5],
    bevel: 0.3,
    mask: MASK_EMISSIVE,
  });
  // Ankle actuator, behind the shin.
  addRam(
    lowerMb,
    new THREE.Vector3(0, -legLower * 0.24, -lt * 0.46),
    new THREE.Vector3(0, -legLower * 0.94, -lt * 0.3),
    lt * 0.12,
  );
  addGreebles(lowerMb, [lt, legLower, lt], [0, -legLower, 0], 2, rng, {
    clusters: [0.08, 0.9],
    roundFraction: 0.45,
  });

  const footMb = new MeshBuilder();
  addBlock(footMb, {
    size: [lt * 1.25, footH, lt * 2.3],
    pos: [0, 0, lt * 0.35],
    bevel: 0.3,
    taper: 0.82,
    mask: MASK_METAL,
  });
  // Toe claws give the foot a readable footprint from above.
  for (const side of [-1, 0, 1]) {
    addBlock(footMb, {
      size: [lt * 0.3, footH * 0.7, lt * 0.5],
      pos: [side * lt * 0.42, 0, lt * 1.55],
      bevel: 0.3,
      mask: MASK_HULL,
    });
  }

  return {
    parts: {
      pelvis: pelvisMb.build(),
      torso: torsoMb.build(),
      upperLeg: upperMb.build(),
      lowerLeg: lowerMb.build(),
      foot: footMb.build(),
    },
    height: H,
    radius: Math.max(tw, H * p.hipFrac * 0.5) * 0.62,
    hipOffset: H * p.legThick * 2.6,
    hipHeight,
    legUpper,
    legLower,
    muzzles,
  };
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

export type StructureKind =
  | 'bastion'
  | 'extractor'
  | 'solarArray'
  | 'fusionCore'
  | 'fabricator'
  | 'mechFoundry'
  | 'rocketBattery'
  | 'pointDefense'
  | 'laserGrid'
  | 'radarMast'
  | 'silo'
  | 'spinalNode';

export interface StructureModel {
  geometry: THREE.BufferGeometry;
  radius: number;
  height: number;
  muzzles: THREE.Vector3[];
}

export function buildStructure(kind: StructureKind, seed: number, style: FactionStyle = 'neutral'): StructureModel {
  const rng = new Rng(seed ^ 0x91a3);
  const mb = new MeshBuilder();
  const muzzles: THREE.Vector3[] = [];
  let radius = 10;
  let height = 12;

  /** Every building sits on the same chamfered plinth, which is most of what
   *  makes an ad-hoc collection of shapes read as one faction's architecture. */
  const plinth = (r: number, h: number): void => {
    addBlock(mb, { size: [r * 2, h, r * 2], pos: [0, 0, 0], bevel: 0.28, taper: 0.94, mask: MASK_METAL });
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      addBlock(mb, {
        size: [r * 0.22, h * 1.5, r * 0.22],
        pos: [dx * r * 0.82, 0, dz * r * 0.82],
        bevel: 0.3,
        mask: MASK_HULL,
      });
    }
  };

  switch (kind) {
    case 'bastion': {
      radius = 22;
      height = 34;
      plinth(radius, 4);
      addBlock(mb, { size: [30, 16, 30], pos: [0, 4, 0], bevel: 0.14, taper: 0.82, panels: 3 });
      addBlock(mb, { size: [18, 10, 18], pos: [0, 20, 0], bevel: 0.18, taper: 0.8, panels: 2 });
      addBlock(mb, { size: [20, 1.6, 20], pos: [0, 19, 0], bevel: 0.4, mask: MASK_EMISSIVE });
      // Command spire.
      addCylinder(mb, 2.6, 12, [0, 30, 0], 8, MASK_METAL, 1.2);
      addBlock(mb, { size: [3, 2.4, 3], pos: [0, 41, 0], bevel: 0.3, mask: MASK_EMISSIVE });
      for (const side of [-1, 1]) {
        addBlock(mb, { size: [5, 5, 7], pos: [side * 13, 20, 0], bevel: 0.22, mask: MASK_METAL });
        muzzles.push(new THREE.Vector3(side * 13, 23, 5));
      }
      addGreebles(mb, [30, 16, 30], [0, 4, 0], 22, rng);
      break;
    }
    case 'extractor': {
      radius = 11;
      height = 14;
      plinth(radius, 3);
      addBlock(mb, { size: [14, 7, 14], pos: [0, 3, 0], bevel: 0.18, taper: 0.85, panels: 2 });
      // Drill head and spoil chute.
      addCylinder(mb, 3.2, 9, [0, 9, 0], 10, MASK_METAL, 2.2);
      addCylinder(mb, 1.1, 5, [0, -4, 0], 8, MASK_RECESS);
      addBlock(mb, { size: [3, 1.2, 9], pos: [6, 6, 0], bevel: 0.3, mask: MASK_METAL });
      addBlock(mb, { size: [11, 0.9, 2], pos: [0, 9.6, 0], bevel: 0.4, mask: MASK_EMISSIVE });
      addGreebles(mb, [14, 7, 14], [0, 3, 0], 10, rng);
      break;
    }
    case 'solarArray': {
      radius = 13;
      height = 8;
      plinth(6, 2);
      addCylinder(mb, 1.6, 4, [0, 2, 0], 8, MASK_METAL);
      // Three tilted collector panels.
      for (let i = 0; i < 3; i++) {
        const panel = new MeshBuilder();
        addBlock(panel, { size: [16, 0.5, 5.4], pos: [0, 0, 0], bevel: 0.3, mask: MASK_HULL });
        addBlock(panel, { size: [15, 0.3, 4.6], pos: [0, 0.5, 0], bevel: 0.3, mask: MASK_EMISSIVE });
        _m.makeRotationX(-0.42);
        _m.setPosition(0, 6, (i - 1) * 6);
        mb.append(panel, _m);
      }
      break;
    }
    case 'fusionCore': {
      radius = 12;
      height = 20;
      plinth(radius, 3);
      addCylinder(mb, 7, 13, [0, 3, 0], 12, MASK_HULL, 6);
      addCylinder(mb, 7.4, 1.4, [0, 9, 0], 12, MASK_EMISSIVE);
      addCylinder(mb, 3.4, 6, [0, 16, 0], 10, MASK_METAL, 4.2);
      // Cooling stacks.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        addCylinder(mb, 1.1, 9, [Math.cos(a) * 8.2, 3, Math.sin(a) * 8.2], 6, MASK_METAL);
      }
      addGreebles(mb, [14, 13, 14], [0, 3, 0], 12, rng);
      break;
    }
    case 'fabricator': {
      radius = 14;
      height = 15;
      plinth(radius, 3);
      addBlock(mb, { size: [20, 9, 15], pos: [0, 3, 0], bevel: 0.16, taper: 0.92, panels: 2 });
      addBlock(mb, { size: [21, 1.1, 3], pos: [0, 9, 0], bevel: 0.4, mask: MASK_EMISSIVE });
      // Gantry arch over the output bay.
      for (const side of [-1, 1]) {
        addBlock(mb, { size: [1.6, 10, 1.6], pos: [side * 8, 12, 9], bevel: 0.3, mask: MASK_METAL });
      }
      addBlock(mb, { size: [18, 1.4, 2.4], pos: [0, 21, 9], bevel: 0.3, mask: MASK_METAL });
      addGreebles(mb, [20, 9, 15], [0, 3, 0], 14, rng);
      break;
    }
    case 'mechFoundry': {
      radius = 18;
      height = 22;
      plinth(radius, 4);
      addBlock(mb, { size: [26, 13, 20], pos: [0, 4, 0], bevel: 0.14, taper: 0.9, panels: 3 });
      addBlock(mb, { size: [27, 1.4, 4], pos: [0, 13, 0], bevel: 0.4, mask: MASK_EMISSIVE });
      // Assembly bay: a tall recessed slot, lit from within.
      addBlock(mb, { size: [11, 15, 3], pos: [0, 4, 10.5], bevel: 0.1, mask: MASK_RECESS });
      addBlock(mb, { size: [9.5, 13.5, 0.6], pos: [0, 4.6, 11.8], bevel: 0.2, mask: MASK_EMISSIVE });
      // Overhead crane rails.
      for (const side of [-1, 1]) {
        addBlock(mb, { size: [2, 11, 22], pos: [side * 12, 17, 0], bevel: 0.24, mask: MASK_METAL });
      }
      addBlock(mb, { size: [26, 1.8, 3], pos: [0, 27, 4], bevel: 0.3, mask: MASK_METAL });
      addGreebles(mb, [26, 13, 20], [0, 4, 0], 20, rng);
      break;
    }
    case 'rocketBattery': {
      radius = 12;
      height = 16;
      plinth(radius, 3);
      addBlock(mb, { size: [15, 6, 13], pos: [0, 3, 0], bevel: 0.18, panels: 2 });
      // Elevated tube cluster, angled up.
      const cluster = new MeshBuilder();
      for (let i = 0; i < 6; i++) {
        const cx = ((i % 3) - 1) * 2.5;
        const cy = Math.floor(i / 3) * 2.5;
        addCylinder(cluster, 1.0, 11, [cx, cy, 0], 8, MASK_RECESS);
        addCylinder(cluster, 1.15, 1.2, [cx, cy + 9.8, 0], 8, MASK_METAL);
      }
      _m.makeRotationX(-0.86);
      _m.setPosition(0, 9, -1);
      mb.append(cluster, _m);
      addBlock(mb, { size: [15, 1.1, 2], pos: [0, 8.4, 5], bevel: 0.4, mask: MASK_EMISSIVE });
      muzzles.push(new THREE.Vector3(0, 17, 5));
      addGreebles(mb, [15, 6, 13], [0, 3, 0], 9, rng);
      break;
    }
    case 'pointDefense': {
      radius = 8;
      height = 12;
      plinth(7, 2.5);
      addCylinder(mb, 3.2, 4, [0, 2.5, 0], 10, MASK_HULL, 2.8);
      addBlock(mb, { size: [5.5, 3.4, 6], pos: [0, 6.5, 0], bevel: 0.2, taper: 0.85, mask: MASK_METAL });
      // Quad barrels.
      for (const dx of [-1.3, 1.3]) {
        for (const dy of [0, 1.3]) {
          const barrel = new MeshBuilder();
          addCylinder(barrel, 0.32, 6, [0, 0, 0], 6, MASK_METAL);
          _m.makeRotationX(Math.PI / 2 - 0.3);
          _m.setPosition(dx, 7.3 + dy, 2.4);
          mb.append(barrel, _m);
        }
      }
      addBlock(mb, { size: [5.8, 0.8, 1.4], pos: [0, 9.6, -1], bevel: 0.4, mask: MASK_EMISSIVE });
      muzzles.push(new THREE.Vector3(0, 8, 8));
      break;
    }
    case 'laserGrid': {
      radius = 10;
      height = 24;
      plinth(radius, 3);
      // Twin field pylons leave an unmistakable open gate silhouette. The
      // emitter bars are emissive so powered coverage reads at RTS distance.
      for (const side of [-1, 1]) {
        addBlock(mb, {
          size: [3.2, 18, 4.2],
          pos: [side * 5.2, 3, 0],
          bevel: 0.2,
          taper: 0.82,
          panels: 3,
        });
        addCylinder(mb, 1.25, 4, [side * 5.2, 20.5, 0], 8, MASK_METAL, 0.7);
        addBlock(mb, {
          size: [2.2, 1.0, 5.2],
          pos: [side * 5.2, 18, 0],
          bevel: 0.3,
          mask: MASK_EMISSIVE,
        });
      }
      addBlock(mb, { size: [11.5, 1.2, 2.2], pos: [0, 15, 0], bevel: 0.3, mask: MASK_METAL });
      addBlock(mb, { size: [9.8, 0.55, 1.0], pos: [0, 16.2, 0], bevel: 0.35, mask: MASK_EMISSIVE });
      addGreebles(mb, [13, 18, 7], [0, 3, 0], 10, rng);
      muzzles.push(new THREE.Vector3(0, 19, 0));
      break;
    }
    case 'radarMast': {
      radius = 7;
      height = 28;
      plinth(6, 2.5);
      // Lattice mast: alternating offset blocks read as a truss for very few
      // triangles, and the silhouette is what matters at this distance.
      for (let i = 0; i < 9; i++) {
        const y = 2.5 + i * 2.6;
        const w = 3.4 - i * 0.18;
        addBlock(mb, {
          size: [w, 0.5, w],
          pos: [0, y, 0],
          bevel: 0.35,
          mask: MASK_METAL,
        });
        for (const [dx, dz] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const) {
          addBlock(mb, {
            size: [0.42, 2.6, 0.42],
            pos: [dx * w * 0.42, y, dz * w * 0.42],
            bevel: 0.3,
            mask: MASK_HULL,
          });
        }
      }
      // Rotating dish assembly.
      addBlock(mb, { size: [9, 0.6, 5], pos: [0, 26, 0], bevel: 0.3, taper: 0.6, mask: MASK_HULL });
      addBlock(mb, { size: [8, 0.5, 4], pos: [0, 26.6, 0], bevel: 0.3, mask: MASK_EMISSIVE });
      addCylinder(mb, 0.3, 3, [0, 27.2, 0], 6, MASK_METAL);
      break;
    }
    case 'silo': {
      radius = 16;
      height = 30;
      plinth(radius, 4);
      // Armoured launch well with split blast doors and an exposed central
      // accelerator. It is deliberately tall and legible as an endgame target.
      addCylinder(mb, 10, 19, [0, 4, 0], 14, MASK_HULL, 8.5);
      addCylinder(mb, 5.2, 23, [0, 4, 0], 12, MASK_RECESS, 4.1);
      addCylinder(mb, 2.4, 20, [0, 7, 0], 10, MASK_METAL, 1.6);
      addCylinder(mb, 10.4, 1.3, [0, 13, 0], 14, MASK_EMISSIVE);
      for (const side of [-1, 1]) {
        addBlock(mb, {
          size: [8.2, 1.5, 18],
          pos: [side * 5.1, 23, 0],
          bevel: 0.18,
          lean: [side * 1.6, 0],
          mask: MASK_METAL,
          panels: 2,
        });
        addBlock(mb, {
          size: [1.1, 7, 2.2],
          pos: [side * 11.2, 8, 0],
          bevel: 0.3,
          mask: MASK_EMISSIVE,
        });
      }
      addGreebles(mb, [20, 19, 20], [0, 4, 0], 18, rng);
      muzzles.push(new THREE.Vector3(0, 29, 0));
      break;
    }
    case 'spinalNode': {
      radius = 15;
      height = 40;
      plinth(radius, 5);
      // A pre-existing megastructure fixture, not something either side built:
      // heavier, more monumental, and deliberately not in a faction style.
      addCylinder(mb, 9, 8, [0, 5, 0], 10, MASK_HULL, 7);
      addCylinder(mb, 4.5, 24, [0, 13, 0], 8, MASK_METAL, 3.2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        addBlock(mb, {
          size: [1.4, 20, 1.4],
          pos: [Math.cos(a) * 7, 12, Math.sin(a) * 7],
          bevel: 0.3,
          mask: MASK_HULL,
        });
      }
      addCylinder(mb, 6.5, 2.5, [0, 36, 0], 10, MASK_EMISSIVE, 5);
      addCylinder(mb, 2, 4, [0, 38.5, 0], 8, MASK_METAL, 0.6);
      addGreebles(mb, [18, 8, 18], [0, 5, 0], 14, rng);
      break;
    }
  }

  if (kind !== 'spinalNode' && style === 'compact') {
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      addBlock(mb, {
        size: [radius * (dz === 0 ? 0.22 : 0.42), height * 0.34, radius * (dx === 0 ? 0.22 : 0.42)],
        pos: [dx * radius * 0.68, height * 0.12, dz * radius * 0.68],
        bevel: 0.12,
        taper: 0.66,
        lean: [dx * radius * 0.08, dz * radius * 0.08],
        mask: MASK_HULL,
      });
    }
  } else if (kind !== 'spinalNode' && style === 'choir') {
    for (let index = 0; index < 3; index++) {
      const angle = (index / 3) * Math.PI * 2 + 0.35;
      addBlock(mb, {
        size: [radius * 0.12, height * (0.38 + index * 0.07), radius * 0.16],
        pos: [Math.cos(angle) * radius * 0.62, height * 0.28, Math.sin(angle) * radius * 0.62],
        bevel: 0.3,
        taper: 0.46,
        lean: [Math.cos(angle) * radius * 0.04, Math.sin(angle) * radius * 0.04],
        mask: index === 1 ? MASK_EMISSIVE : MASK_METAL,
      });
    }
    addCylinder(mb, radius * 0.08, height * 0.32, [0, height * 0.66, 0], 7, MASK_EMISSIVE, radius * 0.035);
  }

  return { geometry: mb.build(), radius, height, muzzles };
}
