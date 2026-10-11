import { describe, expect, it } from 'vitest';
import { distIso } from '../../../src/core/sample.ts';
import { glitchRows } from '../../../src/effects/displace/glitch-rows.ts';
import { liquid } from '../../../src/effects/displace/liquid.ts';
import { shake } from '../../../src/effects/displace/shake.ts';
import type { AnyEffectDef } from '../../../src/effects/types.ts';
import { createPointer, Pipeline } from '../../../src/pipeline/pipeline.ts';
import type { ParamInput } from '../../../src/pipeline/params.ts';
import { displaced, flatField, meta } from '../helpers.ts';

const COLS = 24;
const ROWS = 12;

function setup(def: AnyEffectDef, values: Record<string, ParamInput>, frames = 1) {
  const p = new Pipeline(flatField(COLS, ROWS), meta, createPointer());
  p.add(def, values);
  for (let i = 0; i < frames; i++) p.frame(1 / 20);
  return p;
}

function offsets(p: Pipeline): Array<{ dx: number; dy: number }> {
  const out = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const o = displaced(p, x, y);
      out.push({ dx: o.x - x, dy: o.y - y });
    }
  }
  return out;
}

describe('liquid', () => {
  it('does nothing at zero amplitude', () => {
    expect(offsets(setup(liquid, { amplitude: 0 })).every((o) => o.dx === 0 && o.dy === 0)).toBe(true);
  });

  it('stays within amplitude per axis, varies over space and time', () => {
    const a = offsets(setup(liquid, { amplitude: 2, speed: 1 }, 1));
    const b = offsets(setup(liquid, { amplitude: 2, speed: 1 }, 10));
    for (const o of a) {
      expect(Math.abs(o.dx)).toBeLessThanOrEqual(2);
      expect(Math.abs(o.dy / meta.cellAspect)).toBeLessThanOrEqual(2);
    }
    expect(new Set(a.map((o) => o.dx.toFixed(4))).size).toBeGreaterThan(10);
    expect(b.map((o) => o.dx)).not.toEqual(a.map((o) => o.dx));
  });
});

describe('glitch-rows', () => {
  it('does nothing at amount 0', () => {
    expect(offsets(setup(glitchRows, { amount: 0 })).every((o) => o.dx === 0)).toBe(true);
  });

  it('shifts whole bands by whole cells within maxShift, horizontally only', () => {
    const p = setup(glitchRows, { amount: 1, band: 3, maxShift: 5 });
    const o = offsets(p);
    for (let y = 0; y < ROWS; y++) {
      const first = o[y * COLS]!.dx;
      const bandFirst = o[Math.floor(y / 3) * 3 * COLS]!.dx;
      expect(first).toBe(bandFirst);
      for (let x = 0; x < COLS; x++) {
        const c = o[y * COLS + x]!;
        expect(Number.isInteger(c.dx) && Math.abs(c.dx) <= 5 && c.dy === 0).toBe(true);
        expect(c.dx).toBe(first);
      }
    }
    expect(o.some((c) => c.dx !== 0)).toBe(true);
  });

  it('holds a pattern for one tick and changes on the next', () => {
    const at = (frames: number) => offsets(setup(glitchRows, { amount: 0.5, rate: 2 }, frames)).map((o) => o.dx);
    // dt = 1/20, rate 2: ticks change every 10 frames.
    expect(at(2)).toEqual(at(5));
    expect(at(12)).not.toEqual(at(2));
  });
});

describe('shake', () => {
  it.each(['smooth', 'jitter'])('%s moves every cell by the same bounded offset', (mode) => {
    const o = offsets(setup(shake, { mode, amplitude: 1, frequency: 7 }, 3));
    const first = o[0]!;
    expect(distIso(first.dx, first.dy, meta.cellAspect)).toBeGreaterThan(0);
    expect(Math.abs(first.dx)).toBeLessThanOrEqual(1);
    expect(Math.abs(first.dy / meta.cellAspect)).toBeLessThanOrEqual(1);
    for (const c of o) {
      expect(c.dx).toBeCloseTo(first.dx, 9);
      expect(c.dy).toBeCloseTo(first.dy, 9);
    }
  });

  it('is still at zero amplitude', () => {
    expect(offsets(setup(shake, { amplitude: 0 })).every((o) => o.dx === 0 && o.dy === 0)).toBe(true);
  });
});
