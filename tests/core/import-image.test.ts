import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LEVELS,
  applyLevels,
  computeRows,
  detectBackground,
  importImage,
  luma,
  sobel,
} from '../../src/core/import-image.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image import math', () => {
  it('computes rows with cell aspect correction', () => {
    expect(computeRows(1920, 1080, 160, 0.5)).toBe(45);
    expect(computeRows(1, 10, 1, 0.01)).toBe(1);
  });

  it('applies levels and clamps the result', () => {
    expect(applyLevels(0.25, DEFAULT_LEVELS)).toBe(0.25);
    expect(applyLevels(0.25, { ...DEFAULT_LEVELS, invert: true })).toBe(0.75);
    expect(applyLevels(0.25, { ...DEFAULT_LEVELS, gamma: 2 })).toBe(0.5);
    expect(applyLevels(0.25, { ...DEFAULT_LEVELS, contrast: 2 })).toBe(0);
    expect(applyLevels(0.25, { ...DEFAULT_LEVELS, brightness: 2 })).toBe(1);
  });

  it('uses Rec.709 coefficients', () => {
    expect(luma(1, 0, 0)).toBeCloseTo(0.2126);
    expect(luma(0, 1, 0)).toBeCloseTo(0.7152);
    expect(luma(0, 0, 1)).toBeCloseTo(0.0722);
  });

  it('produces zero Sobel gradients for a flat field', () => {
    const lum = new Float32Array(9).fill(0.5);
    const x = new Float32Array(9);
    const y = new Float32Array(9);

    sobel(lum, 3, 3, x, y);

    expect([...x]).toEqual(new Array<number>(9).fill(0));
    expect([...y]).toEqual(new Array<number>(9).fill(0));
  });

  it('detects a vertical edge in gradX only', () => {
    const lum = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const x = new Float32Array(9);
    const y = new Float32Array(9);

    sobel(lum, 3, 3, x, y);

    expect(x.some((value) => value > 0)).toBe(true);
    expect([...y]).toEqual(new Array<number>(9).fill(0));
  });

  it('removes cells near the average corner brightness', () => {
    const lum = new Float32Array([0.2, 0.2, 0.2, 0.2, 0.8, 0.2, 0.2, 0.2, 0.2]);
    const alpha = new Float32Array(9).fill(1);

    detectBackground(lum, 3, 3, 0.05, alpha);

    expect([...alpha]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });

  it('weights fractional source-pixel coverage during downscale', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      120, 120, 120, 255,
      240, 240, 240, 255,
    ]);
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: pixels })),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });

    const bitmap = { width: 3, height: 1 } as unknown as ImageBitmap;
    const field = importImage(bitmap, { cols: 2, cellAspect: 1 });

    expect(field.lum[0]).toBeCloseTo(40 / 255);
    expect(field.lum[1]).toBeCloseTo(200 / 255);
    expect([...field.alpha]).toEqual([1, 1]);
  });
});
