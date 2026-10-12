import { describe, expect, it } from 'vitest';
import { createField, type FieldMeta } from '../../src/core/field.ts';
import { glow } from '../../src/effects/cell/glow.ts';
import type { ColorSettings } from '../../src/pipeline/colorize.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

const meta: FieldMeta = { cellAspect: 0.5, polarity: 'light-on-dark' };
const INK = [200, 100, 50] as const;
const BW = [
  { pos: 0, color: '#000000' },
  { pos: 1, color: '#ffffff' },
];

function setup(color: ColorSettings, withColor = true) {
  const f = createField(3, 1, { color: withColor });
  f.lum.set([0, 0.5, 1]);
  f.alpha.set([1, 1, 0.5]);
  f.color?.set([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  const p = new Pipeline(f, meta, createPointer());
  p.setColor(color, INK);
  return p;
}

function plate(p: Pipeline, i: number): number[] {
  const pl = p.frame(0).plate;
  return pl === null ? [] : [...pl.subarray(i * 4, i * 4 + 4)];
}

describe('plates', () => {
  it('no plate channel unless plates or a plate effect are used', () => {
    expect(setup({ mode: 'mono', stops: [] }).frame(0).plate).toBeNull();
    expect(setup({ mode: 'mono', stops: [], plates: { mode: 'none', opacity: 1 } }).frame(0).plate).toBeNull();
  });

  it('source plates take picture colours, alpha = opacity x cell alpha', () => {
    const p = setup({ mode: 'mono', stops: [], plates: { mode: 'source', opacity: 1 } });
    expect(plate(p, 0)).toEqual([10, 20, 30, 255]);
    expect(plate(p, 2)).toEqual([70, 80, 90, 128]);
  });

  it('gradient plates follow lum, ink plates follow the ink', () => {
    const g = setup({ mode: 'mono', stops: BW, plates: { mode: 'gradient', opacity: 0.5 } });
    expect(plate(g, 2)).toEqual([255, 255, 255, 64]);
    const ink = setup({ mode: 'mono', stops: [], plates: { mode: 'ink', opacity: 1 } }, false);
    expect(plate(ink, 1)).toEqual([...INK, 255]);
  });

  it('glow lights plates near its centre even with plates off', () => {
    const f = createField(21, 1);
    f.alpha.fill(1);
    const p = new Pipeline(f, meta, createPointer());
    p.add(glow, { center: { x: 0.5, y: 0 }, color: '#ff0000', radius: 5, strength: 1, falloff: 1 });
    const pl = p.frame(0).plate!;
    expect([...pl.subarray(10 * 4, 10 * 4 + 4)]).toEqual([255, 0, 0, 255]);
    expect(pl[12 * 4 + 3]).toBeGreaterThan(0);
    expect(pl[12 * 4 + 3]).toBeLessThan(255);
    expect(pl[0 * 4 + 3]).toBe(0);
  });

  it('drops the plate channel when nothing needs it', () => {
    const p = setup({ mode: 'mono', stops: [], plates: { mode: 'source', opacity: 1 } });
    expect(p.frame(0).plate).not.toBeNull();
    p.setColor({ mode: 'mono', stops: [] }, INK);
    expect(p.frame(0).plate).toBeNull();
  });
});
