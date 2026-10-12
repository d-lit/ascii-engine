import { describe, expect, it } from 'vitest';
import { analyseBands, mixToMono, sampleBand } from '../../src/audio/bands.ts';

const RATE = 22050;

/** `seconds` of a sine at `hz`, silent outside [from, to). */
function tone(hz: number, seconds: number, from = 0, to = seconds): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i] = t >= from && t < to ? 0.5 * Math.sin(2 * Math.PI * hz * t) : 0;
  }
  return out;
}

describe('analyseBands', () => {
  it('puts a low tone in bass and a high tone in high', () => {
    const mixed = new Float32Array(RATE * 2);
    const low = tone(80, 2, 0, 1);
    const high = tone(5000, 2, 1, 2);
    for (let i = 0; i < mixed.length; i++) mixed[i] = low[i]! + high[i]!;
    const t = analyseBands(mixed, RATE);
    const at = (band: 'bass' | 'high', s: number): number => sampleBand(t, band, s, 0.02, 0);
    expect(at('bass', 0.5)).toBeGreaterThan(0.8);
    expect(at('high', 0.5)).toBeLessThan(0.3);
    expect(at('high', 1.5)).toBeGreaterThan(0.8);
    expect(at('bass', 1.5)).toBeLessThan(0.3);
  });

  it('follows loudness in level, silence is 0', () => {
    const t = analyseBands(tone(440, 2, 0.5, 1.5), RATE);
    expect(sampleBand(t, 'level', 0.2, 0.02, 0)).toBe(0);
    expect(sampleBand(t, 'level', 1, 0.02, 0)).toBeGreaterThan(0.9);
  });
});

describe('sampleBand', () => {
  const t = analyseBands(tone(80, 2, 0.5, 1), RATE);

  it('release holds and decays after the sound stops', () => {
    const plain = sampleBand(t, 'bass', 1.2, 0.02, 0);
    const held = sampleBand(t, 'bass', 1.2, 0.02, 0.3);
    const later = sampleBand(t, 'bass', 1.6, 0.02, 0.3);
    expect(plain).toBeLessThan(0.1);
    expect(held).toBeGreaterThan(0.3);
    expect(later).toBeLessThan(held);
  });

  it('depends on the position only', () => {
    expect(sampleBand(t, 'bass', 0.73, 0.05, 0.2)).toBe(sampleBand(t, 'bass', 0.73, 0.05, 0.2));
  });

  it('is 0 before the track and holds the last value past it', () => {
    expect(sampleBand(t, 'bass', -1, 0.02, 0.2)).toBe(0);
    expect(Number.isFinite(sampleBand(t, 'bass', 99, 0.02, 0.2))).toBe(true);
  });
});

describe('mixToMono', () => {
  it('averages channels', () => {
    expect([...mixToMono([Float32Array.of(1, 0), Float32Array.of(0, 1)])]).toEqual([0.5, 0.5]);
  });
});
