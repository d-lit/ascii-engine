import { createField, type Field, type FieldMeta } from '../../src/core/field.ts';

export const meta: FieldMeta = { cellAspect: 0.5, polarity: 'light-on-dark' };

/** Opaque field with constant brightness. */
export function flatField(cols: number, rows: number, lum = 0.5): Field {
  const f = createField(cols, rows);
  f.lum.fill(lum);
  f.alpha.fill(1);
  return f;
}
