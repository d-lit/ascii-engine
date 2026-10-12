import { describe, expect, it } from 'vitest';
import { createWorkBuffer, type WorkBuffer } from '../../src/core/field.ts';
import { makeRamp } from '../../src/core/ramp.ts';
import { resolveCellChar } from '../../src/render/cell-char.ts';
import { exportText, type TextExportOptions } from '../../src/render/export-text.ts';

const ramp = makeRamp(' .@', [0, 0.5, 1]);
const opts: TextExportOptions = { useSourceChars: true, quantizeMode: 'nearest-density', trimRight: false };
const code = (c: string) => c.charCodeAt(0);

/** 3x2: row 0 = '@ . space', row 1 all bright. */
function grid(): WorkBuffer {
  const w = createWorkBuffer(3, 2);
  w.lum.set([1, 0.5, 0, 1, 1, 1]);
  w.alpha.fill(1);
  return w;
}

describe('exportText', () => {
  it('quantizes lum row by row with a trailing newline', () => {
    expect(exportText(grid(), ramp, 'light-on-dark', opts)).toBe('@. \n@@@\n');
  });

  it('exports a transparent cell as a space even with an override', () => {
    const w = grid();
    w.alpha[0] = 0;
    w.charOverride[0] = code('Z');
    expect(exportText(w, ramp, 'light-on-dark', opts)).toBe(' . \n@@@\n');
  });

  it('puts sprites in the nearest cell and leaves the cells they came from empty', () => {
    const w = grid();
    w.hidden[0] = 1; // '@' flew away...
    w.sprites.x[0] = 2.4; // ...to the nearest cell (2, 1)
    w.sprites.y[0] = 0.6;
    w.sprites.src[0] = 0;
    w.sprites.alpha[0] = 1;
    w.sprites.count = 1;
    w.lum.set([0, 0, 0], 3);
    expect(exportText(w, ramp, 'light-on-dark', opts)).toBe(' . \n  @\n');
  });

  it('trims trailing spaces but keeps every row, including empty ones', () => {
    const w = grid();
    w.lum.set([0, 0, 0], 3);
    const text = exportText(w, ramp, 'light-on-dark', { ...opts, trimRight: true });
    expect(text).toBe('@.\n\n');
    expect(text.split('\n').length - 1).toBe(w.rows);
  });

  it('honours useSourceChars, while charOverride always wins', () => {
    const w = grid();
    w.char[0] = code('A');
    w.char[1] = code('B');
    w.charOverride[1] = code('Z');
    expect(exportText(w, ramp, 'light-on-dark', opts).slice(0, 2)).toBe('AZ');
    expect(exportText(w, ramp, 'light-on-dark', { ...opts, useSourceChars: false }).slice(0, 2)).toBe('@Z');
  });

  it('inverts glyph choice for dark-on-light', () => {
    expect(exportText(grid(), ramp, 'dark-on-light', opts)).toBe(' .@\n   \n');
  });

  it('matches resolveCellChar for every cell', () => {
    const w = createWorkBuffer(7, 5);
    for (let i = 0; i < w.lum.length; i++) {
      w.lum[i] = (i * 37) % 100 / 100;
      w.alpha[i] = i % 6 === 0 ? 0 : 1;
      if (i % 5 === 0) w.charOverride[i] = code('#');
    }
    const lines = exportText(w, ramp, 'light-on-dark', opts).split('\n');
    for (let y = 0; y < w.rows; y++) {
      for (let x = 0; x < w.cols; x++) {
        const c = resolveCellChar(w, y * w.cols + x, ramp, 'light-on-dark', true, 'nearest-density');
        expect(lines[y]!.charCodeAt(x)).toBe(c === 0 ? 32 : c);
      }
    }
  });
});
