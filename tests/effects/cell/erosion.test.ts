import { describe, expect, it } from 'vitest';
import { erosion } from '../../../src/effects/cell/erosion.ts';
import { createPointer, Pipeline } from '../../../src/pipeline/pipeline.ts';
import type { ParamInput } from '../../../src/pipeline/params.ts';
import { flatField, meta } from '../helpers.ts';

function run(values: Record<string, ParamInput>, dt = 0) {
  const p = new Pipeline(flatField(16, 8), meta, createPointer());
  p.add(erosion, values);
  return p.frame(dt);
}

const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;

describe('erosion', () => {
  it('keeps everything at threshold 0 and erodes everything at 1', () => {
    expect([...run({ threshold: 0 }).alpha].every((a) => a === 1)).toBe(true);
    expect([...run({ threshold: 1, softness: 0 }).alpha].every((a) => a === 0)).toBe(true);
  });

  it('erodes more as the threshold rises', () => {
    const low = mean(run({ threshold: 0.35 }).alpha);
    const high = mean(run({ threshold: 0.6 }).alpha);
    expect(high).toBeLessThan(low);
    expect(low).toBeLessThan(1);
  });

  it('darkens instead of hiding in darken mode', () => {
    const work = run({ threshold: 0.6, mode: 'darken' });
    expect([...work.alpha].every((a) => a === 1)).toBe(true);
    expect(mean(work.lum)).toBeLessThan(0.5);
  });

  it('animates with time unless speed is 0', () => {
    const a = run({ threshold: 0.5, speed: 1 }, 0);
    const b = run({ threshold: 0.5, speed: 1 }, 1 / 20);
    const c = run({ threshold: 0.5, speed: 0 }, 1 / 20);
    expect([...b.alpha]).not.toEqual([...a.alpha]);
    expect([...c.alpha]).toEqual([...a.alpha]);
  });
});
