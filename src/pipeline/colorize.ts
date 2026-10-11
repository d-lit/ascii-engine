import { parseHex, type Rgb } from '../core/color.ts';
import type { Field, WorkBuffer } from '../core/field.ts';

export type ColorMode = 'mono' | 'source' | 'gradient';
export const COLOR_MODES: readonly ColorMode[] = ['mono', 'source', 'gradient'];

/** Gradient stop: `pos` 0..1 along image brightness (`lum`), colour as hex. */
export interface GradientStop {
  pos: number;
  color: string;
}

/**
 * How the base ink colour of each cell is chosen (DECISIONS 015):
 * - `mono`: the theme ink;
 * - `source`: the picture's own colours (theme ink for colourless sources);
 * - `gradient`: `lum` after cell effects mapped through `stops`.
 */
export interface ColorSettings {
  mode: ColorMode;
  stops: GradientStop[];
}

export const DEFAULT_STOPS: readonly GradientStop[] = [
  { pos: 0, color: '#1b1a4a' },
  { pos: 0.5, color: '#d0386b' },
  { pos: 1, color: '#ffd27a' },
];

const LUT_SIZE = 256;

/**
 * 256-entry RGB lookup over lum 0..1. Stops are sorted by position; the
 * ends hold their colours. No stops = black; one stop = flat colour.
 */
export function buildGradientLut(
  stops: readonly GradientStop[],
  out: Uint8Array<ArrayBuffer> = new Uint8Array(LUT_SIZE * 3),
): Uint8Array<ArrayBuffer> {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const rgb: Rgb[] = sorted.map((s) => parseHex(s.color));

  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    let c: Rgb = [0, 0, 0];
    if (sorted.length === 1 || (sorted.length > 1 && t <= sorted[0]!.pos)) c = rgb[0]!;
    else if (sorted.length > 1 && t >= sorted[sorted.length - 1]!.pos) c = rgb[rgb.length - 1]!;
    else {
      for (let k = 1; k < sorted.length; k++) {
        const b = sorted[k]!;
        if (t > b.pos) continue;
        const a = sorted[k - 1]!;
        const span = b.pos - a.pos;
        const f = span > 0 ? (t - a.pos) / span : 1;
        const ca = rgb[k - 1]!;
        const cb = rgb[k]!;
        c = [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
        break;
      }
    }
    out[i * 3] = Math.round(c[0]);
    out[i * 3 + 1] = Math.round(c[1]);
    out[i * 3 + 2] = Math.round(c[2]);
  }
  return out;
}

/**
 * Writes the base colour into `work.color` (which must exist). `source` mode
 * expects the stage before to have copied or sampled the source colours.
 */
export function colorize(
  work: WorkBuffer,
  source: Readonly<Field>,
  mode: ColorMode,
  ink: Rgb,
  lut: Uint8Array,
): void {
  const color = work.color;
  if (color === null) return;
  const n = work.cols * work.rows;

  if (mode === 'source' && source.color !== null) return;

  if (mode === 'gradient') {
    const lum = work.lum;
    for (let i = 0; i < n; i++) {
      const l = lum[i]!;
      const k = (Math.min(Math.max(l, 0), 1) * 255 + 0.5) | 0;
      color[i * 3] = lut[k * 3]!;
      color[i * 3 + 1] = lut[k * 3 + 1]!;
      color[i * 3 + 2] = lut[k * 3 + 2]!;
    }
    return;
  }

  // mono, or source without colours: theme ink.
  const [r, g, b] = ink;
  for (let i = 0; i < n; i++) {
    color[i * 3] = r;
    color[i * 3 + 1] = g;
    color[i * 3 + 2] = b;
  }
}

/** Ready-made gradients for the editor; any can be edited afterwards. */
export const GRADIENT_PALETTES: Readonly<Record<string, readonly GradientStop[]>> = {
  dusk: DEFAULT_STOPS,
  fire: [
    { pos: 0, color: '#120400' },
    { pos: 0.35, color: '#8a1c06' },
    { pos: 0.7, color: '#f07f13' },
    { pos: 1, color: '#fff3b0' },
  ],
  ocean: [
    { pos: 0, color: '#020b1f' },
    { pos: 0.5, color: '#0b6e99' },
    { pos: 1, color: '#b8f3ff' },
  ],
  phosphor: [
    { pos: 0, color: '#001a07' },
    { pos: 1, color: '#5cff8a' },
  ],
  amber: [
    { pos: 0, color: '#1a0d00' },
    { pos: 1, color: '#ffb000' },
  ],
  neon: [
    { pos: 0, color: '#14002e' },
    { pos: 0.33, color: '#7a00ff' },
    { pos: 0.66, color: '#ff2fb3' },
    { pos: 1, color: '#2ff7ff' },
  ],
};
