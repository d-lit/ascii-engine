import { describe, expect, it } from 'vitest';
import { isPathSpec, PATH_KINDS } from '../../src/pipeline/points.ts';
import { defaultPath, formatPathPoints, parsePathPoints } from '../../src/ui/point-control.ts';

describe('path points text', () => {
  it('round-trips keyframes', () => {
    const pts: Array<[number, number, number]> = [[0, 0.2, 0.2], [1.5, 1, -0.25]];
    expect(parsePathPoints(formatPathPoints(pts))).toEqual(pts);
  });

  it('rejects garbage, time going back and positions out of range', () => {
    expect(parsePathPoints('')).toBeNull();
    expect(parsePathPoints('0:0.5')).toBeNull();
    expect(parsePathPoints('2:0:0, 1:0:0')).toBeNull();
    expect(parsePathPoints('0:2:0')).toBeNull();
  });
});

describe('defaultPath', () => {
  it.each(PATH_KINDS)('%s is a valid path', (kind) => {
    expect(isPathSpec(defaultPath(kind, { x: 0.3, y: 0.7 }))).toBe(true);
  });
});
