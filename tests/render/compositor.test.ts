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
  c.setInk(FG);
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

// Uncovered pixels of the glyph layer are fully transparent (DECISIONS 020).
const CLEAR = [0, 0, 0, 0];

describe('Compositor', () => {
  it('draws glyph coverage as ink with alpha, transparent elsewhere', () => {
    const c = setup(3);
    c.compose(work([1, 0.5, 0]), ramp, 'light-on-dark', true, 'nearest-density', fakeMasks());

    // '@' fills its whole cell with opaque ink.
    expect(pixel(c, 0, 0)).toEqual([...FG, 255]);
    expect(pixel(c, 1, 1)).toEqual([...FG, 255]);
    // '.' lights only its top-left pixel.
    expect(pixel(c, 2, 0)).toEqual([...FG, 255]);
    expect(pixel(c, 3, 1)).toEqual(CLEAR);
    // ' ' leaves the layer clear.
    expect(pixel(c, 4, 0)).toEqual(CLEAR);
    expect([c.dirtyTop, c.dirtyBottom]).toEqual([0, 2]);
  });

  it('leaves a hidden cell empty: a sprite draws it (SPEC 6.3)', () => {
    const c = setup(2);
    const w = work([1, 1]);
    w.hidden[1] = 1;
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', fakeMasks());
    expect(pixel(c, 0, 0)).toEqual([...FG, 255]);
    expect(pixel(c, 2, 0)).toEqual(CLEAR);
  });

  it('turns partial cell alpha into pixel alpha, not into a blend', () => {
    const c = setup(1);
    c.compose(work([1], [0.5]), ramp, 'light-on-dark', true, 'nearest-density', fakeMasks());
    expect(pixel(c, 0, 0)).toEqual([...FG, 127]);
  });

  it('skips unchanged cells and reports a clean frame', () => {
    const c = setup(2);
    const masks = fakeMasks();
    const w = work([1, 1]);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    c.pixels.fill(7); // anything rewritten would show up
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    expect([...c.pixels].every((v) => v === 7)).toBe(true);
    expect(c.dirtyBottom).toBe(c.dirtyTop);
  });

  it('redraws only the changed cell, and everything after setInk', () => {
    const c = setup(2);
    const masks = fakeMasks();
    const w = work([1, 1]);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    c.pixels.fill(7);
    w.lum[1] = 0;
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    expect(pixel(c, 0, 0)).toEqual([7, 7, 7, 7]);
    expect(pixel(c, 2, 0)).toEqual(CLEAR);

    c.setInk(BG);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    expect(pixel(c, 0, 0)).toEqual([...BG, 255]);
  });

  it('treats a transparent glyph as empty and honours charOverride', () => {
    const c = setup(2);
    const w = work([1, 0], [0, 1]);
    w.charOverride[1] = 64;
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', fakeMasks());
    expect(pixel(c, 0, 0)).toEqual(CLEAR);
    expect(pixel(c, 2, 0)).toEqual([...FG, 255]);
  });
});

describe('Compositor colour path', () => {
  function colored(lums: number[], inks: number[][], alphas?: number[]): WorkBuffer {
    const w = work(lums, alphas);
    w.color = new Uint8ClampedArray(inks.flat());
    return w;
  }

  it('draws each cell in its own ink, transparent where uncovered', () => {
    const c = setup(2);
    const w = colored([1, 0.5], [[255, 0, 0], [0, 0, 255]]);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', fakeMasks());
    expect(pixel(c, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(c, 2, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(c, 3, 1)).toEqual(CLEAR);
  });

  it('keeps the exact ink and puts cell alpha into pixel alpha', () => {
    const c = setup(1);
    c.compose(colored([1], [[250, 240, 230]], [0.5]), ramp, 'light-on-dark', true, 'nearest-density', fakeMasks());
    expect(pixel(c, 0, 0)).toEqual([250, 240, 230, 127]);
  });

  it('redraws a cell when only its ink changes, skips it otherwise', () => {
    const c = setup(2);
    const masks = fakeMasks();
    const w = colored([1, 1], [[255, 0, 0], [255, 0, 0]]);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    c.pixels.fill(7);
    w.color![3] = 0;
    w.color![4] = 255;
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    expect(pixel(c, 0, 0)).toEqual([7, 7, 7, 7]);
    expect(pixel(c, 2, 0)).toEqual([0, 255, 0, 255]);
  });

  it('redraws everything when switching between mono and colour', () => {
    const c = setup(1);
    const masks = fakeMasks();
    const w = work([1]);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    w.color = new Uint8ClampedArray([0, 255, 0]);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    expect(pixel(c, 0, 0)).toEqual([0, 255, 0, 255]);
    w.color = null;
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    expect(pixel(c, 0, 0)).toEqual([...FG, 255]);
  });
});

describe('Compositor plated path', () => {
  function plated(lums: number[], plates: number[][], alphas?: number[]): WorkBuffer {
    const w = work(lums, alphas);
    w.plate = new Uint8ClampedArray(plates.flat());
    return w;
  }

  it('shows the plate where there is no ink, ink over it where covered', () => {
    const c = setup(2);
    const w = plated([0.5, 0], [[0, 0, 255, 255], [0, 255, 0, 128]]);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', fakeMasks());
    // '.': lit pixel is opaque ink, the rest is the plate.
    expect(pixel(c, 0, 0)).toEqual([...FG, 255]);
    expect(pixel(c, 1, 0)).toEqual([0, 0, 255, 255]);
    // ' ' with a half plate: just the plate.
    expect(pixel(c, 2, 0)).toEqual([0, 255, 0, 128]);
  });

  it('blends half-alpha ink over an opaque plate into an opaque pixel', () => {
    const c = setup(1);
    c.compose(plated([1], [[0, 0, 0, 255]], [0.5]), ramp, 'light-on-dark', true, 'nearest-density', fakeMasks());
    const [r, g, b, a] = pixel(c, 0, 0);
    expect(a).toBe(255);
    expect(Math.abs(r! - FG[0] / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(g! - FG[1] / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(b! - FG[2] / 2)).toBeLessThanOrEqual(2);
  });

  it('stays clear without glyph and plate, redraws when only the plate changes', () => {
    const c = setup(1);
    const masks = fakeMasks();
    const w = plated([0], [[0, 0, 0, 0]]);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    expect(pixel(c, 0, 0)).toEqual(CLEAR);
    w.plate!.set([255, 0, 0, 255]);
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    expect(pixel(c, 0, 0)).toEqual([255, 0, 0, 255]);
  });
});
