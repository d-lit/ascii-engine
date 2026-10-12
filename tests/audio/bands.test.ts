import { describe, expect, it } from 'vitest';
import { analyseBands, lastOnset, mixToMono, sampleBand } from '../../src/audio/bands.ts';

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

/** Kick-like: a 70 Hz thump fading over ~0.1 s, as a real bass drum (no click at the end). */
function kick(age: number, t: number): number {
  return 0.6 * Math.exp(-age / 0.08) * Math.sin(2 * Math.PI * 70 * t);
}

describe('onsets', () => {
  it('finds a beat at each burst start, none in between', () => {
    const s = new Float32Array(RATE * 4);
    for (let i = 0; i < s.length; i++) {
      const t = i / RATE;
      s[i] = kick(t % 1, t);
    }
    const t = analyseBands(s, RATE);
    const beats = [...t.onsets];
    expect(beats.length).toBe(4);
    beats.forEach((b, k) => expect(Math.abs(b - k)).toBeLessThan(0.06));
    expect(Math.min(...t.strengths)).toBeGreaterThan(0.3);
  });

  it('lastOnset finds the latest beat at or before a time', () => {
    const s = new Float32Array(RATE * 3);
    for (let i = 0; i < s.length; i++) {
      const t = i / RATE;
      s[i] = kick(t % 1, t);
    }
    const t = analyseBands(s, RATE);
    expect(lastOnset(t, -1)).toBe(-1);
    expect(lastOnset(t, 1.5)).toBe(1);
    expect(lastOnset(t, 99)).toBe(t.onsets.length - 1);
  });
});
