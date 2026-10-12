import { describe, expect, it } from 'vitest';
import { createField } from '../../src/core/field.ts';
import { distIso } from '../../src/core/sample.ts';
import { defineEffect } from '../../src/effects/types.ts';
import {
  createPointState,
  evalPath,
  isMotionValue,
  isPathSpec,
  resolveMotion,
  type MotionValue,
  type PathSpec,
  type PointFrame,
} from '../../src/pipeline/points.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

// 101 x 41 cells, aspect 0.5: W = 100, H = 40; the picture is 100 x 80 cell widths.
const frame = (inside = false, x = 0, y = 0): PointFrame => ({
  cols: 101,
  rows: 41,
  cellAspect: 0.5,
  pointer: { x, y, inside },
});

function at(path: PathSpec, t: number, f = frame()) {
  const out = { x: 0, y: 0 };
  evalPath(path, t, f, out);
  return out;
}

const C = { x: 0.5, y: 0.5 };

describe('orbit', () => {
  const orbit: PathSpec = { kind: 'orbit', center: C, radius: 0.2, speed: 0.25 };

  it('is a circle on screen: constant isotropic distance from the centre', () => {
    for (let t = 0; t < 4; t += 0.37) {
      const p = at(orbit, t);
      expect(distIso(p.x - 50, p.y - 20, 0.5)).toBeCloseTo(20, 6); // 0.2 of 100 widths
    }
  });

  it('turns at the given speed, starting to the right, phase shifts the start', () => {
    expect(at(orbit, 0)).toMatchObject({ x: 70, y: 20 });
    const quarter = at(orbit, 1); // a quarter turn later: straight down (y grows)
    expect(quarter.x).toBeCloseTo(50, 6);
    expect(quarter.y).toBeCloseTo(30, 6); // 20 widths down = 10 rows
    expect(at({ ...orbit, phase: 0.25 }, 0).y).toBeCloseTo(30, 6);
  });
});

describe('lissajous', () => {
  it('stays in its box and passes through the centre', () => {
    const path: PathSpec = { kind: 'lissajous', center: C, rx: 0.3, ry: 0.1, fx: 1, fy: 2 };
    expect(at(path, 0)).toMatchObject({ x: 50, y: 20 });
    for (let t = 0; t < 3; t += 0.05) {
      const p = at(path, t);
      expect(Math.abs(p.x - 50)).toBeLessThanOrEqual(30 + 1e-9);
      expect(Math.abs(p.y - 20)).toBeLessThanOrEqual(5 + 1e-9); // 10 widths = 5 rows
    }
  });
});

describe('wander', () => {
  const path: PathSpec = { kind: 'wander', center: C, radius: 0.2, speed: 0.5 };

  it('is deterministic, bounded and continuous', () => {
    let prev = at(path, 0);
    for (let t = 0.02; t < 10; t += 0.02) {
      const p = at(path, t);
      expect(Math.abs(p.x - 50)).toBeLessThanOrEqual(20 + 1e-9);
      expect(Math.abs(p.y - 20)).toBeLessThanOrEqual(10 + 1e-9);
      expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(1);
      prev = p;
    }
    expect(at(path, 3.3)).toEqual(at(path, 3.3));
  });

  it('seeds give different walks', () => {
    expect(at({ ...path, seed: 1 }, 2)).not.toEqual(at({ ...path, seed: 2 }, 2));
  });
});

describe('sweep', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 1, y: 1 };

  it('loops from A to B, or goes back and forth', () => {
    const loop: PathSpec = { kind: 'sweep', from, to, period: 2 };
    expect(at(loop, 1)).toMatchObject({ x: 50, y: 20 });
    expect(at(loop, 2)).toMatchObject({ x: 0, y: 0 });
    const ping: PathSpec = { ...loop, pingpong: true };
    expect(at(ping, 2)).toMatchObject({ x: 100, y: 40 });
    expect(at(ping, 3)).toMatchObject({ x: 50, y: 20 });
  });
});

describe('bounce', () => {
  it('stays inside the picture and reflects off the walls', () => {
    const path: PathSpec = { kind: 'bounce', start: C, speed: 0.4, angle: 30 };
    let reversedX = false;
    let last = at(path, 0).x;
    let dir = 0;
    for (let t = 0.01; t < 20; t += 0.01) {
      const p = at(path, t);
      expect(p.x >= -1e-9 && p.x <= 100 + 1e-9).toBe(true);
      expect(p.y >= -1e-9 && p.y <= 40 + 1e-9).toBe(true);
      const d = Math.sign(p.x - last);
      if (dir !== 0 && d !== 0 && d !== dir) reversedX = true;
      if (d !== 0) dir = d;
      last = p.x;
    }
    expect(reversedX).toBe(true);
  });
});

describe('path (keyframes)', () => {
  const path: PathSpec = { kind: 'path', points: [[0, 0, 0], [2, 1, 0], [4, 1, 1]] };

  it('interpolates, holds the ends, loops', () => {
    expect(at(path, 1)).toMatchObject({ x: 50, y: 0 });
    expect(at(path, 3)).toMatchObject({ x: 100, y: 20 });
    expect(at(path, 9)).toMatchObject({ x: 100, y: 40 });
    expect(at({ ...path, loop: true }, 5)).toMatchObject({ x: 50, y: 0 });
  });
});

describe('axes', () => {
  it('drives each axis by a param value, including LFOs', () => {
    const v: MotionValue = { axes: { x: { lfo: 'saw', freq: 1, min: 0, max: 1 }, y: 0.25 } };
    const out = createPointState();
    resolveMotion(v, frame(), 0.5, out);
    expect(out.x).toBeCloseTo(50, 6);
    expect(out.y).toBeCloseTo(10, 6);
  });
});

describe('follow pointer', () => {
  const v: MotionValue = { follow: 'pointer', idle: { x: 0, y: 0 }, ease: 0.5 };

  it('snaps on the first frame, then eases between pointer and idle', () => {
    const out = createPointState();
    resolveMotion(v, frame(true, 80, 30), 0, out);
    expect(out).toMatchObject({ x: 80, y: 30 });

    // Pointer leaves: after one time constant ~63% of the way back to idle.
    resolveMotion(v, frame(false, 80, 30), 0.5, out);
    expect(out.x).toBeCloseTo(80 * Math.exp(-1), 6);

    // Long away: at the idle point.
    resolveMotion(v, frame(false, 80, 30), 10, out);
    expect(out.x).toBeCloseTo(0, 3);
  });

  it('snaps when the clock goes back (restart), and without idle is the pointer', () => {
    const out = createPointState();
    resolveMotion(v, frame(true, 80, 30), 5, out);
    resolveMotion(v, frame(false, 80, 30), 0, out);
    expect(out).toMatchObject({ x: 0, y: 0 });
    const plain = createPointState();
    resolveMotion({ follow: 'pointer' }, frame(false, 12, 7), 1, plain);
    expect(plain).toMatchObject({ x: 12, y: 7 });
  });

  it('can idle along a path', () => {
    const out = createPointState();
    const orbit: PathSpec = { kind: 'orbit', center: C, radius: 0.2, speed: 0.25 };
    resolveMotion({ follow: 'pointer', idle: orbit }, frame(false), 1, out);
    expect(out.y).toBeCloseTo(30, 6);
  });
});

describe('validation', () => {
  const isParam = (p: unknown) => typeof p === 'number' || (typeof p === 'object' && p !== null && 'lfo' in p);

  it('accepts well-formed motion values', () => {
    expect(isMotionValue({ axes: { x: 0.5, y: { lfo: 'sine', freq: 1, min: 0, max: 1 } } }, isParam)).toBe(true);
    expect(isMotionValue({ path: { kind: 'orbit', center: C, radius: 0.1, speed: 0.2 } }, isParam)).toBe(true);
    expect(isMotionValue({ follow: 'pointer', idle: { x: 0.2, y: 0.8 }, ease: 0.3 }, isParam)).toBe(true);
  });

  it('rejects malformed ones', () => {
    expect(isPathSpec({ kind: 'spiral' })).toBe(false);
    expect(isPathSpec({ kind: 'orbit', center: { x: 3, y: 0 }, radius: 0.1, speed: 1 })).toBe(false);
    expect(isPathSpec({ kind: 'path', points: [[1, 0, 0], [0, 1, 1]] })).toBe(false);
    expect(isPathSpec({ kind: 'sweep', from: C, to: C, period: 0 })).toBe(false);
    expect(isMotionValue({ follow: 'mouse' }, isParam)).toBe(false);
    expect(isMotionValue({ axes: { x: 'left', y: 0 } }, isParam)).toBe(false);
  });
});

describe('in the pipeline', () => {
  it('moves an effect centre along its path on the effect clock', () => {
    const seen: number[] = [];
    const probe = defineEffect({
      id: 'probe',
      name: 'Probe',
      kind: 'cell',
      params: { center: { type: 'point', default: 'center' } },
      create: (p) => ({
        kind: 'cell',
        apply: (_cell, x, y) => {
          if (x === 0 && y === 0) seen.push(p.center.x);
        },
      }),
    });
    const f = createField(101, 41);
    const p = new Pipeline(f, { cellAspect: 0.5, polarity: 'light-on-dark' }, createPointer());
    p.add(probe, { center: { path: { kind: 'sweep', from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, period: 1 } } });
    p.frame(0);
    for (let i = 0; i < 10; i++) p.frame(1 / 20);
    expect(seen[0]).toBeCloseTo(0, 6);
    expect(seen[seen.length - 1]).toBeCloseTo(50, 6);
  });
});
