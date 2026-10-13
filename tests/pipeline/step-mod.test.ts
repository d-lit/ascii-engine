import { describe, expect, it } from 'vitest';
import { analyseBands } from '../../src/audio/bands.ts';
import { createField } from '../../src/core/field.ts';
import { defineEffect } from '../../src/effects/types.ts';
import { resolveMod, setModEnv, stepValue } from '../../src/pipeline/modulation.ts';
import type { StepValue } from '../../src/pipeline/params.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';
import { isParamValue, isPointValue } from '../../src/presets/preset.ts';

const RATE = 22050;
// Bass bursts at 0.5, 1.5, 2.5 s (0.2 s long), silence between.
const samples = new Float32Array(RATE * 3);
for (let i = 0; i < samples.length; i++) {
  const t = i / RATE;
  samples[i] = t % 1 >= 0.5 && t % 1 < 0.7 ? 0.6 * Math.sin(2 * Math.PI * 70 * t) : 0;
}
const feed = { bands: analyseBands(samples, RATE), timing: { duration: 3, offset: 0, loop: false } };

function probe(values: Record<string, unknown>) {
  const seenN: number[] = [];
  const seenP: Array<[number, number]> = [];
  const def = defineEffect({
    id: 'probe-step',
    name: 'Probe',
    kind: 'cell',
    params: {
      amount: { type: 'number', min: 0, max: 10, default: 0 },
      at: { type: 'point', default: 'center' },
    },
    create: (p) => ({
      kind: 'cell',
      apply: (_c, x, y) => {
        if (x === 0 && y === 0) {
          seenN.push(p.amount);
          seenP.push([p.at.x, p.at.y]);
        }
      },
    }),
  });
  const pl = new Pipeline(createField(11, 11), { cellAspect: 1, polarity: 'light-on-dark' }, createPointer());
  pl.add(def, values as Record<string, number>);
  pl.setAudio(feed);
  return { pl, seenN, seenP };
}

/** Runs on in 1/40 s frames until the transport reaches `t` seconds. */
function runTo(pl: Pipeline, t: number): void {
  pl.frame(0);
  while (pl.ctx.time < t - 1e-9) pl.frame(1 / 40);
}

describe('step on audio: numbers', () => {
  const base: StepValue = { step: 'bass', threshold: 0.5, mode: 'cycle', min: 0, max: 10, values: [1, 5, 9] };

  it('stepValue: random in range and repeatable, cycle in turn, add wraps', () => {
    const r: StepValue = { ...base, mode: 'random' };
    for (let k = 0; k < 20; k++) {
      expect(stepValue(r, k)).toBeGreaterThanOrEqual(0);
      expect(stepValue(r, k)).toBeLessThan(10);
      expect(stepValue(r, k)).toBe(stepValue(r, k));
    }
    expect(stepValue({ ...r, seed: 1 }, 3)).not.toBe(stepValue(r, 3));
    expect([0, 1, 2, 3].map((k) => stepValue(base, k))).toEqual([1, 5, 9, 1]);
    expect([0, 1, 2, 3].map((k) => stepValue({ ...base, mode: 'add', by: 4 }, k))).toEqual([0, 4, 8, 2]);
  });

  it('holds between bass hits and moves on at each one', () => {
    const { pl, seenN } = probe({ amount: base });
    runTo(pl, 0.3);
    expect(seenN.at(-1)).toBe(1); // before the first hit
    runTo(pl, 0.8);
    expect(seenN.at(-1)).toBe(5); // after the hit at 0.5 s
    runTo(pl, 1.8);
    expect(seenN.at(-1)).toBe(9);
  });

  it('glides from the last value', () => {
    const { pl, seenN } = probe({ amount: { ...base, glide: 0.4 } });
    runTo(pl, 0.62); // ~0.1 s into the glide from 1 to 5
    const v = seenN.at(-1)!;
    expect(v).toBeGreaterThan(1);
    expect(v).toBeLessThan(5);
  });

  it('without a track: the first value', () => {
    setModEnv({ time: 1, audio: null });
    expect(resolveMod(base, 1)).toBe(1);
  });

  it('validates as a preset value; malformed ones do not', () => {
    expect(isParamValue(base)).toBe(true);
    expect(isParamValue({ ...base, mode: 'shuffle' })).toBe(false);
    expect(isParamValue({ step: 'bass', threshold: 0.5, mode: 'random' })).toBe(false);
  });
});

describe('step on audio: points', () => {
  it('grid: centre first, then a corner at the first hit', () => {
    const { pl, seenP } = probe({ at: { step: 'bass', threshold: 0.5, mode: 'grid' } });
    runTo(pl, 0.3);
    expect(seenP.at(-1)).toEqual([5, 5]);
    runTo(pl, 0.8);
    expect(seenP.at(-1)).toEqual([0, 0]);
  });

  it('random: stays inside its area, same on every run', () => {
    const area = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
    const a = probe({ at: { step: 'bass', threshold: 0.5, mode: 'random', area } });
    const b = probe({ at: { step: 'bass', threshold: 0.5, mode: 'random', area } });
    runTo(a.pl, 2);
    runTo(b.pl, 2);
    const [x, y] = a.seenP.at(-1)!;
    expect(x).toBeGreaterThanOrEqual(2);
    expect(x).toBeLessThanOrEqual(5);
    expect(y).toBeGreaterThanOrEqual(2);
    expect(y).toBeLessThanOrEqual(5);
    expect(b.seenP.at(-1)).toEqual([x, y]);
  });

  it('is a valid point in presets, and not a number value', () => {
    const v = { step: 'bass', threshold: 0.6, mode: 'list', points: [{ x: 0.1, y: 0.2 }], glide: 0.2 };
    expect(isPointValue(v)).toBe(true);
    expect(isParamValue(v)).toBe(false);
    expect(isPointValue({ ...v, mode: 'cycle' })).toBe(false);
  });
});
