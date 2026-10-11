import { describe, expect, it } from 'vitest';
import { formatEnv, parseEnv } from '../../src/ui/controls.ts';

describe('envelope text', () => {
  it('round-trips breakpoints', () => {
    const pts: Array<[number, number]> = [[0, 0], [1.5, 10], [3, -0.25]];
    expect(parseEnv(formatEnv(pts))).toEqual(pts);
  });

  it('tolerates spaces and a trailing comma', () => {
    expect(parseEnv(' 0 : 1 ,2:3, ')).toEqual([[0, 1], [2, 3]]);
  });

  it('rejects garbage, empty input and time going backwards', () => {
    expect(parseEnv('')).toBeNull();
    expect(parseEnv('0:1, x:2')).toBeNull();
    expect(parseEnv('2:1, 1:2')).toBeNull();
    expect(parseEnv('0-1')).toBeNull();
  });
});
