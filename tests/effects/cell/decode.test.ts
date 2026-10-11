import { describe, expect, it } from 'vitest';
import { decode } from '../../../src/effects/cell/decode.ts';
import { createPointer, Pipeline } from '../../../src/pipeline/pipeline.ts';
import type { ParamInput } from '../../../src/pipeline/params.ts';
import { flatField, meta } from '../helpers.ts';

const STEP = 1 / 20;

function setup(values: Record<string, ParamInput>) {
  const p = new Pipeline(flatField(9, 5), meta, createPointer(), 1);
  p.add(decode, { jitter: 0, ...values });
  return p;
}

/** Advances to roughly `t` seconds (frames of STEP, first frame is t = 0 start). */
function at(p: Pipeline, t: number) {
  let work = p.frame(0);
  for (let s = 0; s < Math.round(t / STEP); s++) work = p.frame(STEP);
  return work;
}

describe('decode', () => {
  it('hides cells ahead of the front, scrambles at it, settles behind it', () => {
    // Front at 10 cells/s from the centre (4, 2); scramble lasts 0.2 s.
    const p = setup({ speed: 10, scramble: 0.2, set: 'binary' });
    const work = at(p, 0.3);
    const centre = 2 * 9 + 4; // distance 0: arrived at 0, settled at 0.2
    const edge = 2 * 9 + 0; // distance 4: arrives at 0.4
    const ring = 2 * 9 + 2; // distance 2: arrives at 0.2, scrambling until 0.4

    expect(work.alpha[centre]).toBe(1);
    expect(work.charOverride[centre]).toBe(0);
    expect(work.alpha[edge]).toBe(0);
    expect([48, 49]).toContain(work.charOverride[ring]);
  });

  it('leaves the picture untouched once everything has settled', () => {
    const p = setup({ speed: 400, scramble: 0.1 });
    const work = at(p, 0.5);
    expect([...work.alpha].every((a) => a === 1)).toBe(true);
    expect([...work.charOverride].every((c) => c === 0)).toBe(true);
  });

  it('keeps empty cells empty and can show the picture before the front', () => {
    const p = setup({ speed: 1, scramble: 0, hideBefore: false });
    const work = at(p, 0.1);
    expect([...work.alpha].every((a) => a === 1)).toBe(true);

    const src = flatField(3, 1);
    src.alpha[1] = 0;
    const q = new Pipeline(src, meta, createPointer());
    q.add(decode, { speed: 1, scramble: 5, jitter: 0, center: { x: 0.5, y: 0 } });
    expect(q.frame(0).charOverride[1]).toBe(0);
  });

  it('replays from the start after restart', () => {
    const p = setup({ speed: 10, scramble: 0.2 });
    at(p, 1);
    p.restart();
    expect(at(p, 0.05).alpha[0]).toBe(0);
  });

  it('replays when re-enabled', () => {
    const p = setup({ speed: 10, scramble: 0.2 });
    const entry = p.chain[0]!;
    at(p, 1);
    p.setEnabled(entry, false);
    p.frame(STEP);
    p.setEnabled(entry, true);
    expect(p.frame(STEP).alpha[0]).toBe(0);
  });

  it('is deterministic for the same seed and time', () => {
    const a = at(setup({ speed: 10, scramble: 1 }), 0.3);
    const b = at(setup({ speed: 10, scramble: 1 }), 0.3);
    expect([...a.charOverride]).toEqual([...b.charOverride]);
  });
});
