import { blockGlyphDensity } from '../render/block-glyphs.ts';
import { setupGlyphFont } from '../render/glyph-font.ts';
import type { Polarity } from './field.ts';

export interface Ramp {
  chars: string;
  /** Normalized 0..1 within this ramp (DECISIONS 006). */
  density: Float32Array;
  /** Raw densities that map to 0 and 1; places outside glyphs on this scale (DECISIONS 011). */
  rawMin: number;
  rawMax: number;
  /**
   * The built-in ramps measured for the same font, in RAMP_NAMES order:
   * a cell with `rampSel` k > 0 is quantized with `alt[k - 1]` (DECISIONS 030).
   */
  alt?: readonly Ramp[];
}

/** Raw ink coverage of a glyph, 0..1. Analytic for block glyphs. */
export type DensityMeasurer = (char: string) => number;

export type QuantizeMode = 'nearest-density' | 'uniform';

export interface FontSpec {
  family: string;
  weight: number;
  /** Physical pixels (already scaled by devicePixelRatio). */
  cellW: number;
  cellH: number;
}

export type RampName = 'blocks' | 'classic' | 'long' | 'binary' | 'dots';

/** Order of the built-in ramps for per-cell selection: `rampSel` k means RAMP_NAMES[k - 1]. */
export const RAMP_NAMES: readonly RampName[] = ['blocks', 'classic', 'long', 'binary', 'dots'];

export const BUILTIN_RAMP_CHARS: Record<RampName, string> = {
  blocks: ' \u2591\u2592\u2593\u2588',
  classic: ' .:-=+*#%@',
  long: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  binary: ' 01',
  dots: ' .\u00b7\u2022\u25cf',
};

/**
 * Pure ramp assembly: dedupe, sort by density, min-max normalize.
 * Normalization makes the densest glyph 1.0 so the ramp spans all of 0..1
 * regardless of the glyphs' physical coverage (DECISIONS 006).
 */
export function makeRamp(chars: string, density: ArrayLike<number>): Ramp {
  const points = Array.from(chars);
  if (points.length === 0) throw new Error('makeRamp: empty ramp');
  if (density.length !== points.length) {
    throw new Error(`makeRamp: ${points.length} chars vs ${density.length} densities`);
  }

  const seen = new Set<string>();
  const pairs: Array<{ char: string; d: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const char = points[i]!;
    // Field.char is Uint16Array, so only BMP glyphs are representable.
    if (char.length !== 1) throw new Error(`makeRamp: non-BMP glyph ${JSON.stringify(char)}`);
    if (seen.has(char)) continue;
    seen.add(char);
    pairs.push({ char, d: density[i]! });
  }

  pairs.sort((a, b) => a.d - b.d);

  const min = pairs[0]!.d;
  const max = pairs[pairs.length - 1]!.d;
  const span = max - min;

  const out = new Float32Array(pairs.length);
  if (span > 0) {
    for (let i = 0; i < pairs.length; i++) out[i] = (pairs[i]!.d - min) / span;
  }

  return { chars: pairs.map((p) => p.char).join(''), density: out, rawMin: min, rawMax: max };
}

/** Maps a raw density onto the ramp's normalized scale, clamped to 0..1. */
export function normalizeDensity(ramp: Ramp, raw: number): number {
  const span = ramp.rawMax - ramp.rawMin;
  if (span <= 0) return 0;
  const d = (raw - ramp.rawMin) / span;
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

function fontKey(font: FontSpec): string {
  return `${font.family}|${font.weight}|${font.cellW}x${font.cellH}`;
}

const measurerCache = new Map<string, DensityMeasurer>();
const rampCache = new Map<string, Ramp>();

/**
 * Canvas measurer for one font, cached per font and per glyph. Shared by
 * measureRamp and text import (DECISIONS 008). Needs DOM.
 * `cellW`/`cellH` are physical pixels, the same tile the atlas draws.
 */
export function createDensityMeasurer(font: FontSpec): DensityMeasurer {
  const key = fontKey(font);
  const cached = measurerCache.get(key);
  if (cached) return cached;

  const w = Math.max(1, Math.round(font.cellW));
  const h = Math.max(1, Math.round(font.cellH));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('createDensityMeasurer: no 2d context');
  setupGlyphFont(ctx, { ...font, cellW: w, cellH: h });
  ctx.fillStyle = '#fff';

  const total = w * h * 255;
  const glyphs = new Map<string, number>();

  const measure: DensityMeasurer = (char) => {
    const hit = glyphs.get(char);
    if (hit !== undefined) return hit;

    // Block glyphs are drawn procedurally; their exact coverage is known.
    const analytic = char.length === 1 ? blockGlyphDensity(char.charCodeAt(0), w, h) : undefined;
    let d: number;
    if (analytic !== undefined) {
      d = analytic;
    } else {
      ctx.clearRect(0, 0, w, h);
      ctx.fillText(char, w / 2, h / 2);
      const data = ctx.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let p = 3; p < data.length; p += 4) sum += data[p]!;
      d = sum / total;
    }
    glyphs.set(char, d);
    return d;
  };

  measurerCache.set(key, measure);
  return measure;
}

/** Measures every glyph with the font's measurer, then delegates to makeRamp. */
export function measureRamp(chars: string, font: FontSpec): Ramp {
  const key = `${chars}|${fontKey(font)}`;
  const cached = rampCache.get(key);
  if (cached) return cached;

  const measure = createDensityMeasurer(font);
  const ramp = makeRamp(chars, Array.from(chars, measure));
  rampCache.set(key, ramp);
  return ramp;
}

/**
 * `chars` measured for the font, carrying every built-in ramp for the same
 * font as `alt` — what renderers and exporters quantize with (DECISIONS 030).
 */
export function measureRampSet(chars: string, font: FontSpec): Ramp {
  // Cached like measureRamp: callers compare ramps by identity.
  const key = `set|${chars}|${fontKey(font)}`;
  const cached = rampCache.get(key);
  if (cached) return cached;
  const main = measureRamp(chars, font);
  const set = { ...main, alt: RAMP_NAMES.map((name) => measureRamp(BUILTIN_RAMP_CHARS[name], font)) };
  rampCache.set(key, set);
  return set;
}

/** Polarity maps image brightness to glyph ink and back; it is an involution. */
export function lumToDensity(lum: number, polarity: Polarity): number {
  return polarity === 'light-on-dark' ? lum : 1 - lum;
}

export function densityToLum(density: number, polarity: Polarity): number {
  return polarity === 'light-on-dark' ? density : 1 - density;
}

function nearestByDensity(density: Float32Array, ink: number): number {
  let lo = 0;
  let hi = density.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (density[mid]! < ink) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first index at or above ink; the neighbour below may be closer.
  if (lo > 0 && ink - density[lo - 1]! < density[lo]! - ink) return lo - 1;
  return lo;
}

/** Returns a charCode, or 0 for transparent cells (nothing to draw). */
export function quantize(
  lum: number,
  alpha: number,
  ramp: Ramp,
  polarity: Polarity,
  mode: QuantizeMode = 'nearest-density',
): number {
  if (alpha < 0.5 / 255) return 0;

  const raw = lumToDensity(lum, polarity);
  const ink = raw < 0 ? 0 : raw > 1 ? 1 : raw;

  const n = ramp.density.length;
  const i = mode === 'uniform' ? Math.round(ink * (n - 1)) : nearestByDensity(ramp.density, ink);

  return ramp.chars.charCodeAt(i);
}

/** Reverse lookup for text import: glyph -> normalized ramp density. */
export function densityOfChar(ramp: Ramp, char: string): number | undefined {
  const i = ramp.chars.indexOf(char);
  return i < 0 ? undefined : ramp.density[i];
}
