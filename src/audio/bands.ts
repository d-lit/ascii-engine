import { Fft } from '../core/fft.ts';

/** Frequency bands a parameter can follow (SPEC 7.2). */
export const AUDIO_BANDS = ['level', 'bass', 'mid', 'high'] as const;
export type AudioBand = (typeof AUDIO_BANDS)[number];

/** Table step, seconds. */
export const BAND_HOP = 0.01;
const WINDOW = 2048;
// Band edges, Hz.
const EDGES: Record<Exclude<AudioBand, 'level'>, [number, number]> = {
  bass: [20, 150],
  mid: [150, 2000],
  high: [2000, 16000],
};
// Loudness normalised between these percentiles of the track (dB).
const LOW_PERCENTILE = 0.1;
const HIGH_PERCENTILE = 0.95;
const MIN_RANGE_DB = 6;

/**
 * Band loudness of a whole track, one value per `hop` seconds, 0..1
 * (normalised per track), plus prefix sums for O(1) window means.
 */
export interface BandTable {
  readonly hop: number;
  readonly length: number;
  readonly bands: Readonly<Record<AudioBand, Float32Array>>;
  readonly sums: Readonly<Record<AudioBand, Float64Array>>;
}

/** Channels averaged into one. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const n = channels[0]?.length ?? 0;
  const out = new Float32Array(n);
  if (channels.length === 0) return out;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i]! += ch[i]!;
  const k = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i]! *= k;
  return out;
}

/**
 * Analyses in steps so a long track does not freeze the page: `step(n)`
 * processes up to `n` table entries and says whether it is done.
 */
export function createBandAnalysis(samples: Float32Array, sampleRate: number) {
  const hopSamples = Math.max(1, Math.round(sampleRate * BAND_HOP));
  const length = Math.max(1, Math.ceil(samples.length / hopSamples));
  const db = {
    level: new Float32Array(length),
    bass: new Float32Array(length),
    mid: new Float32Array(length),
    high: new Float32Array(length),
  };
  const fft = new Fft(WINDOW);
  const re = new Float64Array(WINDOW);
  const im = new Float64Array(WINDOW);
  const hann = new Float64Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1));
  const binOf = (hz: number): number => Math.min(WINDOW / 2, Math.max(1, Math.round((hz * WINDOW) / sampleRate)));
  const ranges = (Object.keys(EDGES) as Array<keyof typeof EDGES>).map((b) => [b, binOf(EDGES[b][0]), binOf(EDGES[b][1])] as const);
  let next = 0;

  const step = (n: number): boolean => {
    const end = Math.min(length, next + n);
    for (let f = next; f < end; f++) {
      // The window ends at this entry's time: loudness up to the moment.
      const last = f * hopSamples;
      const first = last - WINDOW;
      let square = 0;
      for (let i = 0; i < WINDOW; i++) {
        const s = first + i;
        const v = s >= 0 && s < samples.length ? samples[s]! : 0;
        square += v * v;
        re[i] = v * hann[i]!;
        im[i] = 0;
      }
      db.level[f] = 10 * Math.log10(square / WINDOW + 1e-12);
      fft.transform(re, im);
      for (const [band, lo, hi] of ranges) {
        let e = 0;
        for (let k = lo; k < hi; k++) e += re[k]! * re[k]! + im[k]! * im[k]!;
        db[band][f] = 10 * Math.log10(e + 1e-12);
      }
    }
    next = end;
    return next >= length;
  };

  const table = (): BandTable => {
    const bands = {} as Record<AudioBand, Float32Array>;
    const sums = {} as Record<AudioBand, Float64Array>;
    for (const band of AUDIO_BANDS) {
      bands[band] = normalise(db[band]);
      sums[band] = prefixSums(bands[band]);
    }
    return { hop: hopSamples / sampleRate, length, bands, sums };
  };

  return { step, table };
}

/** Whole track at once; for tests and short clips. */
export function analyseBands(samples: Float32Array, sampleRate: number): BandTable {
  const a = createBandAnalysis(samples, sampleRate);
  while (!a.step(4096));
  return a.table();
}

function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))] ?? 0;
}

/** dB -> 0..1 between the track's quiet and loud percentiles. */
function normalise(db: Float32Array): Float32Array {
  const sorted = Float32Array.from(db).sort();
  const hi = percentile(sorted, HIGH_PERCENTILE);
  const lo = Math.min(percentile(sorted, LOW_PERCENTILE), hi - MIN_RANGE_DB);
  const out = new Float32Array(db.length);
  const k = 1 / (hi - lo);
  for (let i = 0; i < db.length; i++) out[i] = Math.min(1, Math.max(0, (db[i]! - lo) * k));
  return out;
}

function prefixSums(v: Float32Array): Float64Array {
  const s = new Float64Array(v.length + 1);
  for (let i = 0; i < v.length; i++) s[i + 1] = s[i]! + v[i]!;
  return s;
}

/** Mean of entries `(i - w, i]`, clamped to the table. */
function windowMean(sums: Float64Array, length: number, i: number, w: number): number {
  if (i < 0) return 0;
  const hi = Math.min(i, length - 1) + 1;
  const lo = Math.max(0, hi - w);
  return hi > lo ? (sums[hi]! - sums[lo]!) / (hi - lo) : 0;
}

/**
 * Band value at track position `pos` (seconds), 0..1. `attack` averages the
 * last `attack` seconds; `release` holds peaks and lets them fall
 * exponentially. Stateless: depends on `pos` only, so screen, steps, seeks
 * and offline renders agree.
 */
export function sampleBand(table: BandTable, band: AudioBand, pos: number, attack: number, release: number): number {
  const sums = table.sums[band];
  const x = pos / table.hop;
  const i = Math.floor(x);
  const w = Math.max(1, Math.round(attack / table.hop));
  if (release <= 0) {
    const a = windowMean(sums, table.length, i, w);
    const b = windowMean(sums, table.length, i + 1, w);
    return a + (b - a) * (x - i);
  }
  const decay = Math.exp(-table.hop / release);
  const n = Math.min(400, Math.ceil((4 * release) / table.hop));
  // The current (interpolated) value, then older peaks decayed by their age.
  const a = windowMean(sums, table.length, i, w);
  const b = windowMean(sums, table.length, i + 1, w);
  let best = a + (b - a) * (x - i);
  let k = Math.pow(decay, x - i);
  for (let j = 0; j <= n && i - j >= 0; j++) {
    const v = windowMean(sums, table.length, i - j, w) * k;
    if (v > best) best = v;
    k *= decay;
  }
  return best;
}
