import { describe, expect, it } from 'vitest';
import { createField } from '../../src/core/field.ts';
import { defineEffect } from '../../src/effects/types.ts';
import {
  envAt,
  lfoUnit,
  registerModSource,
  resolveMod,
} from '../../src/pipeline/modulation.ts';
import { resolveNumber, type NumberSpec, type ParamInput } from '../../src/pipeline/params.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

const spec: NumberSpec = { type: 'number', min: 0, max: 10, default: 5 };

describe('lfoUnit', () => {
  it.each([
    // shape, [u = 0, 0.25, 0.5, 0.75]
    ['sine', [0, 0.5, 1, 0.5]],
    ['triangle', [0, 0.5, 1, 0.5]],
    ['saw', [0, 0.25, 0.5, 0.75]],
    ['square', [0, 0, 1, 1]],
  ] as const)('%s hits its key points and repeats every cycle', (shape, expected) => {
    [0, 0.25, 0.5, 0.75].forEach((u, k) => {
      expect(lfoUnit(shape, u)).toBeCloseTo(expected[k]!, 9);
      expect(lfoUnit(shape, u + 3)).toBeCloseTo(expected[k]!, 9);
    });
  });

  it('noise is smooth, in 0..1, and passes through a new level each cycle', () => {
    let prev = lfoUnit('noise', 0);
    for (let u = 0.01; u < 5; u += 0.01) {
      const v = lfoUnit('noise', u);
      expect(v >= 0 && v <= 1).toBe(true);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
    const levels = new Set([0, 1, 2, 3, 4].map((n) => lfoUnit('noise', n).toFixed(6)));
    expect(levels.size).toBe(5);
  });
});

describe('LFO values', () => {
  it('maps the waveform onto min..max at freq and phase', () => {
    const lfo = { lfo: 'sine', freq: 2, min: 2, max: 6 } as const;
    expect(resolveNumber(spec, lfo, 0)).toBeCloseTo(2);
    expect(resolveNumber(spec, lfo, 0.25)).toBeCloseTo(6); // half a cycle at 2 Hz
    expect(resolveNumber(spec, { ...lfo, phase: 0.5 }, 0)).toBeCloseTo(6);
  });

  it('clamps to the spec and rejects malformed values', () => {
    expect(resolveNumber(spec, { lfo: 'saw', freq: 1, min: -5, max: 50 }, 0.9)).toBe(10);
    const bad = [
      { lfo: 'wobble', freq: 1, min: 0, max: 1 },
      { lfo: 'sine', freq: Number.NaN, min: 0, max: 1 },
      { lfo: 'sine', min: 0, max: 1 },
      { nothing: true },
    ];
    for (const v of bad) expect(resolveNumber(spec, v as unknown as ParamInput, 1)).toBe(5);
  });
});

describe('envelopes', () => {
  const env = { env: [[0, 0], [1, 10], [3, 4]] as Array<[number, number]> };

  it('interpolates, holds the ends, eases when smooth', () => {
    expect(envAt(env, -1)).toBe(0);
    expect(envAt(env, 0.5)).toBeCloseTo(5);
    expect(envAt(env, 2)).toBeCloseTo(7);
    expect(envAt(env, 9)).toBe(4);
    expect(envAt({ ...env, ease: 'smooth' }, 0.25)).toBeCloseTo(10 * 0.15625);
  });

  it('loops over the span of its breakpoints', () => {
    const looped = { ...env, loop: true };
    expect(envAt(looped, 3.5)).toBeCloseTo(5);
    expect(envAt(looped, 6 + 2)).toBeCloseTo(7);
  });

  it('rejects unsorted or empty breakpoints', () => {
    expect(resolveMod({ env: [] }, 0)).toBeUndefined();
    expect(resolveMod({ env: [[1, 0], [0, 1]] }, 0)).toBeUndefined();
    expect(resolveMod({ env: [[0, 1]], ease: 'bouncy' }, 0)).toBeUndefined();
  });
});

describe('modulation registry', () => {
  it('accepts new sources and refuses duplicates', () => {
    registerModSource({ key: 'test-const', resolve: () => 7 });
    expect(resolveNumber(spec, { 'test-const': 1 } as unknown as ParamInput, 0)).toBe(7);
    expect(() => registerModSource({ key: 'lfo', resolve: () => 0 })).toThrow(/already/);
  });
});

describe('activation clock in the pipeline', () => {
  const probe = defineEffect({
    id: 'probe',
    name: 'Probe',
    kind: 'cell',
    params: { level: { type: 'number', min: 0, max: 100, default: 0 } },
    create: (p) => ({
      kind: 'cell',
      apply: (cell) => {
        cell.lum = p.level;
      },
    }),
  });

  function setup() {
    const f = createField(1, 1);
    f.alpha[0] = 1;
    return new Pipeline(f, { cellAspect: 0.5, polarity: 'light-on-dark' }, createPointer());
  }

  it('starts an envelope when the effect is enabled, not at time 0', () => {
    const p = setup();
    for (let i = 0; i < 20; i++) p.frame(1 / 20); // t = 1 s
    const entry = p.add(probe, { level: { env: [[0, 0], [1, 100]] } });
    expect(p.frame(0).lum[0]).toBeCloseTo(0);
    for (let i = 0; i < 10; i++) p.frame(1 / 20);
    expect(p.frame(0).lum[0]).toBeCloseTo(50);

    p.setEnabled(entry, false);
    p.frame(1 / 20);
    p.setEnabled(entry, true);
    expect(p.frame(0).lum[0]).toBeCloseTo(0);
  });

  it('restart rewinds the clock', () => {
    const p = setup();
    p.add(probe, { level: { lfo: 'saw', freq: 1, min: 0, max: 100 } });
    for (let i = 0; i < 6; i++) p.frame(1 / 20);
    expect(p.frame(0).lum[0]).toBeCloseTo(30);
    p.restart();
    expect(p.frame(0).lum[0]).toBeCloseTo(0);
  });
});
