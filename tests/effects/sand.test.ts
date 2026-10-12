import { describe, expect, it } from 'vitest';
import { createField } from '../../src/core/field.ts';
import { sand } from '../../src/effects/system/sand.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

const COLS = 20;
const ROWS = 12;

function setup(values: Record<string, unknown>) {
  const f = createField(COLS, ROWS);
  f.lum.fill(1);
  f.alpha.fill(1);
  const pointer = createPointer();
  const p = new Pipeline(f, { cellAspect: 0.5, polarity: 'light-on-dark' }, pointer);
  p.add(sand, values as Record<string, number>);
  return { p, pointer };
}

function run(p: Pipeline, seconds: number, dt = 1 / 60) {
  let w = p.frame(0);
  for (let t = 0; t < seconds - 1e-9; t += dt) w = p.frame(dt);
  return w;
}

describe('sand', () => {
  it('a click crumbles a patch: grains fall and pile at the bottom, holes stay', () => {
    const { p, pointer } = setup({ crumble: 0, clickRadius: 3, hold: 30 });
    p.frame(0);
    pointer.x = 10;
    pointer.y = 3;
    pointer.inside = true;
    pointer.clicked = true;
    const w = run(p, 2);
    expect(w.sprites.count).toBeGreaterThan(5);
    // The patch is empty in the grid...
    expect(w.hidden[3 * COLS + 10]).toBe(1);
    // ...and every grain rests on the bottom rows, in whole cells.
    for (let s = 0; s < w.sprites.count; s++) {
      expect(w.sprites.y[s]!).toBeGreaterThanOrEqual(ROWS - 4);
      expect(Number.isInteger(w.sprites.y[s]!)).toBe(true);
    }
    // No two grains share a cell.
    const cells = new Set<number>();
    for (let s = 0; s < w.sprites.count; s++) cells.add(w.sprites.y[s]! * COLS + w.sprites.x[s]!);
    expect(cells.size).toBe(w.sprites.count);
  });

  it('crumbles a little at a time and brings grains home after a while', () => {
    const { p } = setup({ crumble: 0.05, clickRadius: 0, hold: 1, flight: 0.3 });
    const early = run(p, 0.5).sprites.count;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(COLS * ROWS * 0.1);
    // With crumbling off, everything returns.
    const { p: q } = setup({ crumble: 0.05, clickRadius: 0, hold: 1, flight: 0.3 });
    run(q, 0.5);
    q.chain[0]!.values.crumble = 0;
    let w = q.frame(0);
    for (let i = 0; i < 120; i++) w = q.frame(1 / 60);
    expect(w.sprites.count).toBe(0);
  });

  it('is the same at any frame rate', () => {
    const a = setup({ crumble: 0.05, hold: 2 });
    const b = setup({ crumble: 0.05, hold: 2 });
    const wa = run(a.p, 1.5, 1 / 60);
    const wb = run(b.p, 1.5, 1 / 20);
    expect(wa.sprites.count).toBe(wb.sprites.count);
    const key = (w: typeof wa) =>
      [...w.sprites.src.subarray(0, w.sprites.count)].map((g, s) => `${g}:${w.sprites.x[s]!.toFixed(3)}:${w.sprites.y[s]!.toFixed(3)}`).sort();
    expect(key(wa)).toEqual(key(wb));
  });
});
