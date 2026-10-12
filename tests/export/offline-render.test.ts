import { describe, expect, it } from 'vitest';
import { layoutFrame } from '../../src/export/offline-render.ts';

describe('layoutFrame', () => {
  it.each([
    [120, 66, 0.55, 1080, 1080],
    [200, 110, 0.55, 1080, 1920],
    [80, 30, 0.55, 1920, 1080],
    [300, 165, 0.55, 1080, 1350],
  ])('fits %ix%i (aspect %f) into %ix%i, centred on even offsets', (cols, rows, aspect, w, h) => {
    const l = layoutFrame(cols, rows, aspect, w, h);
    expect(cols * l.cellW + 2 * l.offsetX).toBeLessThanOrEqual(w);
    expect(rows * l.cellH + 2 * l.offsetY).toBeLessThanOrEqual(h);
    expect(l.offsetX % 2).toBe(0);
    expect(l.offsetY % 2).toBe(0);
    // Centred within a couple of pixels.
    expect(Math.abs(w - cols * l.cellW - 2 * l.offsetX)).toBeLessThanOrEqual(3);
    expect(Math.abs(h - rows * l.cellH - 2 * l.offsetY)).toBeLessThanOrEqual(3);
    expect(Math.abs(l.cellW / l.cellH - aspect) / aspect).toBeLessThanOrEqual(0.12);
  });

  it('uses the largest cell that fits', () => {
    expect(layoutFrame(100, 50, 0.5, 1000, 1000)).toEqual({ cellW: 10, cellH: 20, offsetX: 0, offsetY: 0 });
  });
});
