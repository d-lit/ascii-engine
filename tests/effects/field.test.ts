import { describe, expect, it } from 'vitest';
import { createField } from '../../src/core/field.ts';
import { bands } from '../../src/effects/cell/bands.ts';
import { field } from '../../src/effects/cell/field.ts';
import { rings } from '../../src/effects/cell/rings.ts';
import type { AnyEffectDef } from '../../src/effects/types.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

const COLS = 21;
const ROWS = 21;

/** One frame of an effect on a uniform 0.25 grey field, square cells. */
function run(def: AnyEffectDef, values: Record<string, unknown>, frames = 1, dt = 0) {
  const f = createField(COLS, ROWS);
  f.lum.fill(0.25);
  f.alpha.fill(1);
  const p = new Pipeline(f, { cellAspect: 1, polarity: 'light-on-dark' }, createPointer());
  p.add(def, values as Record<string, number>);
  let w = p.frame(0);
  for (let i = 1; i < frames; i++) w = p.frame(dt);
  return w;
}
const at = (x: number, y: number) => y * COLS + x;

describe('field: shapes', () => {
  it('circle: inverts inside the radius, nothing outside, hard edge', () => {
    const w = run(field, { shape: 'circle', op: 'invert', size: 5 });
    expect(w.lum[at(10, 10)]).toBeCloseTo(0.75);
    expect(w.lum[at(14, 10)]).toBeCloseTo(0.75);
    expect(w.lum[at(16, 10)]).toBeCloseTo(0.25);
  });

  it('acts outside instead when asked', () => {
    const w = run(field, { shape: 'circle', op: 'invert', size: 5, outside: true });
    expect(w.lum[at(10, 10)]).toBeCloseTo(0.25);
    expect(w.lum[at(0, 0)]).toBeCloseTo(0.75);
  });

  it('ring: only the band around the radius', () => {
    const w = run(field, { shape: 'ring', op: 'set', size: 6, thickness: 2, level: 1 });
    expect(w.lum[at(16, 10)]).toBe(1);
    expect(w.lum[at(10, 10)]).toBeCloseTo(0.25);
    expect(w.lum[at(19, 10)]).toBeCloseTo(0.25);
  });

  it('box: rotated by angle', () => {
    const square = run(field, { shape: 'box', op: 'set', size: 4, level: 1 });
    const turned = run(field, { shape: 'box', op: 'set', size: 4, level: 1, angle: 45 });
    // A corner of the square is outside the diamond.
    expect(square.lum[at(14, 14)]).toBe(1);
    expect(turned.lum[at(14, 14)]).toBeCloseTo(0.25);
    expect(turned.lum[at(15, 10)]).toBe(1);
  });

  it('stripes move with speed; soft edge gives partial cover', () => {
    const a = run(bands, { op: 'set', level: 1, period: 10, thickness: 3, angle: 0, speed: 0 });
    const b = run(bands, { op: 'set', level: 1, period: 10, thickness: 3, angle: 0, speed: 10 }, 11, 0.05);
    const rowA = [...Array(10).keys()].map((x) => a.lum[at(x, 0)]);
    const rowB = [...Array(10).keys()].map((x) => b.lum[at(x, 0)]);
    expect(rowA).not.toEqual(rowB); // moved by 5 cells after 0.5 s
    expect(rowB).toEqual([...rowA.slice(5), ...rowA.slice(0, 5)]);
    const soft = run(bands, { op: 'set', level: 1, period: 10, thickness: 4, angle: 0, speed: 0, edge: 2 });
    expect([...Array(10).keys()].some((x) => soft.lum[at(x, 0)]! > 0.3 && soft.lum[at(x, 0)]! < 0.95)).toBe(true);
  });

  it('rings travel outward', () => {
    const a = run(rings, { op: 'set', period: 8, thickness: 3, speed: 0 });
    const b = run(rings, { op: 'set', period: 8, thickness: 3, speed: 8 }, 11, 0.05);
    const ray = (w: typeof a) => [...Array(10).keys()].map((d) => (w.lum[at(10 + d, 10)]! > 0.9 ? 1 : 0));
    // 4 cells further out after 0.5 s; the pattern repeats every 8 cells.
    const ra = ray(a);
    expect(ra.some((v) => v === 1)).toBe(true);
    expect(ray(b)).toEqual(ra.map((_, d) => ra[(((d - 4) % 8) + 8) % 8]));
  });

  it('plasma covers part of the picture and flows', () => {
    const a = run(field, { shape: 'plasma', op: 'set', level: 1, cover: 0.4, size: 4, speed: 0 });
    const b = run(field, { shape: 'plasma', op: 'set', level: 1, cover: 0.4, size: 4, speed: 2 }, 11, 0.05);
    const lit = (w: typeof a) => [...w.lum].filter((v) => v === 1).length;
    expect(lit(a)).toBeGreaterThan(20);
    expect(lit(a)).toBeLessThan(COLS * ROWS - 20);
    expect([...a.lum]).not.toEqual([...b.lum]);
  });
});

describe('field: operations', () => {
  it('erase makes cells transparent; threshold and dither go two-tone', () => {
    const e = run(field, { shape: 'circle', op: 'erase', size: 3 });
    expect(e.alpha[at(10, 10)]).toBe(0);
    expect(e.alpha[at(0, 0)]).toBe(1);
    const t = run(field, { shape: 'circle', op: 'threshold', size: 30, level: 0.5 });
    expect(t.lum[at(3, 3)]).toBe(0);
    const d = run(field, { shape: 'circle', op: 'dither', size: 30 });
    const tones = new Set([...d.lum]);
    expect([...tones].sort()).toEqual([0, 1]);
    // A quarter grey dithers to about a quarter lit.
    const lit = [...d.lum].filter((v) => v === 1).length / d.lum.length;
    expect(lit).toBeGreaterThan(0.15);
    expect(lit).toBeLessThan(0.35);
  });

  it('ramp: selects another ramp inside, the picture ramp outside', () => {
    const w = run(field, { shape: 'circle', op: 'ramp', size: 4, ramp: 'binary' });
    expect(w.rampSel[at(10, 10)]).toBe(4); // RAMP_NAMES: blocks, classic, long, binary...
    expect(w.rampSel[at(0, 0)]).toBe(0);
  });

  it('mix 0.3 keeps the picture ramp (it follows the stronger side, like char)', () => {
    const f = createField(COLS, ROWS);
    f.alpha.fill(1);
    const p = new Pipeline(f, { cellAspect: 1, polarity: 'light-on-dark' }, createPointer());
    p.add(field, { shape: 'circle', op: 'ramp', size: 4 }, { mix: 0.3 });
    expect(p.frame(0).rampSel[at(10, 10)]).toBe(0);
  });
});
