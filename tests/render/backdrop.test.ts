import { describe, expect, it } from 'vitest';
import { backdropFill, fitRect } from '../../src/render/backdrop.ts';

const grid = { x: 40, y: 10, w: 200, h: 100 };

describe('fitRect', () => {
  it('grid lays the image exactly under the glyph grid', () => {
    expect(fitRect('grid', 999, 1, 300, 300, grid)).toEqual(grid);
  });

  it('stretch fills the frame', () => {
    expect(fitRect('stretch', 10, 10, 300, 200, grid)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });

  it('cover fills and crops, centred', () => {
    // 100x100 into 300x200: scale 3 -> 300x300, cropped top and bottom.
    expect(fitRect('cover', 100, 100, 300, 200, grid)).toEqual({ x: 0, y: -50, w: 300, h: 300 });
  });

  it('contain fits whole, centred with bars', () => {
    expect(fitRect('contain', 100, 100, 300, 200, grid)).toEqual({ x: 50, y: 0, w: 200, h: 200 });
  });
});

describe('backdropFill', () => {
  it('maps kinds to a fill colour or transparency', () => {
    expect(backdropFill({ kind: 'theme' }, '#111')).toBe('#111');
    expect(backdropFill({ kind: 'color', color: '#0f0' }, '#111')).toBe('#0f0');
    expect(backdropFill({ kind: 'transparent' }, '#111')).toBeNull();
  });
});
