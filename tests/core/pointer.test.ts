import { describe, expect, it } from 'vitest';
import { clientToCell, smoothToward } from '../../src/core/pointer.ts';

describe('clientToCell', () => {
  const rect = { left: 10, top: 20, width: 100, height: 50 };

  it('puts cell centres on integer coordinates', () => {
    const out = { x: 0, y: 0 };
    clientToCell(15, 22.5, rect, 10, 10, out); // centre of cell (0, 0)
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(0);
    clientToCell(105, 67.5, rect, 10, 10, out); // centre of cell (9, 9)
    expect(out.x).toBeCloseTo(9);
    expect(out.y).toBeCloseTo(9);
  });
});

describe('smoothToward', () => {
  it('is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 2; i++) a = smoothToward(a, 10, 1 / 60, 0.06);
    const b = smoothToward(0, 10, 2 / 60, 0.06);
    expect(a).toBeCloseTo(b, 9);
  });

  it('holds still on dt = 0 and converges to the target', () => {
    expect(smoothToward(3, 10, 0, 0.06)).toBe(3);
    expect(smoothToward(0, 10, 1, 0.06)).toBeCloseTo(10, 4);
  });
});
