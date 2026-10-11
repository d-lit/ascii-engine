import { describe, expect, it } from 'vitest';
import { createRand, hash2, hash3, hashInt2 } from '../../src/core/prng.ts';

describe('createRand', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = createRand(42);
    const b = createRand(42);
    const c = createRand(43);
    const sa = Array.from({ length: 8 }, a);
    expect(Array.from({ length: 8 }, b)).toEqual(sa);
    expect(Array.from({ length: 8 }, c)).not.toEqual(sa);
  });

  it('stays in [0, 1) with a roughly uniform mean', () => {
    const rand = createRand(1);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = rand();
      expect(v >= 0 && v < 1).toBe(true);
      sum += v;
    }
    expect(sum / 10000).toBeCloseTo(0.5, 1);
  });
});

describe('hash2 / hash3', () => {
  it('is stable, in [0, 1), and sensitive to every input', () => {
    expect(hash2(3, 4, 7)).toBe(hash2(3, 4, 7));
    const base = hash2(3, 4, 7);
    expect(base >= 0 && base < 1).toBe(true);
    expect(hash2(4, 3, 7)).not.toBe(base);
    expect(hash2(3, 4, 8)).not.toBe(base);
    expect(hash3(3, 4, 1, 7)).not.toBe(hash3(3, 4, 2, 7));
  });

  it('returns Smi-safe integers below 2^24', () => {
    for (let i = 0; i < 1000; i++) {
      const h = hashInt2(i, -i, i * 7);
      expect(Number.isInteger(h) && h >= 0 && h < 0x1000000).toBe(true);
    }
  });

  it('spreads neighbouring cells across the range', () => {
    let sum = 0;
    const n = 64 * 64;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) sum += hash2(x, y, 0);
    expect(sum / n).toBeCloseTo(0.5, 1);
  });
});
