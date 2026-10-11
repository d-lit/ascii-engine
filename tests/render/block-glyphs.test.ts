import { describe, expect, it } from 'vitest';
import {
  BLOCK_DARK,
  BLOCK_FULL,
  BLOCK_LEFT,
  BLOCK_LIGHT,
  BLOCK_LOWER,
  BLOCK_MEDIUM,
  BLOCK_RIGHT,
  BLOCK_UPPER,
  blockGlyphDensity,
  drawBlockGlyph,
  isBlockGlyph,
  type RectSink,
} from '../../src/render/block-glyphs.ts';

/** Rasterizes fillRect calls into a coverage grid. */
function rasterize(code: number, w: number, h: number): Uint8Array {
  const grid = new Uint8Array(w * h);
  const sink: RectSink = {
    fillStyle: '',
    fillRect(x, y, rw, rh) {
      for (let py = y; py < y + rh; py++) {
        for (let px = x; px < x + rw; px++) {
          expect(Number.isInteger(px) && Number.isInteger(py)).toBe(true);
          expect(px >= 0 && px < w && py >= 0 && py < h).toBe(true);
          grid[py * w + px] = 1;
        }
      }
    },
  };
  drawBlockGlyph(sink, code, 0, 0, w, h, '#fff');
  return grid;
}

function coverage(grid: Uint8Array): number {
  let sum = 0;
  for (const v of grid) sum += v;
  return sum / grid.length;
}

const SIZES: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [2, 2],
  [3, 5],
  [4, 4],
  [6, 9],
  [7, 13],
  [8, 16],
  [11, 22],
];

const ALL = [
  BLOCK_LIGHT,
  BLOCK_MEDIUM,
  BLOCK_DARK,
  BLOCK_FULL,
  BLOCK_UPPER,
  BLOCK_LOWER,
  BLOCK_LEFT,
  BLOCK_RIGHT,
];

describe('block glyphs', () => {
  it('recognizes only block glyphs', () => {
    for (const code of ALL) expect(isBlockGlyph(code)).toBe(true);
    expect(isBlockGlyph(0x20)).toBe(false);
    expect(isBlockGlyph(0x40)).toBe(false);
    expect(blockGlyphDensity(0x40, 4, 4)).toBeUndefined();
  });

  it.each(SIZES)('drawn coverage equals declared density on %ix%i', (w, h) => {
    for (const code of ALL) {
      expect(coverage(rasterize(code, w, h))).toBeCloseTo(blockGlyphDensity(code, w, h) ?? -1, 9);
    }
  });

  it.each(SIZES)('shades light round(d * w * h) pixels on %ix%i', (w, h) => {
    const n = w * h;
    expect(coverage(rasterize(BLOCK_LIGHT, w, h)) * n).toBe(Math.round(0.25 * n));
    expect(coverage(rasterize(BLOCK_MEDIUM, w, h)) * n).toBe(Math.round(0.5 * n));
    expect(coverage(rasterize(BLOCK_DARK, w, h)) * n).toBe(Math.round(0.75 * n));
  });

  it.each(SIZES.filter(([w, h]) => w * h >= 4))('shades are strictly monotonic on %ix%i', (w, h) => {
    const d = [BLOCK_LIGHT, BLOCK_MEDIUM, BLOCK_DARK, BLOCK_FULL].map(
      (code) => blockGlyphDensity(code, w, h) ?? -1,
    );
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeGreaterThan(d[i - 1]!);
  });

  it('nests shades: a denser shade covers every pixel of a lighter one', () => {
    const light = rasterize(BLOCK_LIGHT, 8, 16);
    const medium = rasterize(BLOCK_MEDIUM, 8, 16);
    for (let i = 0; i < light.length; i++) if (light[i]) expect(medium[i]).toBe(1);
  });

  it.each(SIZES)('opposite halves tile the cell exactly on %ix%i', (w, h) => {
    for (const [a, b] of [
      [BLOCK_UPPER, BLOCK_LOWER],
      [BLOCK_LEFT, BLOCK_RIGHT],
    ] as const) {
      const ga = rasterize(a, w, h);
      const gb = rasterize(b, w, h);
      for (let i = 0; i < ga.length; i++) expect(ga[i]! + gb[i]!).toBe(1);
    }
  });
});
