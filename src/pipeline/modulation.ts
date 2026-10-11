import { smoothstep } from '../core/math.ts';
import { HASH_UNIT, hashInt2 } from '../core/prng.ts';
import type { EnvValue, LfoShape, LfoValue } from './params.ts';

/**
 * A source of modulated numbers, recognized by a marker key in the value
 * object (`lfo`, `env`, later `midi`). Effects never see sources: the engine
 * resolves every param to a plain number each frame (invariant 7).
 */
export interface ModSource {
  /** Marker key: a value object is handled by the first source whose key it has. */
  readonly key: string;
  /** `t` is seconds since the effect's activation. undefined = malformed value. */
  resolve(value: object, t: number): number | undefined;
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
    if (s.key in value) return s.resolve(value, t);
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

registerModSource(lfoSource);
registerModSource(envSource);
