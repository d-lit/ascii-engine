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

describe('per-cell ramp (DECISIONS 030)', () => {
  it('quantizes a cell with its selected built-in ramp; 0 keeps the main one', async () => {
    const { createWorkBuffer } = await import('../../src/core/field.ts');
    const { makeRamp } = await import('../../src/core/ramp.ts');
    const { resolveCellChar } = await import('../../src/render/cell-char.ts');
    const blocks = makeRamp(' █', [0, 1]);
    const main = { ...makeRamp(' @', [0, 1]), alt: [blocks] };
    const w = createWorkBuffer(2, 1);
    w.lum.fill(1);
    w.alpha.fill(1);
    w.rampSel[1] = 1;
    expect(resolveCellChar(w, 0, main, 'light-on-dark', true, 'nearest-density')).toBe('@'.charCodeAt(0));
    expect(resolveCellChar(w, 1, main, 'light-on-dark', true, 'nearest-density')).toBe('█'.charCodeAt(0));
    // charOverride still wins.
    w.charOverride[1] = 'Z'.charCodeAt(0);
    expect(resolveCellChar(w, 1, main, 'light-on-dark', true, 'nearest-density')).toBe('Z'.charCodeAt(0));
  });
});
