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
  /** Beats (onsets): times in seconds, ascending, and strengths 0..1. */
  readonly onsets: Float64Array;
  readonly strengths: Float32Array;
}

// Onsets: rise of band loudness over this many entries, weighted by band.
const ONSET_LAG = 2;
const ONSET_WEIGHTS = { bass: 1, mid: 0.6, high: 0.4 } as const;
// Adaptive threshold: local mean over +-HALF entries plus a margin.
const ONSET_HALF = 25;
const ONSET_MARGIN = 0.08;
// Peak must be the largest within +-PEAK entries; beats at least GAP apart.
const ONSET_PEAK = 5;
const ONSET_GAP = 0.12;

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
    const hop = hopSamples / sampleRate;
    const { onsets, strengths } = findOnsets(bands, length, hop);
    return { hop, length, bands, sums, onsets, strengths };
  };

  return { step, table };
}

/** Whole track at once; for tests and short clips. */
export function analyseBands(samples: Float32Array, sampleRate: number): BandTable {
  const a = createBandAnalysis(samples, sampleRate);
  while (!a.step(4096));
  return a.table();
}

/**
 * Beats from the weighted rise of band loudness (spectral flux on the
 * band table): local peaks above a moving threshold, at least ONSET_GAP
 * apart. Strength = how far the peak clears the threshold, normalised.
 */
export function findOnsets(
  bands: Readonly<Record<AudioBand, Float32Array>>,
  length: number,
  hop: number,
): { onsets: Float64Array; strengths: Float32Array } {
  const flux = new Float32Array(length);
  for (let i = ONSET_LAG; i < length; i++) {
    let f = 0;
    for (const band of ['bass', 'mid', 'high'] as const) {
      const v = bands[band];
      f += ONSET_WEIGHTS[band] * Math.max(0, v[i]! - v[i - ONSET_LAG]!);
    }
    flux[i] = f;
  }
  const sums = prefixSums(flux);
  const times: number[] = [];
  const heights: number[] = [];
  let last = -Infinity;
  for (let i = 1; i < length; i++) {
    const f = flux[i]!;
    const lo = Math.max(0, i - ONSET_HALF);
    const hi = Math.min(length, i + ONSET_HALF + 1);
    const threshold = (sums[hi]! - sums[lo]!) / (hi - lo) + ONSET_MARGIN;
    if (f <= threshold) continue;
    let peak = true;
    for (let j = Math.max(0, i - ONSET_PEAK); j <= Math.min(length - 1, i + ONSET_PEAK); j++) {
      if (flux[j]! > f || (flux[j] === f && j < i)) {
        peak = false;
        break;
      }
    }
    // The rise is measured over ONSET_LAG entries: the beat began at its start.
    const t = (i - ONSET_LAG) * hop;
    if (!peak || t - last < ONSET_GAP) continue;
    times.push(t);
    heights.push(f - threshold);
    last = t;
  }
  const sorted = Float32Array.from(heights).sort();
  const top = Math.max(1e-6, percentile(sorted, 0.9));
  return {
    onsets: Float64Array.from(times),
    strengths: Float32Array.from(heights, (h) => Math.min(1, h / top)),
  };
}

/** Index of the last onset at or before `pos`, or -1. */
export function lastOnset(table: BandTable, pos: number): number {
  const o = table.onsets;
  let lo = 0;
  let hi = o.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (o[mid]! <= pos) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Strength of the strongest onset in `(from, to]`, 0 if none. */
export function beatBetween(table: BandTable, from: number, to: number): number {
  let best = 0;
  for (let i = lastOnset(table, to); i >= 0 && table.onsets[i]! > from; i--) {
    const s = table.strengths[i]!;
    if (s > best) best = s;
  }
  return best;
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
