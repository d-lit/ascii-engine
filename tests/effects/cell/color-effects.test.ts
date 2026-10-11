import { describe, expect, it } from 'vitest';
import { createField, type FieldMeta } from '../../../src/core/field.ts';
import { hueCycle } from '../../../src/effects/cell/hue-cycle.ts';
import { tint } from '../../../src/effects/cell/tint.ts';
import { createPointer, Pipeline } from '../../../src/pipeline/pipeline.ts';
import type { ParamInput } from '../../../src/pipeline/params.ts';

const meta: FieldMeta = { cellAspect: 0.5, polarity: 'light-on-dark' };

/** 4x1 picture with the given source colours, in `source` colour mode. */
function setup(colors: number[][]) {
  const f = createField(colors.length, 1, { color: true });
  f.alpha.fill(1);
  f.color!.set(colors.flat());
  const p = new Pipeline(f, meta, createPointer());
  p.setColor({ mode: 'source', stops: [] }, [255, 255, 255]);
  return p;
}

function rgb(p: Pipeline, i: number): number[] {
  const c = p.frame(0).color!;
  return [c[i * 3]!, c[i * 3 + 1]!, c[i * 3 + 2]!];
}

describe('tint', () => {
  const run = (values: Record<string, ParamInput>, color: number[]) => {
    const p = setup([color]);
    p.add(tint, { color: '#ff8000', ...values });
    return rgb(p, 0);
  };

  it('replaces the ink by amount', () => {
    expect(run({ amount: 1 }, [0, 0, 255])).toEqual([255, 128, 0]);
    expect(run({ amount: 0.5 }, [0, 0, 255])).toEqual([128, 64, 128]);
  });

  it('multiply darkens through the colour, screen lightens toward it', () => {
    expect(run({ amount: 1, blend: 'multiply' }, [255, 255, 255])).toEqual([255, 128, 0]);
    expect(run({ amount: 1, blend: 'multiply' }, [0, 0, 0])).toEqual([0, 0, 0]);
    expect(run({ amount: 1, blend: 'screen' }, [0, 0, 255])).toEqual([255, 128, 255]);
  });

  it('follows a changed colour param', () => {
    const p = setup([[0, 0, 0]]);
    const e = p.add(tint, { color: '#ff0000', amount: 1 });
    expect(rgb(p, 0)).toEqual([255, 0, 0]);
    e.values.color = '#00ff00';
    expect(rgb(p, 0)).toEqual([0, 255, 0]);
  });
});

describe('hue-cycle', () => {
  it('rotates hue and keeps value', () => {
    const p = setup([[255, 0, 0]]);
    p.add(hueCycle, { speed: 0, spread: 0, saturation: 0 });
    expect(rgb(p, 0)).toEqual([255, 0, 0]);
    // A third of a turn: red -> green.
    const q = setup([[255, 0, 0]]);
    q.add(hueCycle, { speed: 1 / 3, spread: 0, saturation: 0 });
    for (let i = 0; i < 20; i++) q.frame(1 / 20);
    const [r, g, b] = rgb(q, 0);
    expect(g).toBeGreaterThan(250);
    expect(r).toBeLessThan(5);
    expect(b).toBeLessThan(5);
  });

  it('gives grey inks colour through saturation, keeping brightness', () => {
    const p = setup([[128, 128, 128]]);
    p.add(hueCycle, { speed: 0, spread: 0, saturation: 1 });
    const [r, g, b] = rgb(p, 0);
    expect(Math.max(r!, g!, b!)).toBe(128);
    expect(Math.min(r!, g!, b!)).toBe(0);
  });

  it('spreads hue across the picture', () => {
    const p = setup([[255, 0, 0], [255, 0, 0], [255, 0, 0], [255, 0, 0]]);
    p.add(hueCycle, { speed: 0, spread: 1, direction: 0, saturation: 0 });
    const colours = [0, 1, 2, 3].map((i) => rgb(p, i).join());
    expect(new Set(colours).size).toBe(4);
  });

  it('runs after the colour mode even when listed before a cell effect', () => {
    const f = createField(1, 1);
    f.alpha.fill(1);
    const p = new Pipeline(f, meta, createPointer());
    p.setColor({ mode: 'gradient', stops: [{ pos: 0, color: '#808080' }] }, [0, 0, 0]);
    p.add(hueCycle, { speed: 0, spread: 0, saturation: 1 });
    const [r, g, b] = rgb(p, 0);
    expect([r, g, b]).toEqual([128, 0, 0]);
  });
});
