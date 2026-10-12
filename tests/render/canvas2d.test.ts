import { describe, expect, it } from 'vitest';
import { fillFrame, fitCell, fitFrame, pictureRect } from '../../src/render/canvas2d.ts';

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

describe('fitFrame', () => {
  it('keeps the frame aspect inside the box, on even sizes', () => {
    expect(fitFrame(1080, 1080, 1601, 900)).toEqual({ w: 900, h: 900 });
    expect(fitFrame(1080, 1920, 1000, 1000)).toEqual({ w: 562, h: 1000 });
    const r = fitFrame(1920, 1080, 777, 777);
    expect(r.w % 2 + (r.h % 2)).toBe(0);
    expect(r.w / r.h).toBeCloseTo(16 / 9, 1);
  });
});

describe('pictureRect', () => {
  it('maps grid fractions to frame pixels', () => {
    const grid = { x: 10, y: 20, w: 100, h: 50 };
    expect(pictureRect(grid, { x: 0, y: 0, w: 1, h: 1 })).toEqual(grid);
    expect(pictureRect(grid, { x: -0.5, y: 0.25, w: 2, h: 0.5 })).toEqual({ x: -40, y: 32.5, w: 200, h: 25 });
  });
});

describe('fillFrame', () => {
  it('picks integral cells nearest to filling the frame, no offset', () => {
    // 120 cols x 66 rows over 1080x1080: 9 px wide, 16.4 -> 16 px tall.
    expect(fillFrame(120, 66, 1080, 1080)).toEqual({ cellW: 9, cellH: 16, offsetX: 0, offsetY: 0 });
    const l = fillFrame(120, 66, 1280, 1280);
    expect(Math.abs(120 * l.cellW - 1280) / 1280).toBeLessThan(0.06);
    expect(fillFrame(300, 300, 100, 100)).toMatchObject({ cellW: 1, cellH: 1 });
  });
});
