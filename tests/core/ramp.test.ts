import { describe, expect, it } from 'vitest';
import {
  densityOfChar,
  densityToLum,
  makeRamp,
  normalizeDensity,
  quantize,
  type Ramp,
} from '../../src/core/ramp.ts';

function code(char: string): number {
  return char.charCodeAt(0);
}

describe('makeRamp', () => {
  it('sorts by density, removes duplicate glyphs, and normalizes', () => {
    const ramp = makeRamp('baab', [0.8, 0.2, 0.9, 0]);

    expect(ramp.chars).toBe('ab');
    expect([...ramp.density]).toEqual([0, 1]);
  });

  it('handles degenerate ramps without division by zero', () => {
    expect([...makeRamp('@', [0.4]).density]).toEqual([0]);
    expect([...makeRamp('abc', [0.4, 0.4, 0.4]).density]).toEqual([0, 0, 0]);
  });

  it('keeps the raw range for placing outside glyphs', () => {
    const ramp = makeRamp('ab', [0.5, 0.1]);

    expect(ramp.rawMin).toBeCloseTo(0.1);
    expect(ramp.rawMax).toBeCloseTo(0.5);
    expect(normalizeDensity(ramp, 0.3)).toBeCloseTo(0.5);
    expect(normalizeDensity(ramp, 0)).toBe(0);
    expect(normalizeDensity(ramp, 1)).toBe(1);
    expect(normalizeDensity(makeRamp('a', [0.4]), 0.9)).toBe(0);
  });

  it('rejects empty, mismatched, and non-BMP inputs', () => {
    expect(() => makeRamp('', [])).toThrow(/empty ramp/);
    expect(() => makeRamp('ab', [0])).toThrow(/chars vs/);
    expect(() => makeRamp('😀', [1])).toThrow(/non-BMP/);
  });
});

describe('quantize', () => {
  const uneven: Ramp = {
    chars: ' abc',
    density: new Float32Array([0, 0.05, 0.1, 1]),
    rawMin: 0,
    rawMax: 1,
  };

  it('distinguishes nearest-density from uniform quantization', () => {
    expect(quantize(0.6, 1, uneven, 'light-on-dark', 'nearest-density')).toBe(code('c'));
    expect(quantize(0.6, 1, uneven, 'light-on-dark', 'uniform')).toBe(code('b'));
  });

  it('clamps brightness and omits transparent cells', () => {
    expect(quantize(-1, 1, uneven, 'light-on-dark')).toBe(code(' '));
    expect(quantize(2, 1, uneven, 'light-on-dark')).toBe(code('c'));
    expect(quantize(1, 0, uneven, 'light-on-dark')).toBe(0);
  });

  it.each(['light-on-dark', 'dark-on-light'] as const)(
    'round-trips every ramp glyph for %s polarity',
    (polarity) => {
      for (let i = 0; i < uneven.chars.length; i++) {
        const char = uneven.chars.charAt(i);
        const density = densityOfChar(uneven, char);
        expect(density).toBeDefined();
        expect(quantize(densityToLum(density ?? 0, polarity), 1, uneven, polarity)).toBe(
          code(char),
        );
      }
    },
  );
});
