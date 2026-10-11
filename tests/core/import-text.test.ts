import { afterEach, describe, expect, it, vi } from 'vitest';
import { importText, isUnsupported, normalizeText } from '../../src/core/import-text.ts';
import type { FieldMeta } from '../../src/core/field.ts';
import { makeRamp, type DensityMeasurer } from '../../src/core/ramp.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const lightOnDark: FieldMeta = { cellAspect: 0.5, polarity: 'light-on-dark' };
const unusedMeasurer: DensityMeasurer = (char) => {
  throw new Error(`unexpected measurement of ${char}`);
};

describe('normalizeText', () => {
  it('normalizes line endings, expands tabs, and pads rows', () => {
    expect(normalizeText('a\tb\r\nc', 4).map((row) => row.join(''))).toEqual([
      'a    b',
      'c     ',
    ]);
  });

  it('keeps a combining sequence in one cell', () => {
    const [row] = normalizeText('éx');
    expect(row).toEqual(['é', 'x']);
  });
});

describe('isUnsupported', () => {
  it.each([
    ['界', true],
    ['é', true],
    ['⃗', true],
    ['️', true],
    ['😀', true],
    ['A', false],
    ['░', false],
  ])('%j -> %s', (cluster, expected) => {
    expect(isUnsupported(cluster)).toBe(expected);
  });
});

describe('importText', () => {
  const ramp = makeRamp(' @', [0, 1]);

  it('imports authored characters, alpha, luminance, and gradients', () => {
    const { field, warnings } = importText(' @\n@ ', ramp, lightOnDark, unusedMeasurer);

    expect(warnings).toEqual([]);
    expect([field.cols, field.rows]).toEqual([2, 2]);
    expect([...(field.char ?? [])]).toEqual([32, 64, 64, 32]);
    expect([...field.alpha]).toEqual([0, 1, 1, 0]);
    expect([...field.lum]).toEqual([0, 1, 1, 0]);
    expect(field.gradX?.some((value) => value !== 0)).toBe(true);
    expect(field.gradY?.some((value) => value !== 0)).toBe(true);
  });

  it('applies dark-on-light polarity at the text boundary', () => {
    const { field } = importText(' @', ramp, {
      cellAspect: 0.5,
      polarity: 'dark-on-light',
    }, unusedMeasurer);

    expect([...field.lum]).toEqual([1, 0]);
  });

  it('measures glyphs outside the ramp once', () => {
    const measure = vi.fn(() => 0.4);
    const { field, warnings } = importText('XX', ramp, lightOnDark, measure);

    expect(measure).toHaveBeenCalledTimes(1);
    expect(field.lum[0]).toBeCloseTo(0.4);
    expect(field.lum[1]).toBeCloseTo(0.4);
    expect(warnings).toEqual([]);
  });

  it('places outside glyphs on the ramp scale, not the raw one', () => {
    // Raw ramp range 0.1..0.5: raw 0.3 is the middle, raw 0.9 is past the densest glyph.
    const narrow = makeRamp(' @', [0.1, 0.5]);
    const measure: DensityMeasurer = (char) => (char === 'X' ? 0.3 : 0.9);
    const { field } = importText('XW', narrow, lightOnDark, measure);

    expect(field.lum[0]).toBeCloseTo(0.5);
    expect(field.lum[1]).toBeCloseTo(1);
  });

  it('replaces a wide glyph and reports it to the caller and console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const withAscii = makeRamp(' A', [0, 1]);
    const { field, warnings } = importText('界A', withAscii, lightOnDark, unusedMeasurer);

    expect(field.char?.[0]).toBe(32);
    expect(field.alpha[0]).toBe(0);
    expect(warnings[0]).toContain('界');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('界'));
  });

  it('drops a combining sequence as one cell, keeping columns aligned', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const withAscii = makeRamp(' A', [0, 1]);
    const { field } = importText('éA\nAAA', withAscii, lightOnDark, unusedMeasurer);

    expect(field.cols).toBe(3);
    expect([...(field.char ?? [])].slice(0, 3)).toEqual([32, 65, 32]);
  });
});
