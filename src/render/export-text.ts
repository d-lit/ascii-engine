import type { Polarity, WorkBuffer } from '../core/field.ts';
import type { QuantizeMode, Ramp } from '../core/ramp.ts';
import { resolveCellChar } from './cell-char.ts';

export interface TextExportOptions {
  useSourceChars: boolean;
  quantizeMode: QuantizeMode;
  trimRight: boolean;
}

const SPACE = 0x20;

/**
 * Current frame as plain text: the same glyphs the renderer draws
 * (resolveCellChar), empty cells as spaces, one '\n' after every row.
 * Not a hot path: called on demand, allocations are fine.
 */
export function exportText(
  work: WorkBuffer,
  ramp: Ramp,
  polarity: Polarity,
  opts: TextExportOptions,
): string {
  const { cols, rows } = work;
  const codes = new Uint16Array(cols);
  let out = '';

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const code = resolveCellChar(work, i, ramp, polarity, opts.useSourceChars, opts.quantizeMode);
      codes[x] = code === 0 ? SPACE : code;
    }
    let end = cols;
    if (opts.trimRight) while (end > 0 && codes[end - 1] === SPACE) end--;
    out += String.fromCharCode(...codes.subarray(0, end)) + '\n';
  }
  return out;
}
