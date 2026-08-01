/**
 * Seeded deterministic RNG.
 *
 * The simulation must never call Math.random -- identical seeds have to produce
 * identical matches, both for the determinism test and for any future lockstep
 * multiplayer. Procedural generators take a seed for the same reason: the same
 * world, mech, and material every time.
 *
 * Algorithm: mulberry32. Small, fast, good enough distribution for games, and
 * trivially reproducible across engines because it is pure 32-bit integer maths.
 */

export class Rng {
  private state: number;

  constructor(seed: number) {
    // Scramble the seed so that sequential seeds (0, 1, 2...) don't produce
    // visibly correlated streams -- important when seeding many generators.
    this.state = (seed ^ 0x9e3779b9) >>> 0;
    this.next();
    this.next();
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1 - 1e-9));
  }

  /** True with the given probability. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniform in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  /** Approximately normal, mean 0, stddev 1 (sum of 4 uniforms, cheap). */
  gaussian(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }

  /** Pick a random element. */
  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))]!;
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }

  /** Fork a child generator, so sub-generators don't disturb this stream. */
  fork(): Rng {
    return new Rng((this.state ^ Math.floor(this.next() * 0xffffffff)) >>> 0);
  }

  /** Current deterministic state, used only by simulation checksums. */
  snapshot(): number {
    return this.state;
  }

  /** Restore a previously captured deterministic state without re-scrambling it. */
  restore(state: number): void {
    if (!Number.isInteger(state) || state < 0 || state > 0xffffffff) {
      throw new RangeError('Rng state must be an unsigned 32-bit integer');
    }
    this.state = state >>> 0;
  }
}

/** Convenience: turn a string into a numeric seed. */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
