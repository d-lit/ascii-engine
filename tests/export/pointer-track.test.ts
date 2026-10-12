import { describe, expect, it } from 'vitest';
import type { Pointer } from '../../src/core/context.ts';
import { PointerTrack } from '../../src/export/pointer-track.ts';
import { createPointer } from '../../src/pipeline/pipeline.ts';

function ptr(x: number, y: number, extra: Partial<Pointer> = {}): Pointer {
  return { ...createPointer(), x, y, inside: true, ...extra };
}

describe('PointerTrack', () => {
  it('interpolates position and derives velocity', () => {
    const track = new PointerTrack();
    track.push(0, ptr(0, 0));
    track.push(1, ptr(10, 20));
    const out = createPointer();
    track.apply(0.5, 0.25, out);
    expect([out.x, out.y]).toEqual([5, 10]);
    expect(out.vx).toBeCloseTo(10);
    expect(out.vy).toBeCloseTo(20);
    expect(out.inside).toBe(true);
  });

  it('holds the ends and is outside before the first sample', () => {
    const track = new PointerTrack();
    track.push(1, ptr(3, 4));
    track.push(2, ptr(5, 6));
    const out = createPointer();
    track.apply(0.5, 0.4, out);
    expect(out.inside).toBe(false);
    track.apply(9, 8, out);
    expect([out.x, out.y, out.vx]).toEqual([5, 6, 0]);
  });

  it('fires a click once, in the frame window that contains it', () => {
    const track = new PointerTrack();
    track.push(0, ptr(0, 0));
    track.push(0.1, ptr(0, 0, { clicked: true, down: true }));
    track.push(0.2, ptr(0, 0, { down: true }));
    const out = createPointer();
    const frames = [0.05, 0.1, 0.15, 0.2].map((t, i, a) => {
      track.apply(t, i === 0 ? 0 : a[i - 1]!, out);
      return [out.clicked, out.down];
    });
    expect(frames).toEqual([[false, false], [true, true], [false, true], [false, true]]);
  });

  it('catches a click even when frames are coarser than samples', () => {
    const track = new PointerTrack();
    for (let i = 0; i < 10; i++) track.push(i / 100, ptr(i, 0, { clicked: i === 4 }));
    const out = createPointer();
    track.apply(0.09, 0, out);
    expect(out.clicked).toBe(true);
  });

  it('grows past its initial capacity and clears', () => {
    const track = new PointerTrack();
    for (let i = 0; i < 1000; i++) track.push(i, ptr(i, 0));
    expect(track.length).toBe(1000);
    expect(track.duration).toBe(999);
    const out = createPointer();
    track.apply(500.5, 500, out);
    expect(out.x).toBeCloseTo(500.5);
    track.clear();
    expect(track.length).toBe(0);
  });
});
