import { createRand } from '../core/prng.ts';
import type { AnyEffectDef } from '../effects/types.ts';
import type { MaskSpec } from '../pipeline/mask.ts';
import type {
  LfoShape,
  NumberSpec,
  ParamInput,
  ParamSpec,
  ParamValue,
  PointValue,
} from '../pipeline/params.ts';
import type { PresetEffect } from './preset.ts';

export interface RandomChainOptions {
  minEffects?: number;
  maxEffects?: number;
  /** Most displace effects in one chain; several at once turn to mush. */
  maxDisplace?: number;
  /** Chance that one number param of an effect gets an LFO. */
  lfoChance?: number;
  maskChance?: number;
  /** Chance of a modulated mix. */
  mixChance?: number;
}

const DEFAULTS: Required<RandomChainOptions> = {
  minEffects: 2,
  maxEffects: 4,
  maxDisplace: 2,
  lfoChance: 0.35,
  maskChance: 0.2,
  mixChance: 0.15,
};

const LFO_SHAPES: readonly LfoShape[] = ['sine', 'sine', 'triangle', 'noise', 'noise', 'saw', 'square'];
// Without a `random` hint, draw within this share of the spec span around the default.
const AROUND_DEFAULT = 0.3;

type Rand = () => number;

function pick<T>(rand: Rand, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function between(rand: Rand, lo: number, hi: number): number {
  return lo + (hi - lo) * rand();
}

/** Snaps to the spec step and strips float noise, so presets stay readable. */
function snap(spec: NumberSpec, v: number): number {
  const clamped = Math.min(spec.max, Math.max(spec.min, v));
  const step = spec.step ?? 0;
  if (step <= 0) return Number(clamped.toPrecision(4));
  const snapped = Math.round(clamped / step) * step;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(snapped.toFixed(decimals));
}

/** The range a number param is drawn from. */
export function randomRange(spec: NumberSpec): [number, number] {
  if (spec.random !== undefined) {
    const lo = Math.max(spec.min, Math.min(spec.random[0], spec.random[1]));
    const hi = Math.min(spec.max, Math.max(spec.random[0], spec.random[1]));
    return [lo, hi];
  }
  const half = (spec.max - spec.min) * AROUND_DEFAULT * 0.5;
  return [Math.max(spec.min, spec.default - half), Math.min(spec.max, spec.default + half)];
}

function randomLfo(rand: Rand, spec: NumberSpec, lo: number, hi: number): ParamValue {
  const a = snap(spec, between(rand, lo, hi));
  const b = snap(spec, between(rand, lo, hi));
  return {
    lfo: pick(rand, LFO_SHAPES),
    freq: Number(between(rand, 0.05, 0.5).toFixed(2)),
    min: Math.min(a, b),
    max: Math.max(a, b) === Math.min(a, b) ? snap(spec, hi) : Math.max(a, b),
  };
}

function randomParam(rand: Rand, spec: ParamSpec, modulate: boolean): ParamInput | undefined {
  switch (spec.type) {
    case 'number': {
      const [lo, hi] = randomRange(spec);
      return modulate ? randomLfo(rand, spec, lo, hi) : snap(spec, between(rand, lo, hi));
    }
    case 'select':
      return pick(rand, spec.options);
    case 'boolean':
      return rand() < 0.8 ? spec.default : !spec.default;
    case 'point':
      return randomPoint(rand, spec.default);
    case 'color':
      return undefined; // colour is not rendered yet (DECISIONS 015)
  }
}

const ANCHORS = [0, 0.5, 1] as const;

/** Default, pointer, one of the nine anchors, or a free spot (sometimes off the edge). */
function randomPoint(rand: Rand, fallback: PointValue): PointValue {
  const r = rand();
  if (r < 0.3) return fallback;
  if (r < 0.5) return 'pointer';
  if (r < 0.85) return { x: pick(rand, ANCHORS), y: pick(rand, ANCHORS) };
  const free = (): number => Number(between(rand, -0.25, 1.25).toFixed(2));
  return { x: free(), y: free() };
}

function randomMask(rand: Rand): MaskSpec {
  if (rand() < 0.6) {
    return { type: 'radial', center: 'pointer', radius: Math.round(between(rand, 12, 35)), soft: Math.round(between(rand, 4, 12)) };
  }
  const mid = between(rand, 0.3, 0.7);
  return rand() < 0.5
    ? { type: 'lum', min: Number(mid.toFixed(2)), max: 1, soft: 0.1 }
    : { type: 'lum', min: 0, max: Number(mid.toFixed(2)), soft: 0.1 };
}

/**
 * A random but sensible chain for exploring looks. Deterministic per seed;
 * every value is within its spec, so the result validates without warnings.
 * Displace effects come first (they feed the cell stage anyway).
 */
export function randomChain(
  effects: readonly AnyEffectDef[],
  seed: number,
  options: RandomChainOptions = {},
): PresetEffect[] {
  const o = { ...DEFAULTS, ...options };
  const rand = createRand(seed);

  const pool = [...effects];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }

  const span = Math.max(0, o.maxEffects - o.minEffects);
  const want = Math.min(pool.length, o.minEffects + Math.floor(rand() * (span + 1)));
  const chosen: AnyEffectDef[] = [];
  let displace = 0;
  for (const def of pool) {
    if (chosen.length >= want) break;
    if (def.kind === 'displace') {
      if (displace >= o.maxDisplace) continue;
      displace++;
    }
    chosen.push(def);
  }
  chosen.sort((a, b) => (a.kind === 'displace' ? 0 : 1) - (b.kind === 'displace' ? 0 : 1));

  return chosen.map((def) => {
    const numberKeys = Object.keys(def.params).filter((k) => def.params[k]!.type === 'number');
    const modulated = numberKeys.length > 0 && rand() < o.lfoChance ? pick(rand, numberKeys) : null;

    const params: Record<string, ParamInput> = {};
    for (const key of Object.keys(def.params)) {
      const v = randomParam(rand, def.params[key]!, key === modulated);
      if (v !== undefined) params[key] = v;
    }

    const mix: ParamValue =
      rand() < o.mixChance
        ? { lfo: pick(rand, LFO_SHAPES), freq: Number(between(rand, 0.05, 0.3).toFixed(2)), min: 0.2, max: 1 }
        : 1;
    const mask = rand() < o.maskChance ? randomMask(rand) : null;
    return { effect: def.id, params, enabled: true, mix, mask };
  });
}
