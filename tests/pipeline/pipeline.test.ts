import { describe, expect, it } from 'vitest';
import { createField, type Field, type FieldMeta } from '../../src/core/field.ts';
import { defineEffect } from '../../src/effects/types.ts';
import { createPointer, MAX_DT, Pipeline } from '../../src/pipeline/pipeline.ts';

const meta: FieldMeta = { cellAspect: 0.5, polarity: 'light-on-dark' };

function field(cols: number, rows: number): Field {
  const f = createField(cols, rows);
  for (let i = 0; i < f.lum.length; i++) {
    f.lum[i] = i / f.lum.length;
    f.alpha[i] = 1;
  }
  return f;
}

const addLum = defineEffect({
  id: 'add-lum',
  name: 'Add lum',
  kind: 'cell',
  params: { amount: { type: 'number', min: -1, max: 1, default: 0.25 } },
  create: (p) => ({
    kind: 'cell',
    apply: (cell) => {
      cell.lum += p.amount;
    },
  }),
});

const stamp = defineEffect({
  id: 'stamp',
  name: 'Stamp',
  kind: 'cell',
  params: {},
  create: () => ({
    kind: 'cell',
    apply: (cell, x, y, ctx) => {
      cell.char = x === 0 && y === 0 ? 65 + ctx.frame : 0;
    },
  }),
});

describe('Pipeline', () => {
  it('copies the source untouched when the chain is empty', () => {
    const src = field(4, 3);
    const p = new Pipeline(src, meta, createPointer());
    const work = p.frame(1 / 60);
    expect([...work.lum]).toEqual([...src.lum]);
  });

  it('runs cell effects in chain order without touching the source', () => {
    const src = field(2, 2);
    const before = [...src.lum];
    const p = new Pipeline(src, meta, createPointer());
    p.add(addLum);
    p.add(addLum, { amount: 0.5 });
    const work = p.frame(1 / 60);
    for (let i = 0; i < 4; i++) expect(work.lum[i]).toBeCloseTo(before[i]! + 0.75);
    expect([...src.lum]).toEqual(before);
  });

  it('sees edits to authored values on the next frame', () => {
    const src = field(1, 1);
    const p = new Pipeline(src, meta, createPointer());
    const entry = p.add(addLum);
    entry.values.amount = -0.5;
    expect(p.frame(0).lum[0]).toBeCloseTo(-0.5);
  });

  it('skips disabled effects and maps CellRef.char to charOverride', () => {
    const p = new Pipeline(field(2, 1), meta, createPointer());
    const lum = p.add(addLum);
    p.add(stamp);
    p.setEnabled(lum, false);
    const work = p.frame(1 / 60);
    expect(work.lum[0]).toBe(0);
    expect([...work.charOverride]).toEqual([66, 0]);
    // Override is cleared from the source every frame, not accumulated.
    expect(p.frame(1 / 60).charOverride[0]).toBe(67);
  });

  it('clamps dt and advances time and frame', () => {
    const p = new Pipeline(field(1, 1), meta, createPointer());
    p.frame(1);
    expect(p.ctx.dt).toBe(MAX_DT);
    expect(p.ctx.time).toBeCloseTo(MAX_DT);
    expect(p.ctx.frame).toBe(1);
  });

  it('restarts deterministically and recreates instances on a new source', () => {
    let created = 0;
    const counting = defineEffect({
      id: 'count',
      name: 'Count',
      kind: 'cell',
      params: {},
      create: () => {
        created++;
        return { kind: 'cell', apply: () => undefined };
      },
    });
    const p = new Pipeline(field(2, 2), meta, createPointer(), 7);
    p.add(counting);
    const first = [p.ctx.rand(), p.ctx.rand()];
    p.frame(1 / 60);
    p.setSource(field(3, 1), meta);
    expect(created).toBe(2);
    expect([p.ctx.cols, p.ctx.rows, p.ctx.time, p.ctx.frame]).toEqual([3, 1, 0, 0]);
    expect([p.ctx.rand(), p.ctx.rand()]).toEqual(first);
    expect(p.frame(0).lum.length).toBe(3);
  });

  it('clears the one-frame click after the frame', () => {
    const pointer = createPointer();
    const p = new Pipeline(field(1, 1), meta, pointer);
    pointer.clicked = true;
    p.frame(0);
    expect(pointer.clicked).toBe(false);
  });
});
