import { describe, expect, it } from 'vitest';
import { trackPosition, trackSpan } from '../../src/audio/track.ts';

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
