import { BLOCK_DENSITY } from '../render/block-glyphs.ts';
import type { Polarity } from './field.ts';

export interface Ramp {
  chars: string;
  density: Float32Array;
}

export type QuantizeMode = 'nearest-density' | 'uniform';

export interface FontSpec {
  family: string;
  weight: number;
  cellW: number;
  cellH: number;
}

export type RampName = 'blocks' | 'classic' | 'long' | 'binary' | 'dots';

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

  return { chars: pairs.map((p) => p.char).join(''), density: out };
}

const rampCache = new Map<string, Ramp>();

function fontKey(chars: string, font: FontSpec): string {
  return `${chars}|${font.family}|${font.weight}|${font.cellW}x${font.cellH}`;
}

/**
 * Measures ink coverage per glyph on a canvas, then delegates to makeRamp.
 * Needs DOM; block glyphs use analytic densities instead of measurement.
 */
export function measureRamp(chars: string, font: FontSpec): Ramp {
  const key = fontKey(chars, font);
  const cached = rampCache.get(key);
  if (cached) return cached;

  const points = Array.from(chars);
  const w = Math.max(1, Math.round(font.cellW));
  const h = Math.max(1, Math.round(font.cellH));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('measureRamp: no 2d context');

  ctx.font = `${font.weight} ${h}px ${font.family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';

  const measured = new Float32Array(points.length);
  const total = w * h * 255;
  for (let i = 0; i < points.length; i++) {
    const char = points[i]!;
    const analytic = char.length === 1 ? BLOCK_DENSITY.get(char.charCodeAt(0)) : undefined;
    if (analytic !== undefined) {
      measured[i] = analytic;
      continue;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.fillText(char, w / 2, h / 2);
    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let p = 3; p < data.length; p += 4) sum += data[p]!;
    measured[i] = sum / total;
  }

  const ramp = makeRamp(chars, measured);
  rampCache.set(key, ramp);
  return ramp;
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
