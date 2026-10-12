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
 * Sprites (SPEC 6.3) land in the nearest cell over the grid, later ones on
 * top; cells they left are empty. Not a hot path: allocations are fine.
 */
export function exportText(
  work: WorkBuffer,
  ramp: Ramp,
  polarity: Polarity,
  opts: TextExportOptions,
): string {
  const { cols, rows } = work;
  const grid = new Uint16Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const code = work.hidden[i] === 1 ? 0 : resolveCellChar(work, i, ramp, polarity, opts.useSourceChars, opts.quantizeMode);
    grid[i] = code === 0 ? SPACE : code;
  }
  const sp = work.sprites;
  for (let s = 0; s < sp.count; s++) {
    const x = Math.round(sp.x[s]!);
    const y = Math.round(sp.y[s]!);
    if (x < 0 || y < 0 || x >= cols || y >= rows || sp.alpha[s]! <= 0) continue;
    const code = resolveCellChar(work, sp.src[s]!, ramp, polarity, opts.useSourceChars, opts.quantizeMode);
    if (code !== 0) grid[y * cols + x] = code;
  }

  let out = '';
  for (let y = 0; y < rows; y++) {
    const row = grid.subarray(y * cols, (y + 1) * cols);
    let end = cols;
    if (opts.trimRight) while (end > 0 && row[end - 1] === SPACE) end--;
    out += String.fromCharCode(...row.subarray(0, end)) + '\n';
  }
  return out;
}
