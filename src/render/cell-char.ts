import type { Polarity, WorkBuffer } from '../core/field.ts';
import { quantize, type QuantizeMode, type Ramp } from '../core/ramp.ts';

// Below this alpha a cell is empty; same cut as `quantize`.
export const ALPHA_EPS = 0.5 / 255;

/**
 * The glyph a cell shows: `charOverride -> char -> quantize(lum)` (SPEC 9.1,
 * DECISIONS 007). Returns 0 for an empty cell. Shared by every output so the
 * renderer and exporters always agree.
 */
export function resolveCellChar(
  work: WorkBuffer,
  i: number,
  ramp: Ramp,
  polarity: Polarity,
  useSourceChars: boolean,
  mode: QuantizeMode,
): number {
  const a = work.alpha[i]!; // caller guarantees i < cols*rows
  if (a < ALPHA_EPS) return 0;
  let code = work.charOverride[i]!;
  if (code === 0 && useSourceChars) code = work.char[i]!;
  if (code === 0) code = quantize(work.lum[i]!, a, ramp, polarity, mode);
  return code;
}
