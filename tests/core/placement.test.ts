import { describe, expect, it } from 'vitest';
import { placeRect, type Placement } from '../../src/core/placement.ts';
import { placeInGrid } from '../../src/core/import-image.ts';

const at = (fit: Placement['fit'], x = 0.5, y = 0.5, zoom = 1): Placement => ({ fit, x, y, zoom });

describe('placeRect', () => {
  it('cover fills the box and crops the overflow by position', () => {
    // 200x100 picture into a 100x100 box: scaled to 200x100, 100 px overflow.
    expect(placeRect(200, 100, 100, 100, at('cover', 0))).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(placeRect(200, 100, 100, 100, at('cover', 1))).toEqual({ x: -100, y: 0, w: 200, h: 100 });
    expect(placeRect(200, 100, 100, 100, at('cover'))).toEqual({ x: -50, y: 0, w: 200, h: 100 });
  });

  it('contain fits whole and leaves margins', () => {
    expect(placeRect(200, 100, 100, 100, at('contain', 0.5, 0))).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(placeRect(200, 100, 100, 100, at('contain', 0.5, 1))).toEqual({ x: 0, y: 50, w: 100, h: 50 });
  });

  it('stretch ignores the aspect; zoom scales around the position', () => {
    expect(placeRect(200, 100, 100, 100, at('stretch'))).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(placeRect(100, 100, 100, 100, at('cover', 0.5, 0.5, 2))).toEqual({ x: -50, y: -50, w: 200, h: 200 });
    expect(placeRect(100, 100, 100, 100, at('cover', 0, 1, 2))).toEqual({ x: 0, y: -100, w: 200, h: 200 });
  });

  it('clamps zoom and position', () => {
    expect(placeRect(100, 100, 100, 100, at('cover', 5, -1, 0.1))).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

describe('placeInGrid', () => {
  it('is isotropic: a square picture in a square grid area fills it', () => {
    // 20 cols of aspect 0.5 by 10 rows = a square area.
    const r = placeInGrid(50, 50, 20, 10, 0.5, at('contain'));
    expect(r.x).toBeCloseTo(0);
    expect(r.w).toBeCloseTo(1);
    expect(r.h).toBeCloseTo(1);
  });

  it('contain of a wide picture in a square area leaves top and bottom', () => {
    const r = placeInGrid(200, 100, 20, 10, 0.5, at('contain'));
    expect(r.w).toBeCloseTo(1);
    expect(r.h).toBeCloseTo(0.5);
    expect(r.y).toBeCloseTo(0.25);
  });
});
