import { describe, expect, it } from 'vitest';
import { distIso } from '../../../src/core/sample.ts';
import { ripple } from '../../../src/effects/displace/ripple.ts';
import { createPointer, Pipeline } from '../../../src/pipeline/pipeline.ts';
import type { ParamInput } from '../../../src/pipeline/params.ts';
import { displaced, flatField, meta } from '../helpers.ts';

// 41x21 grid, centre (20, 10); meta.cellAspect = 0.5.
function setup(values: Record<string, ParamInput>) {
  const pointer = createPointer();
  const p = new Pipeline(flatField(41, 21), meta, pointer);
  p.add(ripple, { center: 'center', speed: 0, ...values });
  p.frame(0);
  return { p, pointer };
}

function offset(p: Pipeline, x: number, y: number) {
  const o = displaced(p, x, y);
  return distIso(o.x - x, o.y - y, meta.cellAspect);
}

describe('ripple', () => {
  it('is isotropic: same on-screen distance gives the same push', () => {
    const { p } = setup({ amplitude: 1, wavelength: 16, decay: 0 });
    // 6 cell widths right vs 3 rows down (rows are 2 cell widths tall).
    const right = offset(p, 26, 10);
    const down = offset(p, 20, 13);
    expect(right).toBeGreaterThan(0.1);
    expect(down).toBeCloseTo(right, 9);
  });

  it('pushes along the radius by amplitude * sin', () => {
    const { p } = setup({ amplitude: 1, wavelength: 16, decay: 0 });
    // d = 4 cell widths: sin(2*pi*4/16) = 1, straight right.
    const o = displaced(p, 24, 10);
    expect(o.x).toBeCloseTo(25, 9);
    expect(o.y).toBeCloseTo(10, 9);
  });

  it('leaves the centre still and fades with distance', () => {
    const { p } = setup({ amplitude: 1, wavelength: 16, decay: 4 });
    expect(displaced(p, 20, 10)).toEqual({ x: 20, y: 10 });
    expect(offset(p, 24, 10)).toBeCloseTo(Math.exp(-1), 9);
  });

  it('click mode: nothing until a click, a ring after, gone after its life', () => {
    const { p, pointer } = setup({ mode: 'click', amplitude: 1, wavelength: 4, speed: 20, life: 1, decay: 0 });
    expect(offset(p, 30, 10)).toBe(0);

    Object.assign(pointer, { x: 20, y: 10, inside: true, clicked: true });
    p.frame(0); // ring launched at t = now
    for (let i = 0; i < 10; i++) p.frame(1 / 20); // age 0.5 s, front at 10 cells
    const near = offset(p, 30, 10) + offset(p, 31, 10) + offset(p, 29, 10);
    expect(near).toBeGreaterThan(0.05);
    expect(offset(p, 40, 10)).toBe(0);

    for (let i = 0; i < 11; i++) p.frame(1 / 20);
    expect(offset(p, 30, 10) + offset(p, 31, 10)).toBe(0);
  });
});
