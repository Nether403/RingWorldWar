import { RING_CIRCUMFERENCE, RING_HALF_WIDTH } from '@core/constants';
import { deltaS, surfaceDist, wrapS } from '@core/ringMath';
import type { Terrain } from '@gen/terrain';

const TARGET_CELL = 128;
const MAX_SLOPE = 0.72;
const CACHE_LIMIT = 64;
const SQRT2 = Math.SQRT2;

const NEIGHBORS = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, SQRT2], [-1, 1, SQRT2], [1, -1, SQRT2], [1, 1, SQRT2],
] as const;

export interface NavDirection {
  ds: number;
  dz: number;
  reachable: boolean;
}

interface FlowField {
  costs: Float32Array;
}

/** Cached terrain-aware flow fields on the wrapped surface plane. */
export class SurfaceNav {
  readonly cols = Math.ceil(RING_CIRCUMFERENCE / TARGET_CELL);
  readonly rows = Math.floor((RING_HALF_WIDTH * 2) / TARGET_CELL) + 1;
  readonly cellS = RING_CIRCUMFERENCE / this.cols;
  readonly cellZ = (RING_HALF_WIDTH * 2) / (this.rows - 1);

  private readonly passable = new Uint8Array(this.cols * this.rows);
  private readonly slope = new Float32Array(this.cols * this.rows);
  private readonly fields = new Map<number, FlowField>();
  private builds = 0;

  constructor(private readonly terrain: Terrain) {
    for (let row = 0; row < this.rows; row++) {
      const z = this.zAt(row);
      for (let col = 0; col < this.cols; col++) {
        const s = this.sAt(col);
        const index = this.index(col, row);
        const edge = this.cellS * 0.45;
        const slope = Math.max(
          terrain.slopeAt(s, z),
          terrain.slopeAt(s - edge, z),
          terrain.slopeAt(s + edge, z),
          terrain.slopeAt(s, z - this.cellZ * 0.45),
          terrain.slopeAt(s, z + this.cellZ * 0.45),
        );
        this.slope[index] = slope;
        this.passable[index] = Math.abs(z) <= RING_HALF_WIDTH - 60 && slope < MAX_SLOPE ? 1 : 0;
      }
    }
  }

  get cachedFieldCount(): number {
    return this.fields.size;
  }

  get fieldBuildCount(): number {
    return this.builds;
  }

  directionAt(
    s: number,
    z: number,
    targetS: number,
    targetZ: number,
    out: NavDirection = { ds: 0, dz: 0, reachable: false },
  ): NavDirection {
    const directS = deltaS(s, targetS);
    const directZ = targetZ - z;
    const directLength = Math.hypot(directS, directZ) || 1;
    if (surfaceDist(s, z, targetS, targetZ) <= this.cellS * 1.5) {
      if (this.segmentPassable(s, z, targetS, targetZ)) {
        out.ds = directS / directLength;
        out.dz = directZ / directLength;
        out.reachable = true;
        return out;
      }
      const detour = Math.max(240, this.cellZ * 2.5);
      for (const sign of [-1, 1]) {
        const waypointS = wrapS(targetS);
        const waypointZ = Math.max(
          -RING_HALF_WIDTH + 60,
          Math.min(RING_HALF_WIDTH - 60, targetZ + detour * sign),
        );
        if (
          !this.segmentPassable(s, z, waypointS, waypointZ) ||
          !this.segmentPassable(waypointS, waypointZ, targetS, targetZ)
        ) continue;
        const waypointDs = deltaS(s, waypointS);
        const waypointDz = waypointZ - z;
        const waypointLength = Math.hypot(waypointDs, waypointDz) || 1;
        out.ds = waypointDs / waypointLength;
        out.dz = waypointDz / waypointLength;
        out.reachable = true;
        return out;
      }
    }

    const col = this.colAt(s);
    const row = this.rowAt(z);
    const goal = this.nearestPassable(this.colAt(targetS), this.rowAt(targetZ));
    if (goal < 0) return this.directFallback(directS, directZ, directLength, out);
    const field = this.getField(goal);
    const current = this.index(col, row);
    let bestCost = field.costs[current]!;
    let bestCol = col;
    let bestRow = row;

    for (const [dc, dr] of NEIGHBORS) {
      const nr = row + dr;
      if (nr < 0 || nr >= this.rows) continue;
      const nc = this.wrapCol(col + dc);
      const next = this.index(nc, nr);
      if (!this.canStep(col, row, dc, dr) || field.costs[next]! >= bestCost) continue;
      if (!this.segmentPassable(s, z, wrapS(s + dc * this.cellS), z + dr * this.cellZ)) continue;
      bestCost = field.costs[next]!;
      bestCol = nc;
      bestRow = nr;
    }

    if (!Number.isFinite(bestCost) || (bestCol === col && bestRow === row)) {
      return this.directFallback(directS, directZ, directLength, out);
    }
    const stepS = bestCol === col ? 0 : bestCol === this.wrapCol(col + 1) ? 1 : -1;
    const stepZ = bestRow - row;
    const length = Math.hypot(stepS, stepZ) || 1;
    out.ds = stepS / length;
    out.dz = stepZ / length;
    out.reachable = true;
    return out;
  }

  segmentPassable(fromS: number, fromZ: number, toS: number, toZ: number): boolean {
    const ds = deltaS(fromS, toS);
    const dz = toZ - fromZ;
    const steps = Math.max(1, Math.ceil(Math.hypot(ds, dz) / 4));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const s = wrapS(fromS + ds * t);
      const z = fromZ + dz * t;
      if (Math.abs(z) > RING_HALF_WIDTH - 60 || this.terrain.slopeAt(s, z) >= MAX_SLOPE) return false;
    }
    return true;
  }

  private directFallback(ds: number, dz: number, length: number, out: NavDirection): NavDirection {
    out.ds = ds / length;
    out.dz = dz / length;
    out.reachable = false;
    return out;
  }

  private getField(goal: number): FlowField {
    const cached = this.fields.get(goal);
    if (cached) {
      this.fields.delete(goal);
      this.fields.set(goal, cached);
      return cached;
    }

    const field = this.buildField(goal);
    this.fields.set(goal, field);
    if (this.fields.size > CACHE_LIMIT) this.fields.delete(this.fields.keys().next().value!);
    return field;
  }

  private buildField(goal: number): FlowField {
    this.builds++;
    const costs = new Float32Array(this.passable.length);
    costs.fill(Infinity);
    costs[goal] = 0;
    const heap = new MinHeap();
    heap.push(goal, 0);

    while (heap.size > 0) {
      const entry = heap.pop()!;
      if (entry.cost > costs[entry.index]!) continue;
      const col = entry.index % this.cols;
      const row = Math.floor(entry.index / this.cols);

      for (const [dc, dr, distance] of NEIGHBORS) {
        const nr = row + dr;
        if (nr < 0 || nr >= this.rows) continue;
        const nc = this.wrapCol(col + dc);
        const next = this.index(nc, nr);
        if (!this.canStep(col, row, dc, dr)) continue;
        const nextCost = entry.cost + distance * (1 + this.slope[next]! * 3);
        if (nextCost >= costs[next]!) continue;
        costs[next] = nextCost;
        heap.push(next, costs[next]!);
      }
    }
    return { costs };
  }

  private nearestPassable(col: number, row: number): number {
    const exact = this.index(col, row);
    if (this.passable[exact]) return exact;
    for (let radius = 1; radius <= 8; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (const dc of [-radius, radius]) {
          const candidate = this.safeIndex(col + dc, row + dr);
          if (candidate >= 0 && this.passable[candidate]) return candidate;
        }
      }
      for (let dc = -radius + 1; dc < radius; dc++) {
        for (const dr of [-radius, radius]) {
          const candidate = this.safeIndex(col + dc, row + dr);
          if (candidate >= 0 && this.passable[candidate]) return candidate;
        }
      }
    }
    return -1;
  }

  private safeIndex(col: number, row: number): number {
    return row < 0 || row >= this.rows ? -1 : this.index(this.wrapCol(col), row);
  }

  private canStep(col: number, row: number, dc: number, dr: number): boolean {
    const next = this.safeIndex(col + dc, row + dr);
    if (next < 0 || !this.passable[next]) return false;
    if (dc !== 0 && dr !== 0) {
      const sideS = this.safeIndex(col + dc, row);
      const sideZ = this.safeIndex(col, row + dr);
      if (sideS < 0 || sideZ < 0 || !this.passable[sideS] || !this.passable[sideZ]) return false;
    }
    return true;
  }

  private colAt(s: number): number {
    return this.wrapCol(Math.floor(wrapS(s) / this.cellS));
  }

  private rowAt(z: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.round((z + RING_HALF_WIDTH) / this.cellZ)));
  }

  private sAt(col: number): number {
    return (col + 0.5) * this.cellS;
  }

  private zAt(row: number): number {
    return -RING_HALF_WIDTH + row * this.cellZ;
  }

  private wrapCol(col: number): number {
    return ((col % this.cols) + this.cols) % this.cols;
  }

  private index(col: number, row: number): number {
    return row * this.cols + col;
  }
}

interface HeapEntry {
  index: number;
  cost: number;
}

class MinHeap {
  private readonly entries: HeapEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(index: number, cost: number): void {
    const entry = { index, cost };
    let child = this.entries.length;
    this.entries.push(entry);
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.entries[parent]!.cost <= cost) break;
      this.entries[child] = this.entries[parent]!;
      child = parent;
    }
    this.entries[child] = entry;
  }

  pop(): HeapEntry | undefined {
    const root = this.entries[0];
    const tail = this.entries.pop();
    if (!root || !tail || this.entries.length === 0) return root;
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      if (left >= this.entries.length) break;
      const right = left + 1;
      const child = right < this.entries.length && this.entries[right]!.cost < this.entries[left]!.cost ? right : left;
      if (this.entries[child]!.cost >= tail.cost) break;
      this.entries[parent] = this.entries[child]!;
      parent = child;
    }
    this.entries[parent] = tail;
    return root;
  }
}
