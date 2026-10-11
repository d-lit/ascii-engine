import { describe, expect, it } from 'vitest';
import { createWorkBuffer, type WorkBuffer } from '../../src/core/field.ts';
import { makeRamp } from '../../src/core/ramp.ts';
import { alphaScale, Compositor, type MaskSource } from '../../src/render/compositor.ts';

const ramp = makeRamp(' .@', [0, 0.5, 1]);
const BG = [10, 20, 30] as const;
const FG = [250, 240, 230] as const;

/** 2x2 tiles: '@' solid, '.' one lit pixel (top-left), anything else blank. */
function fakeMasks(): MaskSource & { calls: number } {
  const tiles: Record<number, number[]> = {
    64: [255, 255, 255, 255],
    46: [255, 0, 0, 0],
  };
  const order: number[] = [];
  const src = {
    cellW: 2,
    cellH: 2,
    calls: 0,
    data: new Uint8Array(0),
    slot(code: number): number {
      src.calls++;
      const tile = tiles[code];
      if (!tile) return -1;
      let s = order.indexOf(code);
      if (s < 0) {
        s = order.push(code) - 1;
        const grown = new Uint8Array(order.length * 4);
        grown.set(src.data);
        grown.set(tile, s * 4);
        src.data = grown;
      }
      return s;
    },
  };
  return src;
}

function work(lums: number[], alphas?: number[]): WorkBuffer {
  const w = createWorkBuffer(lums.length, 1);
  w.lum.set(lums);
  w.alpha.set(alphas ?? lums.map(() => 1));
  return w;
}

function pixel(c: Compositor, x: number, y: number): number[] {
  const o = (y * c.width + x) * 4;
  return [...c.pixels.subarray(o, o + 4)];
}

function setup(cols: number) {
  const c = new Compositor(cols, 1, 2, 2);
  c.setColors(BG, FG);
  return c;
}

describe('alphaScale', () => {
  it('maps 0..1 onto 0..256 in 64 steps', () => {
    expect(alphaScale(1)).toBe(256);
    expect(alphaScale(2)).toBe(256);
    expect(alphaScale(0)).toBe(0);
    expect(alphaScale(0.5)).toBe(128);
    expect(alphaScale(0.501)).toBe(128);
  });
});

describe('Compositor', () => {
  it('draws glyph coverage through the bg -> fg palette', () => {
    const c = setup(3);
    c.compose(work([1, 0.5, 0]), ramp, 'light-on-dark', true, 'nearest-density', fakeMasks());

    // '@' fills its whole cell with fg.
    expect(pixel(c, 0, 0)).toEqual([...FG, 255]);
    expect(pixel(c, 1, 1)).toEqual([...FG, 255]);
    // '.' lights only its top-left pixel.
    expect(pixel(c, 2, 0)).toEqual([...FG, 255]);
    expect(pixel(c, 3, 1)).toEqual([...BG, 255]);
    // ' ' is background.
    expect(pixel(c, 4, 0)).toEqual([...BG, 255]);
    expect([c.dirtyTop, c.dirtyBottom]).toEqual([0, 2]);
  });

  it('blends partial alpha between bg and fg', () => {
    const c = setup(1);
    c.compose(work([1], [0.5]), ramp, 'light-on-dark', true, 'nearest-density', fakeMasks());
    const [r, g, b] = pixel(c, 0, 0);
    expect(r).toBeCloseTo((BG[0] + FG[0]) / 2, -1);
    expect(g).toBeCloseTo((BG[1] + FG[1]) / 2, -1);
    expect(b).toBeCloseTo((BG[2] + FG[2]) / 2, -1);
  });

  it('skips unchanged cells and reports a clean frame', () => {
    const c = setup(2);
    const masks = fakeMasks();
    const w = work([1, 1]);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    c.pixels.fill(0); // anything rewritten would show up
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    expect([...c.pixels].every((v) => v === 0)).toBe(true);
    expect(c.dirtyBottom).toBe(c.dirtyTop);
  });

  it('redraws only the changed cell, and everything after setColors', () => {
    const c = setup(2);
    const masks = fakeMasks();
    const w = work([1, 1]);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    c.pixels.fill(0);
    w.lum[1] = 0;
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    expect(pixel(c, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(c, 2, 0)).toEqual([...BG, 255]);

    c.setColors(FG, BG);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    expect(pixel(c, 0, 0)).toEqual([...BG, 255]);
  });

  it('treats a transparent glyph as background and honours charOverride', () => {
    const c = setup(2);
    const w = work([1, 0], [0, 1]);
    w.charOverride[1] = 64;
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', fakeMasks());
    expect(pixel(c, 0, 0)).toEqual([...BG, 255]);
    expect(pixel(c, 2, 0)).toEqual([...FG, 255]);
  });
});
