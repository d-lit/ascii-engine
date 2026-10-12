import { describe, expect, it } from 'vitest';
import { forEachHeard, trackPosition, trackSpan } from '../../src/audio/track.ts';

describe('trackPosition', () => {
  const t = { duration: 10, offset: 4, loop: false };

  it('starts at the offset and goes silent after one pass', () => {
    expect(trackSpan(t)).toBe(6);
    expect(trackPosition(0, t)).toBe(4);
    expect(trackPosition(5.5, t)).toBe(9.5);
    expect(trackPosition(6, t)).toBeNull();
    expect(trackPosition(-1, t)).toBeNull();
  });

  it('loops the stretch from the offset to the end', () => {
    const loop = { ...t, loop: true };
    expect(trackPosition(6, loop)).toBe(4);
    expect(trackPosition(13, loop)).toBe(5);
  });

  it('is silent when the offset is past the end', () => {
    expect(trackSpan({ duration: 3, offset: 5, loop: true })).toBe(0);
    expect(trackPosition(0, { duration: 3, offset: 5, loop: true })).toBeNull();
  });
});

describe('forEachHeard', () => {
  const heard = (prev: number, clock: number, t: { duration: number; offset: number; loop: boolean }) => {
    const out: Array<[number, number]> = [];
    forEachHeard(prev, clock, t, (a, b) => out.push([Number(a.toFixed(6)), Number(b.toFixed(6))]));
    return out;
  };

  it('covers the stretch heard in a frame, including the start from zero', () => {
    const t = { duration: 10, offset: 2, loop: false };
    expect(heard(0, 0.5, t)).toEqual([[2, 2.5]]);
    expect(heard(1, 1.5, t)).toEqual([[3, 3.5]]);
    expect(heard(1, 1, t)).toEqual([]);
  });

  it('stops at the end, or wraps when looping', () => {
    expect(heard(7.5, 8.5, { duration: 10, offset: 2, loop: false })).toEqual([[9.5, 10]]);
    expect(heard(8.5, 9, { duration: 10, offset: 2, loop: false })).toEqual([]);
    expect(heard(7.5, 8.5, { duration: 10, offset: 2, loop: true })).toEqual([[9.5, 10], [2, 2.5]]);
  });
});
