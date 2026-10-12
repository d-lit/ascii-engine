import { describe, expect, it } from 'vitest';
import { analyseBands } from '../../src/audio/bands.ts';
import { createField } from '../../src/core/field.ts';
import { defineEffect } from '../../src/effects/types.ts';
import { resolveMod } from '../../src/pipeline/modulation.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';
import { isParamValue } from '../../src/presets/preset.ts';

const RATE = 22050;

/** Bass beat: an 80 Hz burst for the first 0.3 s of every second, 4 s. */
function beats(): Float32Array {
  const out = new Float32Array(RATE * 4);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    out[i] = t % 1 < 0.3 ? 0.5 * Math.sin(2 * Math.PI * 80 * t) : 0;
  }
  return out;
}

function probePipeline(value: unknown): { p: Pipeline; seen: number[] } {
  const seen: number[] = [];
  const probe = defineEffect({
    id: 'probe-audio',
    name: 'Probe',
    kind: 'cell',
    params: { amount: { type: 'number', min: 0, max: 10, default: 0 } },
    create: (params) => ({
      kind: 'cell',
      apply: (_cell, x, y) => {
        if (x === 0 && y === 0) seen.push(params.amount);
      },
    }),
  });
  const p = new Pipeline(createField(2, 2), { cellAspect: 0.5, polarity: 'light-on-dark' }, createPointer());
  p.add(probe, { amount: value as number });
  return { p, seen };
}

describe('audio modulation', () => {
  const bands = analyseBands(beats(), RATE);
  const value = { audio: 'bass', min: 1, max: 9, release: 0 };

  it('is a valid preset value; malformed ones are not', () => {
    expect(isParamValue(value)).toBe(true);
    expect(isParamValue({ audio: 'drums', min: 0, max: 1 })).toBe(false);
    expect(isParamValue({ audio: 'bass', min: 0 })).toBe(false);
  });

  it('sits at min without a track', () => {
    expect(resolveMod(value, 0)).toBe(1);
  });

  it('follows the bass on the transport clock, with the track offset', () => {
    const { p, seen } = probePipeline(value);
    p.setAudio({ bands, timing: { duration: 4, offset: 0, loop: false } });
    p.frame(0);
    for (let i = 0; i < 40; i++) p.frame(1 / 40); // t = 1.0 s: burst of the 2nd beat starts
    for (let i = 0; i < 6; i++) p.frame(1 / 40); // t = 1.15 s: inside the burst
    const inBurst = seen[seen.length - 1]!;
    for (let i = 0; i < 20; i++) p.frame(1 / 40); // t = 1.65 s: quiet
    const quiet = seen[seen.length - 1]!;
    expect(inBurst).toBeGreaterThan(7);
    expect(quiet).toBeLessThan(2);

    // Offset 0.5 s: at transport 0.15 s the track is at 0.65 s, quiet.
    const shifted = probePipeline(value);
    shifted.p.setAudio({ bands, timing: { duration: 4, offset: 0.5, loop: false } });
    shifted.p.frame(0);
    for (let i = 0; i < 6; i++) shifted.p.frame(1 / 40);
    expect(shifted.seen[shifted.seen.length - 1]).toBeLessThan(2);
  });

  it('gives the same numbers for the same times, whatever the frame steps', () => {
    const a = probePipeline(value);
    const b = probePipeline(value);
    for (const x of [a, b]) x.p.setAudio({ bands, timing: { duration: 4, offset: 0, loop: true } });
    a.p.frame(0);
    b.p.frame(0);
    for (let i = 0; i < 60; i++) a.p.frame(1 / 60);
    for (let i = 0; i < 20; i++) b.p.frame(1 / 20);
    expect(a.seen[a.seen.length - 1]).toBeCloseTo(b.seen[b.seen.length - 1]!, 3);
  });

  it('keeps two pipelines apart (live view and offline render)', () => {
    const live = probePipeline(value);
    const off = probePipeline(value);
    live.p.setAudio({ bands, timing: { duration: 4, offset: 0, loop: false } });
    live.p.frame(0);
    off.p.frame(0);
    for (let i = 0; i < 6; i++) {
      live.p.frame(1 / 40);
      off.p.frame(1 / 40);
    }
    expect(live.seen[live.seen.length - 1]).toBeGreaterThan(7);
    expect(off.seen[off.seen.length - 1]).toBe(1);
  });
});

describe('beats', () => {
  const RATE2 = 22050;
  // Kicks at 0, 1, 2, 3 s.
  const s = new Float32Array(RATE2 * 4);
  for (let i = 0; i < s.length; i++) {
    const t = i / RATE2;
    s[i] = 0.6 * Math.exp(-(t % 1) / 0.08) * Math.sin(2 * Math.PI * 70 * t);
  }
  const bands = analyseBands(s, RATE2);
  const feed = { bands, timing: { duration: 4, offset: 0, loop: false } };

  it('pulses ctx.beat once per beat, in the frame that hears it', () => {
    const { p } = probePipeline(0);
    p.setAudio(feed);
    const hits: number[] = [];
    p.frame(0);
    for (let i = 1; i <= 160; i++) {
      p.frame(1 / 40);
      if (p.ctx.beat > 0) hits.push(Number(p.ctx.time.toFixed(3)));
    }
    expect(hits.length).toBe(4);
    hits.forEach((h, k) => expect(Math.abs(h - k)).toBeLessThan(0.08));
  });

  it('restarts an envelope on every beat', () => {
    const value = { env: [[0, 10], [0.5, 0]], on: 'beat' };
    const { p, seen } = probePipeline(value);
    p.setAudio(feed);
    p.frame(0);
    for (let i = 0; i < 44; i++) p.frame(1 / 40); // t = 1.1: 0.1 s after a beat
    expect(seen[seen.length - 1]).toBeGreaterThan(6);
    for (let i = 0; i < 16; i++) p.frame(1 / 40); // t = 1.5: 0.5 s after
    expect(seen[seen.length - 1]).toBeLessThan(1);
  });

  it('rests at the last point without a track', () => {
    expect(resolveMod({ env: [[0, 10], [0.5, 2]], on: 'beat' }, 0.1)).toBe(2);
  });
});

describe('restartAt', () => {
  it('puts every effect clock at the given time without running frames', () => {
    const value = { lfo: 'saw', freq: 0.1, min: 0, max: 10 };
    const { p, seen } = probePipeline(value);
    p.restartAt(4);
    p.frame(0);
    expect(p.ctx.time).toBe(4);
    expect(seen[seen.length - 1]).toBeCloseTo(4, 6);
  });
});
