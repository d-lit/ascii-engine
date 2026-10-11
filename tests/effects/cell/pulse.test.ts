import { describe, expect, it } from 'vitest';
import { pulse } from '../../../src/effects/cell/pulse.ts';
import { createPointer, Pipeline } from '../../../src/pipeline/pipeline.ts';
import type { ParamInput } from '../../../src/pipeline/params.ts';
import { flatField, meta } from '../helpers.ts';

/** Runs to t = 0.25 s: a quarter period at 1 Hz, so sin = 1 for global phase. */
function run(values: Record<string, ParamInput>, lum = 0.5) {
  const p = new Pipeline(flatField(9, 5, lum), meta, createPointer());
  p.add(pulse, { frequency: 1, amount: 0.2, ...values });
  for (let i = 0; i < 5; i++) p.frame(1 / 20);
  return p.frame(0);
}

describe('pulse', () => {
  it('shifts the whole picture in phase in global brightness mode', () => {
    const work = run({ shape: 'global' });
    for (const v of work.lum) expect(v).toBeCloseTo(0.7, 5);
  });

  it('scales around mid-grey in contrast mode', () => {
    const work = run({ shape: 'global', target: 'contrast' }, 0.8);
    // 0.5 + 0.3 * 1.2
    expect(work.lum[0]).toBeCloseTo(0.86, 5);
  });

  it('delays phase and fades with isotropic distance in radial mode', () => {
    const work = run({ shape: 'radial', center: 'center', wavelength: 1000, radius: 4 });
    const centre = work.lum[2 * 9 + 4]!;
    const right = work.lum[2 * 9 + 8]!; // 4 cell widths away
    const below = work.lum[4 * 9 + 4]!; // 2 rows = 4 cell widths away
    expect(centre).toBeCloseTo(0.7, 3);
    expect(right).toBeCloseTo(0.5 + 0.2 * Math.exp(-1), 2);
    expect(below).toBeCloseTo(right, 5);
  });
});
