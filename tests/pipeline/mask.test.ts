import { describe, expect, it } from 'vitest';
import { createField } from '../../src/core/field.ts';
import { createMaskScratch, fillMask, type MaskSpec } from '../../src/pipeline/mask.ts';

// 11x5 grid; lum ramps along x 0..1; alpha 0 in column 0.
const src = createField(11, 5);
for (let y = 0; y < 5; y++) {
  for (let x = 0; x < 11; x++) {
    src.lum[y * 11 + x] = x / 10;
    src.alpha[y * 11 + x] = x === 0 ? 0 : 1;
  }
}
const frame = { cols: 11, rows: 5, pointer: { x: 2, y: 1, inside: true }, cellAspect: 0.5 };

function mask(spec: MaskSpec, t = 0): Float32Array {
  const out = new Float32Array(55);
  fillMask(spec, src, frame, t, createMaskScratch(), out);
  return out;
}
const at = (m: Float32Array, x: number, y: number) => m[y * 11 + x]!;

describe('fillMask', () => {
  it('alpha follows the source alpha, invert flips it', () => {
    expect(at(mask({ type: 'alpha' }), 0, 2)).toBe(0);
    expect(at(mask({ type: 'alpha' }), 5, 2)).toBe(1);
    expect(at(mask({ type: 'alpha', invert: true }), 0, 2)).toBe(1);
  });

  it('lum selects a brightness band, softly when asked', () => {
    // Bounds sit between float32 grid values to avoid rounding at the edge.
    const hard = mask({ type: 'lum', min: 0.25, max: 0.65 });
    expect([0.2, 0.3, 0.5, 0.6, 0.7].map((v) => at(hard, Math.round(v * 10), 0))).toEqual([0, 1, 1, 1, 0]);
    const soft = mask({ type: 'lum', min: 0.4, max: 1, soft: 0.2 });
    expect(at(soft, 3, 0)).toBeCloseTo(0.5);
    expect(at(soft, 1, 0)).toBe(0);
  });

  it('radial is isotropic and can follow the pointer', () => {
    const m = mask({ type: 'radial', center: 'center', radius: 4 });
    // centre (5, 2): 4 cells right and 2 rows down are both 4 cell widths away.
    expect(at(m, 9, 2)).toBe(1);
    expect(at(m, 5, 4)).toBe(1);
    expect(at(m, 10, 2)).toBe(0);
    const p = mask({ type: 'radial', center: 'pointer', radius: 0.5 });
    expect(at(p, 2, 1)).toBe(1);
    expect(at(p, 3, 1)).toBe(0);
  });

  it('radial radius can be modulated and the edge softened', () => {
    const grow: MaskSpec = { type: 'radial', center: 'center', radius: { env: [[0, 0], [1, 10]] } };
    expect(at(mask(grow, 0.2), 8, 2)).toBe(0); // radius 2
    expect(at(mask(grow, 0.5), 8, 2)).toBe(1); // radius 5
    const soft = mask({ type: 'radial', center: 'center', radius: 4, soft: 2 });
    expect(at(soft, 8, 2)).toBeCloseTo(0.5);
  });

  it('rect covers a normalized region and fades inward', () => {
    const m = mask({ type: 'rect', x: 0.2, y: 0, w: 0.5, h: 1 });
    expect([1, 2, 5, 7, 8].map((x) => at(m, x, 2))).toEqual([0, 1, 1, 1, 0]);
    const soft = mask({ type: 'rect', x: 0, y: 0, w: 1, h: 1, soft: 8 });
    // (5, 2): 5 widths to the side edges, 2 rows = 4 widths to top/bottom.
    expect(at(soft, 5, 2)).toBeCloseTo(0.5);
    expect(at(soft, 0, 2)).toBe(0);
  });
});
