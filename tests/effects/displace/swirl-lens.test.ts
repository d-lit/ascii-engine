import { describe, expect, it } from 'vitest';
import { distIso } from '../../../src/core/sample.ts';
import { lens } from '../../../src/effects/displace/lens.ts';
import { swirl } from '../../../src/effects/displace/swirl.ts';
import type { AnyEffectDef } from '../../../src/effects/types.ts';
import { createPointer, Pipeline } from '../../../src/pipeline/pipeline.ts';
import type { ParamInput } from '../../../src/pipeline/params.ts';
import { displaced, flatField, meta } from '../helpers.ts';

function setup(def: AnyEffectDef, values: Record<string, ParamInput>) {
  const p = new Pipeline(flatField(41, 21), meta, createPointer());
  p.add(def, { center: 'center', ...values });
  p.frame(0);
  return p;
}

describe('swirl', () => {
  const p = setup(swirl, { angle: 90, radius: 10, wobble: 0 });

  it('keeps the centre and everything beyond the radius', () => {
    expect(displaced(p, 20, 10)).toEqual({ x: 20, y: 10 });
    expect(displaced(p, 31, 10)).toEqual({ x: 31, y: 10 });
  });

  it('rotates without changing on-screen distance from the centre', () => {
    const o = displaced(p, 25, 10); // 5 cell widths right: k = 0.5, theta = 22.5 deg
    expect(distIso(o.x - 20, o.y - 10, meta.cellAspect)).toBeCloseTo(5, 9);
    const theta = Math.atan2((o.y - 10) / meta.cellAspect, o.x - 20);
    expect(theta).toBeCloseTo((-22.5 * Math.PI) / 180, 9);
  });
});

describe('lens', () => {
  it('pulls samples toward the centre when magnifying', () => {
    const p = setup(lens, { radius: 10, strength: 0.5 });
    expect(displaced(p, 20, 10)).toEqual({ x: 20, y: 10 });
    const o = displaced(p, 25, 10); // q = 0.25, scale = 1 - 0.5 * 0.5625
    expect(o.x).toBeCloseTo(20 + 5 * (1 - 0.5 * 0.5625), 9);
    expect(displaced(p, 31, 10)).toEqual({ x: 31, y: 10 });
  });

  it('pushes samples outward when shrinking, isotropically', () => {
    const p = setup(lens, { radius: 10, strength: -0.5 });
    const right = displaced(p, 24, 10);
    const down = displaced(p, 20, 12);
    expect(right.x - 24).toBeGreaterThan(0);
    expect(distIso(right.x - 24, 0, meta.cellAspect)).toBeCloseTo(
      distIso(0, down.y - 12, meta.cellAspect),
      9,
    );
  });
});
