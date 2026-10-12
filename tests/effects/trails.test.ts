import { describe, expect, it } from 'vitest';
import { createField } from '../../src/core/field.ts';
import { defineEffect } from '../../src/effects/types.ts';
import { particles } from '../../src/effects/system/particles.ts';
import { trails } from '../../src/effects/system/trails.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

/** A bright dot that jumps from column 2 to column 7 at t = 0.5 s. */
const jumper = defineEffect({
  id: 'jumper',
  name: 'Jumper',
  kind: 'cell',
  params: {},
  create: () => ({
    kind: 'cell',
    apply: (cell, x, _y, ctx) => {
      cell.lum = x === (ctx.time < 0.5 ? 2 : 7) ? 1 : 0;
    },
  }),
});

function setup(values: Record<string, unknown>) {
  const f = createField(10, 1);
  f.alpha.fill(1);
  const p = new Pipeline(f, { cellAspect: 0.5, polarity: 'light-on-dark' }, createPointer());
  p.add(jumper);
  p.add(trails, values as Record<string, number>);
  return p;
}

describe('trails', () => {
  it('leaves a fading copy where a bright detail was', () => {
    const p = setup({ fade: 0.3 });
    let w = p.frame(0);
    for (let i = 0; i < 30; i++) w = p.frame(1 / 60); // t = 0.5: jumped
    for (let i = 0; i < 6; i++) w = p.frame(1 / 60); // 0.1 s later
    const early = w.lum[2]!;
    expect(early).toBeGreaterThan(0.3);
    expect(w.lum[7]).toBeGreaterThan(0.2); // the new place fades in, not instantly
    for (let i = 0; i < 60; i++) w = p.frame(1 / 60); // 1 s later
    expect(w.lum[2]).toBeLessThan(0.05);
    expect(w.lum[7]).toBeGreaterThan(0.95);
  });

  it('is frame-rate independent', () => {
    const a = setup({ fade: 0.3 });
    const b = setup({ fade: 0.3 });
    a.frame(0);
    b.frame(0);
    let wa = a.frame(0);
    let wb = b.frame(0);
    for (let i = 0; i < 48; i++) wa = a.frame(1 / 60); // 0.8 s
    for (let i = 0; i < 16; i++) wb = b.frame(1 / 20);
    // Jumps land between frames differently; after it the decay matches.
    expect(Math.abs(wa.lum[2]! - wb.lum[2]!)).toBeLessThan(0.08);
  });

  it('mix 0 or the sprites-only mode leave the grid alone', () => {
    const p = setup({ on: 'sprites' });
    let w = p.frame(0);
    for (let i = 0; i < 31; i++) w = p.frame(1 / 60);
    expect(w.lum[2]).toBe(0);
    expect(w.spriteFade).toBeGreaterThan(0.9);
  });

  it('asks the sprite layer to fade after particles, and stops when removed', () => {
    const f = createField(10, 4);
    f.alpha.fill(1);
    const p = new Pipeline(f, { cellAspect: 0.5, polarity: 'light-on-dark' }, createPointer());
    p.add(particles);
    const t = p.add(trails, { on: 'sprites', fade: 0.5 });
    const w = p.frame(1 / 60);
    expect(w.spriteFade).toBeCloseTo(Math.exp(-1 / 60 / 0.5), 6);
    p.remove(t);
    expect(p.frame(1 / 60).spriteFade).toBe(0);
  });
});
