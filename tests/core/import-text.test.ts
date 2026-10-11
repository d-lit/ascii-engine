import { afterEach, describe, expect, it, vi } from 'vitest';
import { importText, normalizeText } from '../../src/core/import-text.ts';
import { makeRamp } from '../../src/core/ramp.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeText', () => {
  it('normalizes line endings, expands tabs, and pads rows', () => {
    expect(normalizeText('a\tb\r\nc', 4)).toEqual(['a    b', 'c     ']);
  });
});

describe('importText', () => {
  const ramp = makeRamp(' @', [0, 1]);

  it('imports authored characters, alpha, luminance, and gradients', () => {
    const { field, warnings } = importText(' @\n@ ', ramp, {
      cellAspect: 0.5,
      polarity: 'light-on-dark',
    });

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
    });

    expect([...field.lum]).toEqual([1, 0]);
  });

  it('uses the supplied measurement for glyphs outside the ramp', () => {
    const measureChar = vi.fn(() => 0.4);
    const { field, warnings } = importText('XX', ramp, {
      cellAspect: 0.5,
      polarity: 'light-on-dark',
    }, { measureChar });

    expect(measureChar).toHaveBeenCalledTimes(1);
    expect(field.lum[0]).toBeCloseTo(0.4);
    expect(field.lum[1]).toBeCloseTo(0.4);
    expect(warnings).toEqual([]);
  });

  it('replaces a wide glyph and reports it to the caller and console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const withAscii = makeRamp(' A', [0, 1]);
    const { field, warnings } = importText('界A', withAscii, {
      cellAspect: 0.5,
      polarity: 'light-on-dark',
    });

    expect(field.char?.[0]).toBe(32);
    expect(field.alpha[0]).toBe(0);
    expect(warnings[0]).toContain('界');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('界'));
  });
});
