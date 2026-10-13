import { smoothstep } from '../core/math.ts';
import { HASH_UNIT, hashInt2 } from '../core/prng.ts';
import { AUDIO_BANDS, sampleBand, type BandTable } from '../audio/bands.ts';
import { trackPosition, type TrackTiming } from '../audio/track.ts';
import { crossings, stepAt } from '../audio/steps.ts';
import type { AudioValue, EnvValue, LfoShape, LfoValue, StepValue } from './params.ts';

/** The analysed track and how it lines up with the transport (SPEC 7.2). */
export interface AudioFeed {
  readonly bands: BandTable;
  readonly timing: TrackTiming;
}

/**
 * What sources may read besides the effect clock: the transport time and
 * the audio feed. One per pipeline, made current by the pipeline before it
 * resolves params (resolution is synchronous, so the live view and an
 * offline render never see each other's).
 */
export interface ModEnv {
  /** Transport seconds (pipeline time since restart). */
  time: number;
  audio: AudioFeed | null;
}

let env: ModEnv = { time: 0, audio: null };

export function setModEnv(next: ModEnv): void {
  env = next;
}

/** The env of the pipeline resolving params right now (point sources read it too). */
export function currentModEnv(): ModEnv {
  return env;
}

/** Where a step source stands: step index and seconds since that step (or -1). */
export interface StepState {
  k: number;
  since: number;
}

/**
 * Step index of `band` at `threshold` at the env's transport time, written
 * into `out` (no allocation per call). No track or before the track: k = 0.
 */
export function stepState(e: ModEnv, band: (typeof AUDIO_BANDS)[number], threshold: number, out: StepState): void {
  out.k = 0;
  out.since = -1;
  const feed = e.audio;
  if (feed === null) return;
  const pos = trackPosition(e.time, feed.timing);
  if (pos === null) return;
  const list = crossings(feed.bands, band, threshold);
  const k = stepAt(list, feed.bands.hop, pos);
  out.k = k;
  if (k > 0) out.since = pos - list[k - 1]! * feed.bands.hop;
}

/** 0..1 eased progress of a glide, 1 when not gliding. */
export function glideAt(since: number, glide: number): number {
  if (glide <= 0 || since < 0 || since >= glide) return 1;
  const u = since / glide;
  return u * u * (3 - 2 * u);
}

/**
 * A source of modulated numbers, recognized by a marker key in the value
 * object (`lfo`, `env`, later `midi`). Effects never see sources: the engine
 * resolves every param to a plain number each frame (invariant 7).
 */
export interface ModSource {
  /** Marker key: a value object is handled by the first source whose key it has. */
  readonly key: string;
  /** `t` is seconds since the effect's activation. undefined = malformed value. */
  resolve(value: object, t: number, env: ModEnv): number | undefined;
}

const sources: ModSource[] = [];

export function registerModSource(source: ModSource): void {
  if (sources.some((s) => s.key === source.key)) {
    throw new Error(`modulation source already registered: ${source.key}`);
  }
  sources.push(source);
}

/** Called per param per frame: indexed loop, no allocation. */
export function resolveMod(value: object, t: number): number | undefined {
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i]!;
    if (s.key in value) return s.resolve(value, t, env);
  }
  return undefined;
}

// ---- LFO ----

const SHAPES: readonly LfoShape[] = ['sine', 'triangle', 'saw', 'square', 'noise'];
const NOISE_SEED = 0x1f0;
const TAU = Math.PI * 2;

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Unit waveform 0..1 at cycle position `u` (cycles). Every shape starts at
 * its minimum at u = 0, so `phase` reads the same for all of them.
 */
export function lfoUnit(shape: LfoShape, u: number): number {
  const f = u - Math.floor(u);
  switch (shape) {
    case 'sine':
      return 0.5 - 0.5 * Math.cos(TAU * f);
    case 'triangle':
      return f < 0.5 ? 2 * f : 2 - 2 * f;
    case 'saw':
      return f;
    case 'square':
      return f < 0.5 ? 0 : 1;
    case 'noise': {
      // Smooth value noise: a new random level every cycle, eased between.
      const n = Math.floor(u) | 0;
      const a = hashInt2(n, 0, NOISE_SEED) * HASH_UNIT;
      const b = hashInt2(n + 1, 0, NOISE_SEED) * HASH_UNIT;
      return a + (b - a) * smoothstep(0, 1, f);
    }
  }
}

function isLfo(v: object): v is LfoValue {
  const o = v as Partial<LfoValue>;
  return (
    typeof o.lfo === 'string' &&
    SHAPES.includes(o.lfo) &&
    finite(o.freq) &&
    finite(o.min) &&
    finite(o.max) &&
    (o.phase === undefined || finite(o.phase))
  );
}

export const lfoSource: ModSource = {
  key: 'lfo',
  resolve(value, t) {
    if (!isLfo(value)) return undefined;
    const u = value.freq * t + (value.phase ?? 0);
    return value.min + (value.max - value.min) * lfoUnit(value.lfo, u);
  },
};

// ---- envelope ----

function isEnv(v: object): v is EnvValue {
  const o = v as Partial<EnvValue>;
  if (!Array.isArray(o.env) || o.env.length === 0) return false;
  let prev = -Infinity;
  for (const p of o.env) {
    if (!Array.isArray(p) || !finite(p[0]) || !finite(p[1]) || p[0] < prev) return false;
    prev = p[0];
  }
  return o.ease === undefined || o.ease === 'linear' || o.ease === 'smooth';
}

/** Value of breakpoints at time `t`; holds the ends, optionally loops. */
export function envAt(env: EnvValue, t: number): number {
  const pts = env.env;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  let time = t;
  if (env.loop === true && last[0] > first[0] && time > last[0]) {
    const period = last[0] - first[0];
    time = first[0] + ((time - first[0]) % period);
  }
  if (time <= first[0]) return first[1];
  if (time >= last[0]) return last[1];

  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]!;
    if (time > b[0]) continue;
    const a = pts[i - 1]!;
    const span = b[0] - a[0];
    let k = span > 0 ? (time - a[0]) / span : 1;
    if (env.ease === 'smooth') k = smoothstep(0, 1, k);
    return a[1] + (b[1] - a[1]) * k;
  }
  return last[1];
}

export const envSource: ModSource = {
  key: 'env',
  resolve(value, t) {
    return isEnv(value) ? envAt(value, t) : undefined;
  },
};

// ---- audio (SPEC 7.2) ----

export const AUDIO_ATTACK = 0.02;
export const AUDIO_RELEASE = 0.25;

function isAudio(v: object): v is AudioValue {
  const o = v as Partial<AudioValue>;
  return (
    typeof o.audio === 'string' &&
    (AUDIO_BANDS as readonly string[]).includes(o.audio) &&
    finite(o.min) &&
    finite(o.max) &&
    (o.gain === undefined || finite(o.gain)) &&
    (o.floor === undefined || finite(o.floor)) &&
    (o.attack === undefined || finite(o.attack)) &&
    (o.release === undefined || finite(o.release))
  );
}

/** Follows a band of the track at transport time; `min` without a track or past its end. */
export const audioSource: ModSource = {
  key: 'audio',
  resolve(value, _t, e) {
    if (!isAudio(value)) return undefined;
    const feed = e.audio;
    if (feed === null) return value.min;
    const pos = trackPosition(e.time, feed.timing);
    if (pos === null) return value.min;
    const raw = sampleBand(feed.bands, value.audio, pos, Math.max(0, value.attack ?? AUDIO_ATTACK), Math.max(0, value.release ?? AUDIO_RELEASE));
    // Floor: the band's resting level (a bass tail) reads as silence, so the
    // value swings the whole way between quiet and a hit.
    const floor = Math.min(0.95, Math.max(0, value.floor ?? 0));
    const gated = raw <= floor ? 0 : (raw - floor) / (1 - floor);
    const v = Math.min(1, Math.max(0, gated * (value.gain ?? 1)));
    return value.min + (value.max - value.min) * v;
  },
};

// ---- step on audio (SPEC 7.3) ----

const STEP_MODES = ['random', 'cycle', 'add'] as const;
const STEP_SEED = 0x57e9;
const stepScratch: StepState = { k: 0, since: -1 };

function isStep(v: object): v is StepValue {
  const o = v as Partial<StepValue>;
  return (
    typeof o.step === 'string' &&
    (AUDIO_BANDS as readonly string[]).includes(o.step) &&
    finite(o.threshold) &&
    typeof o.mode === 'string' &&
    (STEP_MODES as readonly string[]).includes(o.mode) &&
    finite(o.min) &&
    finite(o.max) &&
    (o.values === undefined || (Array.isArray(o.values) && o.values.every(finite))) &&
    (o.by === undefined || finite(o.by)) &&
    (o.glide === undefined || finite(o.glide)) &&
    (o.seed === undefined || finite(o.seed))
  );
}

/** The value of step `k`; step 0 is the value before the first step. */
export function stepValue(v: StepValue, k: number): number {
  switch (v.mode) {
    case 'random':
      return v.min + (v.max - v.min) * hashInt2(k, v.seed ?? 0, STEP_SEED) * HASH_UNIT;
    case 'cycle': {
      const list = v.values ?? [];
      return list.length === 0 ? v.min : list[k % list.length]!;
    }
    case 'add': {
      const span = v.max - v.min;
      if (span <= 0) return v.min;
      const d = (k * (v.by ?? 0)) % span;
      return v.min + (d < 0 ? d + span : d);
    }
  }
}

export const stepSource: ModSource = {
  key: 'step',
  resolve(value, _t, e) {
    if (!isStep(value)) return undefined;
    stepState(e, value.step, value.threshold, stepScratch);
    const k = stepScratch.k;
    const now = stepValue(value, k);
    const g = glideAt(stepScratch.since, value.glide ?? 0);
    if (g >= 1 || k === 0) return now;
    const before = stepValue(value, k - 1);
    return before + (now - before) * g;
  },
};

registerModSource(lfoSource);
registerModSource(envSource);
registerModSource(audioSource);
registerModSource(stepSource);
