/**
 * Noise primitives.
 *
 * Everything procedural in the game -- terrain, materials, greebles, clouds,
 * scatter density -- is built on these. All functions are pure and seeded, so
 * the same seed always yields the same world.
 *
 * 3D noise matters more than usual here: the ring's surface has to tile
 * seamlessly all the way around. Rather than fight with tiling 2D noise, we
 * sample 3D noise along a circle. The seam then cannot exist, because there is
 * no seam to begin with -- the sample path is a closed loop.
 */

// ---------------------------------------------------------------------------
// Simplex noise (Stefan Gustavson's formulation, adapted to a seeded permutation)
// ---------------------------------------------------------------------------

const GRAD3 = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1,
  0, 1, -1, 0, -1, -1,
]);

export class Noise {
  private perm = new Uint8Array(512);
  private permMod12 = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    // Seeded Fisher-Yates using an inlined mulberry32 so Noise has no imports.
    let state = (seed ^ 0x9e3779b9) >>> 0;
    const rnd = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = p[i]!;
      p[i] = p[j]!;
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255]!;
      this.permMod12[i] = this.perm[i]! % 12;
    }
  }

  /** 2D simplex noise, roughly in [-1, 1]. */
  noise2(xin: number, yin: number): number {
    const F2 = 0.3660254037844386;
    const G2 = 0.21132486540518713;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const gi = this.permMod12[ii + this.perm[jj]!]! * 3;
      t0 *= t0;
      n += t0 * t0 * (GRAD3[gi]! * x0 + GRAD3[gi + 1]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const gi = this.permMod12[ii + i1 + this.perm[jj + j1]!]! * 3;
      t1 *= t1;
      n += t1 * t1 * (GRAD3[gi]! * x1 + GRAD3[gi + 1]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const gi = this.permMod12[ii + 1 + this.perm[jj + 1]!]! * 3;
      t2 *= t2;
      n += t2 * t2 * (GRAD3[gi]! * x2 + GRAD3[gi + 1]! * y2);
    }
    return 70 * n;
  }

  /** 3D simplex noise, roughly in [-1, 1]. */
  noise3(xin: number, yin: number, zin: number): number {
    const F3 = 1 / 3;
    const G3 = 1 / 6;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const z0 = zin - (k - t);

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
      } else if (x0 < z0) {
        i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
      } else {
        i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      }
    }

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const gi = this.permMod12[ii + this.perm[jj + this.perm[kk]!]!]! * 3;
      t0 *= t0;
      n += t0 * t0 * (GRAD3[gi]! * x0 + GRAD3[gi + 1]! * y0 + GRAD3[gi + 2]! * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const gi = this.permMod12[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]!]!]! * 3;
      t1 *= t1;
      n += t1 * t1 * (GRAD3[gi]! * x1 + GRAD3[gi + 1]! * y1 + GRAD3[gi + 2]! * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const gi = this.permMod12[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]!]!]! * 3;
      t2 *= t2;
      n += t2 * t2 * (GRAD3[gi]! * x2 + GRAD3[gi + 1]! * y2 + GRAD3[gi + 2]! * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const gi = this.permMod12[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]!]!]! * 3;
      t3 *= t3;
      n += t3 * t3 * (GRAD3[gi]! * x3 + GRAD3[gi + 1]! * y3 + GRAD3[gi + 2]! * z3);
    }
    return 32 * n;
  }

  // -------------------------------------------------------------------------
  // Fractal combinations
  // -------------------------------------------------------------------------

  /** Fractal Brownian motion in 3D. */
  fbm3(x: number, y: number, z: number, octaves = 5, lacunarity = 2.0, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Fractal Brownian motion in 2D. */
  fbm2(x: number, y: number, octaves = 5, lacunarity = 2.0, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /**
   * Ridged multifractal -- sharp crests instead of rolling hills. This is what
   * makes terrain read as eroded rock rather than as noise.
   */
  ridged3(x: number, y: number, z: number, octaves = 5, lacunarity = 2.0, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.noise3(x * freq, y * freq, z * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return (sum / norm) * 2 - 1;
  }

  /**
   * Billowy noise -- rounded lumps. Good for dust drifts and cloud bodies.
   */
  billow3(x: number, y: number, z: number, octaves = 4): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * Math.abs(this.noise3(x * freq, y * freq, z * freq));
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return (sum / norm) * 2 - 1;
  }
}

// ---------------------------------------------------------------------------
// Worley / cellular noise
// ---------------------------------------------------------------------------

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 2D Worley noise. Returns { f1, f2 } -- distance to the nearest and second
 * nearest feature point. `f2 - f1` gives clean cell borders, which is how we
 * generate cracked plating, hex shields and shattered rock.
 */
export function worley2(x: number, y: number, seed = 0): { f1: number; f2: number } {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 1e9;
  let f2 = 1e9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const px = cx + hash2(cx, cy, seed);
      const py = cy + hash2(cx, cy, seed + 7919);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2 };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-9));
  return t * t * (3 - 2 * t);
}

/** Quintic smootherstep -- zero 1st and 2nd derivatives at the ends. */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-9));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Remap a value from one range to another. */
export function remap(v: number, a0: number, a1: number, b0: number, b1: number): number {
  return b0 + ((v - a0) / (a1 - a0 || 1e-9)) * (b1 - b0);
}
