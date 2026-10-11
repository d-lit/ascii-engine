/**
 * Seeded PRNG (mulberry32): fast, 32-bit state, good enough for visuals.
 * Same seed -> same sequence on every platform.
 */
export function createRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scale from hashInt* results to [0, 1). */
export const HASH_UNIT = 1 / 0x1000000;

/**
 * Stateless hash of integer coordinates to an integer in [0, 2^24). For
 * per-cell randomness that must stay stable across frames (e.g. a cell's
 * decode delay). Integer in, small integer out: hot loops can call it without
 * V8 boxing doubles across the call (DECISIONS 013). Pass integers only.
 */
export function hashInt2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 8;
}

/** hashInt2 with a third integer coordinate (e.g. a time step). */
export function hashInt3(x: number, y: number, z: number, seed: number): number {
  return hashInt2(x, Math.imul(y | 0, 0x2c1b3c6d) ^ (z | 0), seed);
}

/** hashInt2 scaled to [0, 1); for non-hot code. */
export function hash2(x: number, y: number, seed: number): number {
  return hashInt2(x, y, seed) * HASH_UNIT;
}

/** hashInt3 scaled to [0, 1); for non-hot code. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  return hashInt3(x, y, z, seed) * HASH_UNIT;
}
