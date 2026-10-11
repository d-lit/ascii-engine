import { createRand } from './prng.ts';

// Gradient directions: midpoints of a cube's edges (Gustavson). 2D uses x, y.
const GRAD3 = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

export interface Noise {
  /** Simplex noise, roughly -1..1. */
  noise2(x: number, y: number): number;
  noise3(x: number, y: number, z: number): number;
  /** Fractal sum normalized back to roughly -1..1. */
  fbm2(x: number, y: number, octaves: number, lacunarity?: number, gain?: number): number;
  fbm3(x: number, y: number, z: number, octaves: number, lacunarity?: number, gain?: number): number;
  /**
   * Allocation-safe form for hot loops (DECISIONS 013): write x, y, z into
   * io[0..2], call, read io[3]. Lacunarity 2, gain 0.5.
   */
  readonly io: Float64Array;
  fbm3io(octaves: number): void;
}

/**
 * Seeded simplex noise (2D, 3D) after Stefan Gustavson's reference. Tables are
 * built once per seed; sampling does not allocate.
 */
export function createNoise(seed: number): Noise {
  const rand = createRand(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  const mod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255]!;
    mod12[i] = perm[i]! % 12;
  }

  // Kernels are too large for V8 to inline, and a non-inlined call boxes every
  // double argument and return value into a heap object (~1 MB/frame for fbm
  // at 200x100). So kernels take no arguments: inputs and the result travel
  // through this scratch array. [0..2] = x, y, z in; [3] = value out.
  const io = new Float64Array(4);

  // Table indices below stay < 512 by construction (ii, jj, kk < 256, offsets <= 2).
  function kernel2(): void {
    const x = io[0]!;
    const y = io[1]!;
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    let n = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = mod12[ii + perm[jj]!]! * 3;
      t0 *= t0;
      n += t0 * t0 * (GRAD3[g]! * x0 + GRAD3[g + 1]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = mod12[ii + i1 + perm[jj + j1]!]! * 3;
      t1 *= t1;
      n += t1 * t1 * (GRAD3[g]! * x1 + GRAD3[g + 1]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = mod12[ii + 1 + perm[jj + 1]!]! * 3;
      t2 *= t2;
      n += t2 * t2 * (GRAD3[g]! * x2 + GRAD3[g + 1]! * y2);
    }
    io[3] = 70 * n;
  }

  function kernel3(): void {
    const x = io[0]!;
    const y = io[1]!;
    const z = io[2]!;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    let n = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const g = mod12[ii + perm[jj + perm[kk]!]!]! * 3;
      t0 *= t0;
      n += t0 * t0 * (GRAD3[g]! * x0 + GRAD3[g + 1]! * y0 + GRAD3[g + 2]! * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const g = mod12[ii + i1 + perm[jj + j1 + perm[kk + k1]!]!]! * 3;
      t1 *= t1;
      n += t1 * t1 * (GRAD3[g]! * x1 + GRAD3[g + 1]! * y1 + GRAD3[g + 2]! * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const g = mod12[ii + i2 + perm[jj + j2 + perm[kk + k2]!]!]! * 3;
      t2 *= t2;
      n += t2 * t2 * (GRAD3[g]! * x2 + GRAD3[g + 1]! * y2 + GRAD3[g + 2]! * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const g = mod12[ii + 1 + perm[jj + 1 + perm[kk + 1]!]!]! * 3;
      t3 *= t3;
      n += t3 * t3 * (GRAD3[g]! * x3 + GRAD3[g + 1]! * y3 + GRAD3[g + 2]! * z3);
    }
    io[3] = 32 * n;
  }

  function noise2(x: number, y: number): number {
    io[0] = x;
    io[1] = y;
    kernel2();
    return io[3]!;
  }

  function noise3(x: number, y: number, z: number): number {
    io[0] = x;
    io[1] = y;
    io[2] = z;
    kernel3();
    return io[3]!;
  }

  function fbm2(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let norm = 0;
    let amp = 1;
    let freq = 1;
    for (let o = 0; o < octaves; o++) {
      io[0] = x * freq;
      io[1] = y * freq;
      kernel2();
      sum += amp * io[3]!;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  function fbm3(x: number, y: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let norm = 0;
    let amp = 1;
    let freq = 1;
    for (let o = 0; o < octaves; o++) {
      io[0] = x * freq;
      io[1] = y * freq;
      io[2] = z * freq;
      kernel3();
      sum += amp * io[3]!;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  function fbm3io(octaves: number): void {
    const x = io[0]!;
    const y = io[1]!;
    const z = io[2]!;
    let sum = 0;
    let norm = 0;
    let amp = 1;
    let freq = 1;
    for (let o = 0; o < octaves; o++) {
      io[0] = x * freq;
      io[1] = y * freq;
      io[2] = z * freq;
      kernel3();
      sum += amp * io[3]!;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    io[3] = norm > 0 ? sum / norm : 0;
  }

  return { noise2, noise3, fbm2, fbm3, io, fbm3io };
}
