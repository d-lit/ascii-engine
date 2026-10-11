import { describe, expect, it } from 'vitest';
import { createField, type FieldMeta } from '../../src/core/field.ts';
import { defineEffect } from '../../src/effects/types.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

const meta: FieldMeta = { cellAspect: 0.5, polarity: 'light-on-dark' };

const brighten = defineEffect({
  id: 'brighten',
  name: 'Brighten',
  kind: 'cell',
  params: {},
  create: () => ({
    kind: 'cell',
    apply: (cell) => {
      cell.lum = 1;
      cell.char = 90;
    },
  }),
});

const push = defineEffect({
  id: 'push',
  name: 'Push',
  kind: 'displace',
  params: {},
  create: () => ({
    kind: 'displace',
    apply: (_x, _y, _ctx, out) => {
      out.x += 2;
    },
  }),
});

function setup() {
  const f = createField(4, 1);
  f.lum.set([0, 0.25, 0.5, 0.75]);
  f.alpha.fill(1);
  return new Pipeline(f, meta, createPointer());
}

describe('mix and masks in the pipeline', () => {
  it('blends cell results by mix; char follows the stronger side', () => {
    const p = setup();
    const e = p.add(brighten, {}, { mix: 0.25 });
    let w = p.frame(0);
    expect(w.lum[0]).toBeCloseTo(0.25);
    expect(w.charOverride[0]).toBe(0);
    e.mix = 0.75;
    w = p.frame(0);
    expect(w.lum[0]).toBeCloseTo(0.75);
    expect(w.charOverride[0]).toBe(90);
    e.mix = 0;
    expect(p.frame(0).lum[0]).toBe(0);
  });

  it('scales displacement by mix', () => {
    const p = setup();
    p.add(push, {}, { mix: 0.5 }); // shift by 1 cell
    expect(p.frame(0).lum[0]).toBeCloseTo(0.25);
  });

  it('modulates mix over the activation clock', () => {
    const p = setup();
    p.add(brighten, {}, { mix: { env: [[0, 0], [1, 1]] } });
    for (let i = 0; i < 10; i++) p.frame(1 / 20);
    expect(p.frame(0).lum[0]).toBeCloseTo(0.5);
  });

  it('applies only where the mask is, and follows setMask changes', () => {
    const p = setup();
    const e = p.add(brighten, {}, { mask: { type: 'rect', x: 0, y: 0, w: 1 / 3, h: 1 } });
    expect([...p.frame(0).lum]).toEqual([1, 1, 0.5, 0.75]);
    p.setMask(e, { type: 'lum', min: 0.6, max: 1 });
    expect([...p.frame(0).lum]).toEqual([0, 0.25, 0.5, 1]);
    p.setMask(e, null);
    expect([...p.frame(0).lum]).toEqual([1, 1, 1, 1]);
  });

  it('masks displacement per cell', () => {
    const p = setup();
    p.add(push, {}, { mask: { type: 'rect', x: 0, y: 0, w: 0, h: 1 } }); // only column 0
    expect([...p.frame(0).lum]).toEqual([0.5, 0.25, 0.5, 0.75]);
  });

  it('keeps masks valid across a source change and reorders the chain', () => {
    const p = setup();
    const a = p.add(push);
    const b = p.add(brighten, {}, { mask: { type: 'alpha' } });
    const g = createField(6, 2);
    g.alpha.fill(1);
    p.setSource(g, meta);
    expect([...p.frame(0).lum].every((v) => v === 1)).toBe(true);
    p.move(b, 0);
    expect(p.chain[0]).toBe(b);
    expect(p.chain[1]).toBe(a);
  });
});
