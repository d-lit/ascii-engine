import { describe, expect, it } from 'vitest';
import { fitCell } from '../../src/render/canvas2d.ts';

describe('fitCell', () => {
  it.each([
    [100, 100, 0.5],
    [100, 10, 0.55],
    [6, 11, 0.55],
    [40, 17, 0.6],
    [9, 30, 0.5],
  ])('fits %i x %i at aspect %f within bounds and 2%% error', (maxW, maxH, aspect) => {
    const { w, h } = fitCell(maxW, maxH, aspect);
    expect(Number.isInteger(w) && Number.isInteger(h)).toBe(true);
    expect(w).toBeLessThanOrEqual(maxW);
    expect(h).toBeLessThanOrEqual(maxH);
    expect(Math.abs(w / h - aspect) / aspect).toBeLessThanOrEqual(0.02);
  });

  it('prefers the largest cell that is accurate enough', () => {
    expect(fitCell(100, 20, 0.5)).toEqual({ w: 10, h: 20 });
    // h = 10 rounds w to 6 (9% off); h = 9 gives w = 5 (1% off).
    expect(fitCell(100, 10, 0.55)).toEqual({ w: 5, h: 9 });
  });

  it('falls back to the least distorted cell when nothing is within tolerance', () => {
    const { w, h } = fitCell(1, 3, 0.55);
    expect([w, h]).toEqual([1, 2]);
  });
});
