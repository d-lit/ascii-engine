import { createField, type Field, type FieldMeta } from '../../src/core/field.ts';

export const meta: FieldMeta = { cellAspect: 0.5, polarity: 'light-on-dark' };

/** Opaque field with constant brightness. */
export function flatField(cols: number, rows: number, lum = 0.5): Field {
  const f = createField(cols, rows);
  f.lum.fill(lum);
  f.alpha.fill(1);
  return f;
}

import type { Vec2 } from '../../src/core/math.ts';
import type { Pipeline } from '../../src/pipeline/pipeline.ts';

/**
 * Where the first displace effect of `p` sends cell (x, y), using the params
 * resolved by the last `p.frame()`.
 */
export function displaced(p: Pipeline, x: number, y: number, entry = 0): Vec2 {
  const inst = p.chain[entry]!.instance;
  if (inst.kind !== 'displace') throw new Error('not a displace effect');
  const out = { x, y };
  inst.apply(x, y, p.ctx, out);
  return out;
}
