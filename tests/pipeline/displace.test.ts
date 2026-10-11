import { describe, expect, it } from 'vitest';
import { createField, type Field, type FieldMeta } from '../../src/core/field.ts';
import { defineEffect } from '../../src/effects/types.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

const meta: FieldMeta = { cellAspect: 0.5, polarity: 'light-on-dark' };

function source(): Field {
  const f = createField(4, 3, { char: true, color: true });
  for (let i = 0; i < 12; i++) {
    f.lum[i] = (i % 4) / 3;
    f.alpha[i] = 1;
    f.char![i] = 65 + i;
    f.color!.set([i * 20, 0, 255 - i * 20], i * 3);
  }
  return f;
}

const shift = defineEffect({
  id: 'shift',
  name: 'Shift',
  kind: 'displace',
  params: {
    dx: { type: 'number', min: -10, max: 10, default: 0 },
    dy: { type: 'number', min: -10, max: 10, default: 0 },
  },
  create: (p) => ({
    kind: 'displace',
    apply: (_x, _y, _ctx, out) => {
      out.x += p.dx;
      out.y += p.dy;
    },
  }),
});

describe('displace stage', () => {
  it('reproduces the source exactly at zero displacement', () => {
    const src = source();
    const p = new Pipeline(src, meta, createPointer());
    p.add(shift);
    const work = p.frame(0);
    expect([...work.lum]).toEqual([...src.lum]);
    expect([...work.alpha]).toEqual([...src.alpha]);
    expect([...work.char]).toEqual([...src.char!]);
    expect([...work.color!]).toEqual([...src.color!]);
  });

  it('samples between cells bilinearly and takes the nearest authored char', () => {
    const p = new Pipeline(source(), meta, createPointer());
    p.add(shift, { dx: 0.25 });
    const work = p.frame(0);
    expect(work.lum[0]).toBeCloseTo(0.25 / 3);
    expect(work.char[0]).toBe(65);
    p.chain[0]!.values.dx = 0.75;
    expect(p.frame(0).char[0]).toBe(66);
  });

  it('composes displacements in chain order', () => {
    const p = new Pipeline(source(), meta, createPointer());
    p.add(shift, { dx: 1 });
    p.add(shift, { dx: 1, dy: 1 });
    // cell (0,0) samples source (2,1)
    const work = p.frame(0);
    expect(work.lum[0]).toBeCloseTo(2 / 3);
    expect(work.char[0]).toBe(65 + 6);
  });

  it('clamps samples past the edge', () => {
    const p = new Pipeline(source(), meta, createPointer());
    p.add(shift, { dx: 10 });
    const work = p.frame(0);
    expect(work.lum[0]).toBeCloseTo(1);
    expect(work.char[0]).toBe(65 + 3);
  });

  it('runs cell effects after displacement and leaves the source untouched', () => {
    const src = source();
    const before = [...src.lum];
    const p = new Pipeline(src, meta, createPointer());
    p.add(shift, { dx: 1 });
    p.add(
      defineEffect({
        id: 'zero',
        name: 'Zero',
        kind: 'cell',
        params: {},
        create: () => ({
          kind: 'cell',
          apply: (cell) => {
            cell.lum *= 2;
          },
        }),
      }),
    );
    expect(p.frame(0).lum[0]).toBeCloseTo(2 / 3);
    expect([...src.lum]).toEqual(before);
  });
});
