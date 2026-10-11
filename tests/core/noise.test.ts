import { describe, expect, it } from 'vitest';
import { createNoise } from '../../src/core/noise.ts';
import { createRand } from '../../src/core/prng.ts';

const samples = (() => {
  const rand = createRand(9);
  return Array.from({ length: 4000 }, () => [rand() * 200 - 100, rand() * 200 - 100, rand() * 50]);
})();

describe.each([
  ['noise2', (n: ReturnType<typeof createNoise>, s: number[]) => n.noise2(s[0]!, s[1]!)],
  ['noise3', (n: ReturnType<typeof createNoise>, s: number[]) => n.noise3(s[0]!, s[1]!, s[2]!)],
  ['fbm2', (n: ReturnType<typeof createNoise>, s: number[]) => n.fbm2(s[0]!, s[1]!, 4)],
  ['fbm3', (n: ReturnType<typeof createNoise>, s: number[]) => n.fbm3(s[0]!, s[1]!, s[2]!, 4)],
])('%s', (_name, sample) => {
  const a = createNoise(1);

  it('stays within -1..1, centred on 0, and uses the range', () => {
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const s of samples) {
      const v = sample(a, s);
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(Math.abs(sum / samples.length)).toBeLessThan(0.05);
    expect(max - min).toBeGreaterThan(0.8);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const b = createNoise(1);
    const c = createNoise(2);
    const s = samples[0]!;
    expect(sample(b, s)).toBe(sample(a, s));
    expect(samples.slice(0, 20).some((q) => sample(c, q) !== sample(a, q))).toBe(true);
  });

  it('is continuous', () => {
    for (const s of samples.slice(0, 200)) {
      const shifted = [s[0]! + 1e-4, s[1]!, s[2]!];
      expect(Math.abs(sample(a, shifted) - sample(a, s))).toBeLessThan(0.01);
    }
  });
});

describe('simplex lattice', () => {
  it('is zero at the origin', () => {
    const n = createNoise(5);
    expect(n.noise2(0, 0)).toBe(0);
    expect(n.noise3(0, 0, 0)).toBe(0);
  });
});
