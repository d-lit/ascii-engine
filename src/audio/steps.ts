import type { AudioBand, BandTable } from './bands.ts';

/** Below `threshold - HYSTERESIS` a band must fall before it can step again. */
export const STEP_HYSTERESIS = 0.08;

// Crossing lists per table, by band and threshold (two decimals): built on
// first use, then shared by every param and frame (DECISIONS 028).
const cache = new WeakMap<BandTable, Map<string, Int32Array>>();

/**
 * Table entries where `band` rises through `threshold` (after having been
 * below `threshold - hysteresis`), ascending. One allocation per (table,
 * band, threshold); not per frame.
 */
export function crossings(table: BandTable, band: AudioBand, threshold: number): Int32Array {
  const th = Math.round(Math.min(1, Math.max(0, threshold)) * 100) / 100;
  let byKey = cache.get(table);
  if (byKey === undefined) {
    byKey = new Map();
    cache.set(table, byKey);
  }
  const key = `${band}:${th}`;
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  const v = table.bands[band];
  const out: number[] = [];
  let armed = true;
  for (let i = 0; i < table.length; i++) {
    const x = v[i]!;
    if (armed && x >= th) {
      out.push(i);
      armed = false;
    } else if (!armed && x < th - STEP_HYSTERESIS) armed = true;
  }
  const list = Int32Array.from(out);
  byKey.set(key, list);
  return list;
}

/** Number of crossings at or before table position `pos` (seconds): the step index. */
export function stepAt(list: Int32Array, hop: number, pos: number): number {
  const i = Math.floor(pos / hop);
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]! <= i) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
