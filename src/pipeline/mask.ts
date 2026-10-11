import type { Field } from '../core/field.ts';
import type { Vec2 } from '../core/math.ts';
import { smoothstep } from '../core/math.ts';
import {
  resolveNumber,
  resolvePoint,
  type NumberSpec,
  type ParamFrame,
  type ParamValue,
  type PointValue,
} from './params.ts';

/**
 * Where an effect applies, 0..1 per cell (SPEC 6.4).
 * - `alpha`, `lum`: by the source at the cell (not by earlier effects' output),
 *   `min/max/soft` in lum units;
 * - `radial`: `radius` and `soft` in cell widths (isotropic), `radius` may be modulated;
 * - `rect`: `x, y, w, h` normalized to the grid like point params, `soft` in cell widths, fading inward.
 */
export type MaskSpec =
  | { type: 'alpha'; invert?: boolean }
  | { type: 'lum'; min: number; max: number; soft?: number; invert?: boolean }
  | { type: 'radial'; center: PointValue; radius: ParamValue; soft?: number; invert?: boolean }
  | { type: 'rect'; x: number; y: number; w: number; h: number; soft?: number; invert?: boolean };

export const MASK_TYPES = ['alpha', 'lum', 'radial', 'rect'] as const;

const RADIUS_SPEC: NumberSpec = { type: 'number', min: 0, max: 10000, default: 10 };

/** Reusable per-entry scratch, so filling a mask allocates nothing. */
export interface MaskScratch {
  readonly center: Vec2;
}

export function createMaskScratch(): MaskScratch {
  return { center: { x: 0, y: 0 } };
}

/**
 * Fills `out` (cols*rows) with the mask for this frame. Called once per frame
 * per masked effect; the stage loops only read `out[i]` (DECISIONS 013).
 * `t` is the effect's modulation clock.
 */
export function fillMask(
  spec: MaskSpec,
  source: Readonly<Field>,
  frame: ParamFrame & { cellAspect: number },
  t: number,
  scratch: MaskScratch,
  out: Float32Array,
): void {
  const { cols, rows } = source;
  const soft = Math.max(0, spec.type === 'alpha' ? 0 : (spec.soft ?? 0));

  switch (spec.type) {
    case 'alpha': {
      out.set(source.alpha);
      break;
    }
    case 'lum': {
      const lum = source.lum;
      for (let i = 0; i < out.length; i++) {
        const v = lum[i]!;
        out[i] = soft > 0
          ? smoothstep(spec.min - soft, spec.min, v) * (1 - smoothstep(spec.max, spec.max + soft, v))
          : v >= spec.min && v <= spec.max ? 1 : 0;
      }
      break;
    }
    case 'radial': {
      resolvePoint(spec.center, frame, scratch.center);
      const cx = scratch.center.x;
      const cy = scratch.center.y;
      const radius = resolveNumber(RADIUS_SPEC, spec.radius, t);
      const inv = 1 / frame.cellAspect;
      for (let y = 0, i = 0; y < rows; y++) {
        const dy = (y - cy) * inv;
        for (let x = 0; x < cols; x++, i++) {
          const dx = x - cx;
          const d = Math.sqrt(dx * dx + dy * dy);
          out[i] = soft > 0 ? 1 - smoothstep(radius - soft, radius, d) : d <= radius ? 1 : 0;
        }
      }
      break;
    }
    case 'rect': {
      const x0 = spec.x * (cols - 1);
      const x1 = (spec.x + spec.w) * (cols - 1);
      const y0 = spec.y * (rows - 1);
      const y1 = (spec.y + spec.h) * (rows - 1);
      const inv = 1 / frame.cellAspect;
      for (let y = 0, i = 0; y < rows; y++) {
        const inY = Math.min(y - y0, y1 - y) * inv;
        for (let x = 0; x < cols; x++, i++) {
          // Signed distance to the nearest edge, inside positive, in cell widths.
          const inside = Math.min(x - x0, x1 - x, inY);
          out[i] = soft > 0 ? smoothstep(0, soft, inside) : inside >= 0 ? 1 : 0;
        }
      }
      break;
    }
  }

  if (spec.invert === true) for (let i = 0; i < out.length; i++) out[i] = 1 - out[i]!;
}
