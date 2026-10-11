import { describe, expect, it } from 'vitest';
import { createField } from '../../src/core/field.ts';
import { distIso, sampleAlpha, sampleColor, sampleLum } from '../../src/core/sample.ts';

/** 3x2 field, lum = x + 10 * y (scaled), so bilinear values are easy to predict. */
function field() {
  const f = createField(3, 2, { color: true });
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 3; x++) {
      const i = y * 3 + x;
      f.lum[i] = (x + 10 * y) / 100;
      f.alpha[i] = x === 0 ? 0 : 1;
      f.color!.set([x * 100, y * 200, 50], i * 3);
    }
  }
  return f;
}

describe('sampleLum / sampleAlpha', () => {
  const f = field();

  it('returns exact values at cell centres', () => {
    expect(sampleLum(f, 2, 1)).toBeCloseTo(0.12);
    expect(sampleLum(f, 0, 0)).toBeCloseTo(0);
  });

  it('interpolates bilinearly between centres', () => {
    expect(sampleLum(f, 0.5, 0)).toBeCloseTo(0.005);
    expect(sampleLum(f, 1, 0.5)).toBeCloseTo(0.06);
    expect(sampleLum(f, 1.5, 0.5)).toBeCloseTo(0.065);
    expect(sampleAlpha(f, 0.25, 0)).toBeCloseTo(0.25);
  });

  it('clamps outside the grid to the edge', () => {
    expect(sampleLum(f, -5, -5)).toBeCloseTo(0);
    expect(sampleLum(f, 9, 9)).toBeCloseTo(0.12);
    expect(sampleLum(f, 1, -3)).toBeCloseTo(0.01);
  });
});

describe('sampleColor', () => {
  it('interpolates RGB and leaves out alone without colour', () => {
    const out = { r: -1, g: -1, b: -1 };
    sampleColor(field(), 0.5, 0.5, out);
    expect(out).toEqual({ r: 50, g: 100, b: 50 });

    const plain = createField(1, 1);
    const kept = { r: 7, g: 7, b: 7 };
    sampleColor(plain, 0, 0, kept);
    expect(kept).toEqual({ r: 7, g: 7, b: 7 });
  });
});

describe('distIso', () => {
  it('counts rows as 1 / cellAspect cell widths', () => {
    expect(distIso(3, 0, 0.5)).toBe(3);
    expect(distIso(0, 2, 0.5)).toBe(4);
    expect(distIso(3, 2, 0.5)).toBe(5);
  });
});
