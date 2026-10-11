import { createField, type Field, type FieldMeta } from './field.ts';
import { sobel } from './import-image.ts';
import {
  densityOfChar,
  densityToLum,
  normalizeDensity,
  type DensityMeasurer,
  type Ramp,
} from './ramp.ts';

export interface TextImportOptions {
  tabWidth?: number;
}

export interface TextImportResult {
  field: Field;
  warnings: string[];
}

const DEFAULT_TAB_WIDTH = 4;
const SPACE = ' ';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(line: string): string[] {
  const out: string[] = [];
  for (const { segment } of segmenter.segment(line)) out.push(segment);
  return out;
}

/**
 * Normalizes line endings and tabs, splits rows into grapheme clusters and pads
 * every row to the widest one. One cluster = one cell.
 */
export function normalizeText(text: string, tabWidth = DEFAULT_TAB_WIDTH): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const rows = lines.map((line) => graphemes(line.replace(/\t/g, SPACE.repeat(tabWidth))));

  let width = 0;
  for (const row of rows) if (row.length > width) width = row.length;
  for (const row of rows) while (row.length < width) row.push(SPACE);

  return rows;
}

// Inclusive code ranges that cannot occupy one grid cell (DECISIONS 009):
// wide/fullwidth glyphs, plus combining and zero-width marks left without a base.
const UNSUPPORTED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f], // combining diacritics
  [0x1100, 0x115f], // hangul jamo
  [0x1ab0, 0x1aff], // combining diacritics extended
  [0x1dc0, 0x1dff], // combining diacritics supplement
  [0x200b, 0x200f], // zero-width and direction marks
  [0x20d0, 0x20ff], // combining marks for symbols
  [0x2e80, 0xa4cf], // CJK and related
  [0xac00, 0xd7a3], // hangul syllables
  [0xf900, 0xfaff], // CJK compatibility
  [0xfe00, 0xfe0f], // variation selectors
  [0xfe20, 0xfe2f], // combining half marks
  [0xfe30, 0xfe6f], // CJK forms
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
];

/** A cluster longer than one code unit never fits Uint16Array `char`. */
export function isUnsupported(cluster: string): boolean {
  if (cluster.length !== 1) return true;
  const code = cluster.charCodeAt(0);
  for (const [lo, hi] of UNSUPPORTED_RANGES) if (code >= lo && code <= hi) return true;
  return false;
}

/**
 * Text is the one import where polarity matters: the same glyph reads bright on
 * a dark theme and dark on a light one (DECISIONS 004). Glyphs outside the ramp
 * are measured and placed on the ramp's scale (DECISIONS 008, 011).
 */
export function importText(
  text: string,
  ramp: Ramp,
  meta: FieldMeta,
  measure: DensityMeasurer,
  opts: TextImportOptions = {},
): TextImportResult {
  const lines = normalizeText(text, opts.tabWidth ?? DEFAULT_TAB_WIDTH);
  const warnings: string[] = [];

  const rows = Math.max(1, lines.length);
  const cols = Math.max(1, lines[0]?.length ?? 0);
  const field = createField(cols, rows, { char: true, grad: true });
  const char = field.char;
  const { gradX, gradY } = field;
  if (char === null || gradX === null || gradY === null) {
    throw new Error('importText: required buffers were not allocated');
  }

  const unsupported = new Set<string>();
  const outside = new Map<string, number>();
  const bgLum = densityToLum(0, meta.polarity);

  for (let y = 0; y < rows; y++) {
    const glyphs = lines[y] ?? [];
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let glyph = glyphs[x] ?? SPACE;

      if (isUnsupported(glyph)) {
        unsupported.add(glyph);
        glyph = SPACE;
      }

      char[i] = glyph.charCodeAt(0);

      if (glyph === SPACE) {
        field.lum[i] = bgLum;
        field.alpha[i] = 0;
        continue;
      }

      let density = densityOfChar(ramp, glyph);
      if (density === undefined) {
        density = outside.get(glyph);
        if (density === undefined) {
          density = normalizeDensity(ramp, measure(glyph));
          outside.set(glyph, density);
        }
      }

      field.lum[i] = densityToLum(density, meta.polarity);
      field.alpha[i] = 1;
    }
  }

  if (unsupported.size > 0) {
    const list = [...unsupported].map((g) => JSON.stringify(g)).join(' ');
    warnings.push(`replaced with space (wide, combining or multi-unit): ${list}`);
  }

  sobel(field.lum, cols, rows, gradX, gradY);
  for (const warning of warnings) console.warn(`[ascii-engine] ${warning}`);

  return { field, warnings };
}
