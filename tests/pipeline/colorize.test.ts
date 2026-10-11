import { describe, expect, it } from 'vitest';
import { createField, type FieldMeta } from '../../src/core/field.ts';
import { defineEffect } from '../../src/effects/types.ts';
import { buildGradientLut } from '../../src/pipeline/colorize.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

const meta: FieldMeta = { cellAspect: 0.5, polarity: 'light-on-dark' };
const INK = [200, 100, 50] as const;
const BW = [
  { pos: 0, color: '#000000' },
  { pos: 1, color: '#ffffff' },
];

function rgb(c: Uint8ClampedArray | null, i: number): number[] {
  return c === null ? [] : [c[i * 3]!, c[i * 3 + 1]!, c[i * 3 + 2]!];
}

function source(withColor: boolean) {
  const f = createField(3, 1, { color: withColor });
  f.lum.set([0, 0.5, 1]);
  f.alpha.fill(1);
  f.color?.set([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  return f;
}

const brighten = defineEffect({
  id: 'brighten',
  name: 'Brighten',
  kind: 'cell',
  params: {},
  create: () => ({
    kind: 'cell',
    apply: (cell) => {
      cell.lum = 1;
    },
  }),
});

const paintRed = defineEffect({
  id: 'paint-red',
  name: 'Paint red',
  kind: 'cell',
  writesColor: true,
  params: {},
  create: () => ({
    kind: 'cell',
    apply: (cell) => {
      cell.r = 255;
    },
  }),
});

describe('buildGradientLut', () => {
  it('interpolates between sorted stops and holds the ends', () => {
    const lut = buildGradientLut([
      { pos: 0.75, color: '#ffffff' },
      { pos: 0.25, color: '#000000' },
    ]);
    expect([...lut.subarray(0, 3)]).toEqual([0, 0, 0]);
    expect(lut[128 * 3]).toBeGreaterThan(120);
    expect(lut[128 * 3]).toBeLessThan(135);
    expect([...lut.subarray(255 * 3)]).toEqual([255, 255, 255]);
  });

  it('handles one stop and no stops', () => {
    expect([...buildGradientLut([{ pos: 0.3, color: '#102030' }]).subarray(200 * 3, 201 * 3)]).toEqual([16, 32, 48]);
    expect([...buildGradientLut([]).subarray(0, 3)]).toEqual([0, 0, 0]);
  });
});

describe('colour in the pipeline', () => {
  it('keeps no colour channel in mono mode without painting effects', () => {
    const p = new Pipeline(source(true), meta, createPointer());
    expect(p.frame(0).color).toBeNull();
  });

  it('mono with a painting effect starts from the theme ink', () => {
    const p = new Pipeline(source(true), meta, createPointer());
    p.setColor({ mode: 'mono', stops: [] }, INK);
    p.add(paintRed);
    expect(rgb(p.frame(0).color, 1)).toEqual([255, 100, 50]);
  });

  it('source mode uses picture colours, or the ink for colourless sources', () => {
    const p = new Pipeline(source(true), meta, createPointer());
    p.setColor({ mode: 'source', stops: [] }, INK);
    expect(rgb(p.frame(0).color, 2)).toEqual([70, 80, 90]);
    p.setSource(source(false), meta);
    expect(rgb(p.frame(0).color, 2)).toEqual([...INK]);
  });

  it('gradient mode colours by lum after cell effects', () => {
    const p = new Pipeline(source(false), meta, createPointer());
    p.setColor({ mode: 'gradient', stops: BW }, INK);
    expect(rgb(p.frame(0).color, 0)).toEqual([0, 0, 0]);
    p.add(brighten);
    expect(rgb(p.frame(0).color, 0)).toEqual([255, 255, 255]);
  });

  it('runs painting effects after the colour mode, honouring mix', () => {
    const p = new Pipeline(source(false), meta, createPointer());
    p.setColor({ mode: 'gradient', stops: BW }, INK);
    const e = p.add(paintRed);
    expect(rgb(p.frame(0).color, 1)).toEqual([255, 128, 128]);
    e.mix = 0.5;
    expect(rgb(p.frame(0).color, 0)).toEqual([128, 0, 0]);
  });

  it('drops the channel when it is no longer needed', () => {
    const p = new Pipeline(source(true), meta, createPointer());
    const e = p.add(paintRed);
    expect(p.frame(0).color).not.toBeNull();
    p.remove(e);
    expect(p.frame(0).color).toBeNull();
  });
});
