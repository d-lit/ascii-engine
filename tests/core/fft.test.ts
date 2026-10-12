import { describe, expect, it } from 'vitest';
import { Fft } from '../../src/core/fft.ts';

describe('Fft', () => {
  it('matches a direct DFT', () => {
    const n = 16;
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1));
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    new Fft(n).transform(re, im);
    for (let k = 0; k < n; k++) {
      let r = 0;
      let m = 0;
      for (let i = 0; i < n; i++) {
        r += x[i]! * Math.cos((-2 * Math.PI * k * i) / n);
        m += x[i]! * Math.sin((-2 * Math.PI * k * i) / n);
      }
      expect(re[k]).toBeCloseTo(r, 9);
      expect(im[k]).toBeCloseTo(m, 9);
    }
  });

  it('rejects sizes that are not powers of two', () => {
    expect(() => new Fft(12)).toThrow();
  });
});
