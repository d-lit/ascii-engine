import { describe, expect, it } from 'vitest';
import { wave } from '../../../src/effects/cell/wave.ts';
import { createPointer, Pipeline } from '../../../src/pipeline/pipeline.ts';
import { flatField, meta } from '../helpers.ts';

function run(values: Record<string, number>, dt = 0) {
  const p = new Pipeline(flatField(8, 4), meta, createPointer());
  p.add(wave, values);
  return p.frame(dt);
}

describe('wave', () => {
  it('adds a sine of the given amplitude along x at time 0', () => {
    const work = run({ direction: 0, wavelength: 8, amplitude: 0.25, speed: 0 });
    for (let x = 0; x < 8; x++) {
      expect(work.lum[x]).toBeCloseTo(0.5 + 0.25 * Math.sin((2 * Math.PI * x) / 8), 5);
      // Constant along the wavefront (rows).
      expect(work.lum[3 * 8 + x]).toBeCloseTo(work.lum[x]!, 5);
    }
  });

  it('measures vertical distance in cell widths (isotropy)', () => {
    // cellAspect 0.5: one row = two cell widths, so wavelength 8 spans 4 rows.
    const work = run({ direction: 90, wavelength: 8, amplitude: 0.25, speed: 0 });
    expect(work.lum[1 * 8]).toBeCloseTo(0.5 + 0.25 * Math.sin((2 * Math.PI * 2) / 8), 5);
    expect(work.lum[2 * 8]).toBeCloseTo(0.5, 5);
  });

  it('travels with time and is silent at zero amplitude', () => {
    // Same frame time, only speed differs: a moving wave has shifted phase.
    const moving = run({ direction: 0, wavelength: 8, amplitude: 0.25, speed: 0.25 }, 1 / 20);
    const still = run({ direction: 0, wavelength: 8, amplitude: 0.25, speed: 0 }, 1 / 20);
    expect(moving.lum[0]).not.toBeCloseTo(still.lum[0]!, 3);
    const flat = run({ amplitude: 0 });
    expect([...flat.lum].every((v) => v === 0.5)).toBe(true);
  });
});
