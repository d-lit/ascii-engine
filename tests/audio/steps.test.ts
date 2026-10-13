import { describe, expect, it } from 'vitest';
import type { BandTable } from '../../src/audio/bands.ts';
import { crossings, stepAt } from '../../src/audio/steps.ts';

function table(bass: number[]): BandTable {
  const z = new Float32Array(bass.length);
  const b = Float32Array.from(bass);
  return { hop: 0.01, length: bass.length, bands: { level: z, bass: b, mid: z, high: z }, sums: { level: new Float64Array(), bass: new Float64Array(), mid: new Float64Array(), high: new Float64Array() } };
}

describe('crossings', () => {
  it('counts rises through the threshold, with hysteresis against flicker', () => {
    // Up at 2, wobbles near the threshold (no new step), falls, up again at 9.
    const t = table([0, 0.2, 0.8, 0.65, 0.75, 0.66, 0.3, 0.2, 0.4, 0.9, 0.9]);
    expect([...crossings(t, 'bass', 0.7)]).toEqual([2, 9]);
    // Cached: the same list object.
    expect(crossings(t, 'bass', 0.7)).toBe(crossings(t, 'bass', 0.701));
  });

  it('gives the step index at a position', () => {
    const list = Int32Array.of(2, 9);
    expect(stepAt(list, 0.01, 0)).toBe(0);
    expect(stepAt(list, 0.01, 0.025)).toBe(1);
    expect(stepAt(list, 0.01, 0.09)).toBe(2);
    expect(stepAt(list, 0.01, 5)).toBe(2);
  });
});
