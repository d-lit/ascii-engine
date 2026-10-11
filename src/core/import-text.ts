import { createField, type Field, type FieldMeta } from './field.ts';
import { sobel } from './import-image.ts';
import { densityOfChar, densityToLum, type Ramp } from './ramp.ts';

export interface TextImportOptions {
  tabWidth?: number;
  /** Measures density of glyphs outside the ramp; omitted in non-DOM contexts. */
  measureChar?: (char: string) => number;
}

export interface TextImportResult {
  field: Field;
  warnings: string[];
}

const DEFAULT_TAB_WIDTH = 4;

/** Normalizes line endings and tabs, then pads every row to the widest one. */
export function normalizeText(text: string, tabWidth = DEFAULT_TAB_WIDTH): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const expanded = lines.map((line) => line.replace(/\t/g, ' '.repeat(tabWidth)));

  let width = 0;
  for (const line of expanded) {
    const len = Array.from(line).length;
    if (len > width) width = len;
  }

  return expanded.map((line) => {
    const len = Array.from(line).length;
    return len < width ? line + ' '.repeat(width - len) : line;
  });
}

function isUnsupported(char: string): boolean {
  if (char.length !== 1) return true; // surrogate pair: not representable in Uint16Array
  const code = char.charCodeAt(0);
  if (code >= 0x0300 && code <= 0x036f) return true; // combining marks
  if (code >= 0x1100 && code <= 0x115f) return true; // hangul jamo
  if (code >= 0x2e80 && code <= 0xa4cf) return true; // CJK
  if (code >= 0xac00 && code <= 0xd7a3) return true; // hangul syllables
  if (code >= 0xf900 && code <= 0xfaff) return true; // CJK compatibility
  if (code >= 0xfe30 && code <= 0xfe6f) return true; // CJK forms
  if (code >= 0xff00 && code <= 0xff60) return true; // fullwidth forms
  return false;
}

/**
 * Text is the one import where polarity matters: the same glyph reads bright on
 * a dark theme and dark on a light one (DECISIONS 004).
 */
export function importText(
  text: string,
  ramp: Ramp,
  meta: FieldMeta,
  opts: TextImportOptions = {},
): TextImportResult {
  const lines = normalizeText(text, opts.tabWidth ?? DEFAULT_TAB_WIDTH);
  const warnings: string[] = [];

  const rows = Math.max(1, lines.length);
  const cols = Math.max(1, Array.from(lines[0] ?? '').length);
  const field = createField(cols, rows, { char: true, grad: true });
  const char = field.char;
  const { gradX, gradY } = field;
  if (char === null || gradX === null || gradY === null) {
    throw new Error('importText: required buffers were not allocated');
  }

  const unsupported = new Set<string>();
  const unmeasured = new Set<string>();
  const measured = new Map<string, number>();
  const bgLum = densityToLum(0, meta.polarity);

  for (let y = 0; y < rows; y++) {
    const glyphs = Array.from(lines[y] ?? '');
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let glyph = glyphs[x] ?? ' ';

      if (isUnsupported(glyph)) {
        unsupported.add(glyph);
        glyph = ' ';
      }

      if (glyph === ' ') {
        field.lum[i] = bgLum;
        field.alpha[i] = 0;
        char[i] = glyph.charCodeAt(0);
        continue;
      }

      let density = densityOfChar(ramp, glyph);
      if (density === undefined) {
        const hit = measured.get(glyph);
        if (hit !== undefined) {
          density = hit;
        } else if (opts.measureChar) {
          density = opts.measureChar(glyph);
          measured.set(glyph, density);
        } else {
          unmeasured.add(glyph);
          density = 1;
        }
      }

      field.lum[i] = densityToLum(density, meta.polarity);
      field.alpha[i] = 1;
      char[i] = glyph.charCodeAt(0);
    }
  }

  if (unsupported.size > 0) {
    warnings.push(`replaced with space (wide or combining): ${[...unsupported].join(' ')}`);
  }
  if (unmeasured.size > 0) {
    warnings.push(`not in ramp and unmeasured, treated as solid: ${[...unmeasured].join(' ')}`);
  }

  sobel(field.lum, cols, rows, gradX, gradY);
  for (const warning of warnings) console.warn(`[ascii-engine] ${warning}`);

  return { field, warnings };
}
