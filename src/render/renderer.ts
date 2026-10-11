import type { FieldMeta, WorkBuffer } from '../core/field.ts';
import type { Ramp } from '../core/ramp.ts';

export interface Renderer {
  resize(cols: number, rows: number, cellAspect: number): void;
  render(work: WorkBuffer, ramp: Ramp, meta: FieldMeta): void;
  dispose(): void;
}
