import { describe, expect, it } from 'vitest';
import { createWorkBuffer } from '../../src/core/field.ts';
import { makeRamp } from '../../src/core/ramp.ts';
import { resolveCellChar } from '../../src/render/cell-char.ts';

const ramp = makeRamp(' .@', [0, 0.5, 1]);
const code = (c: string) => c.charCodeAt(0);

describe('resolveCellChar', () => {
  const work = createWorkBuffer(4, 1);
  work.lum.set([1, 1, 1, 1]);
  work.alpha.set([1, 1, 1, 0]);
  work.char.set([0, code('A'), code('A'), code('A')]);
  work.charOverride.set([0, 0, code('Z'), code('Z')]);

  it('applies charOverride -> char -> quantize', () => {
    expect(resolveCellChar(work, 0, ramp, 'light-on-dark', true, 'nearest-density')).toBe(code('@'));
    expect(resolveCellChar(work, 1, ramp, 'light-on-dark', true, 'nearest-density')).toBe(code('A'));
    expect(resolveCellChar(work, 2, ramp, 'light-on-dark', true, 'nearest-density')).toBe(code('Z'));
  });

  it('ignores authored chars when useSourceChars is off, but never the override', () => {
    expect(resolveCellChar(work, 1, ramp, 'light-on-dark', false, 'nearest-density')).toBe(code('@'));
    expect(resolveCellChar(work, 2, ramp, 'light-on-dark', false, 'nearest-density')).toBe(code('Z'));
  });

  it('returns 0 for a transparent cell regardless of overrides', () => {
    expect(resolveCellChar(work, 3, ramp, 'light-on-dark', true, 'nearest-density')).toBe(0);
  });
});
