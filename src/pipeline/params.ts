import type { Vec2 } from '../core/math.ts';
import { resolveMod } from './modulation.ts';
import {
  createPointState,
  POINT_MAX,
  POINT_MIN,
  resolveMotion,
  type MotionValue,
  type PointFrame,
  type PointState,
} from './points.ts';

/** Static, pointer or moving point (SPEC 7.1). Positions normalized, -0.5..1.5. */
export type PointValue = Vec2 | 'pointer' | 'center' | MotionValue;

export { POINT_MAX, POINT_MIN };

export interface NumberSpec {
  type: 'number';
  min: number;
  max: number;
  step?: number;
  default: number;
  label?: string;
  /** Range the preset randomizer draws from; omitted = around the default. */
  random?: readonly [min: number, max: number];
}

export type ParamSpec =
  | NumberSpec
  | { type: 'boolean'; default: boolean; label?: string }
  | { type: 'select'; options: readonly string[]; default: string; label?: string }
  | { type: 'color'; default: string; label?: string }
  | { type: 'point'; default: PointValue; label?: string };

export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'noise';

/** Periodic modulation; `phase` is a fraction of a period, 0..1. */
export interface LfoValue {
  lfo: LfoShape;
  freq: number;
  min: number;
  max: number;
  phase?: number;
}

/** Breakpoints `[seconds since activation, value]`, sorted by time. */
export interface EnvValue {
  env: Array<[t: number, v: number]>;
  loop?: boolean;
  ease?: 'linear' | 'smooth';
}

/** A modulated number: any object form resolved by a registered ModSource. */
export type ModValue = LfoValue | EnvValue;

export type ParamValue = number | ModValue;

export type ParamSchema = Record<string, ParamSpec>;

type ResolvedParam<S extends ParamSpec> = S extends { type: 'number' }
  ? number
  : S extends { type: 'boolean' }
    ? boolean
    : S extends { type: 'select'; options: readonly (infer O)[] }
      ? O
      : S extends { type: 'color' }
        ? string
        : S extends { type: 'point' }
          ? Vec2
          : never;

/** Schema mapped to plain values. Point params arrive already resolved to cells. */
export type ResolvedParams<P extends ParamSchema> = {
  [K in keyof P]: ResolvedParam<P[K]>;
};

/** What a chain entry stores per param: a value as authored (presets, UI). */
export type ParamInput = ParamValue | boolean | string | PointValue;

/** Erased form of ResolvedParams: what the engine actually builds. */
export type ParamBag = Record<string, number | boolean | string | Vec2>;

/** Grid facts needed to place point params; FrameContext satisfies it. */
export type ParamFrame = PointFrame;

/**
 * Number value `t` seconds after the effect's activation, clamped to the spec.
 * Object values go through the modulation registry; anything it cannot
 * resolve falls back to the default.
 */
export function resolveNumber(spec: NumberSpec, value: ParamInput | undefined, t: number): number {
  let v = spec.default;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) v = value;
  } else if (typeof value === 'object' && value !== null && !('x' in value)) {
    const m = resolveMod(value, t);
    if (m !== undefined && Number.isFinite(m)) v = m;
  }
  return v < spec.min ? spec.min : v > spec.max ? spec.max : v;
}

/**
 * Writes a point in cell coordinates into `out`; normalized 0..1 spans cell
 * centres. Moving points (axes, paths, pointer follow) use the effect clock `t`.
 */
export function resolvePoint(value: PointValue, frame: ParamFrame, t: number, out: PointState): void {
  if (value === 'pointer') {
    out.x = frame.pointer.x;
    out.y = frame.pointer.y;
  } else if (value === 'center') {
    out.x = (frame.cols - 1) / 2;
    out.y = (frame.rows - 1) / 2;
  } else if ('x' in value) {
    out.x = Math.min(Math.max(value.x, POINT_MIN), POINT_MAX) * (frame.cols - 1);
    out.y = Math.min(Math.max(value.y, POINT_MIN), POINT_MAX) * (frame.rows - 1);
  } else {
    resolveMotion(value, frame, t, out);
  }
}

/** The input as a number or modulation value, or null if it is a point or something else. */
export function asParamValue(v: ParamInput | undefined): ParamValue | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'object' || v === null) return null;
  if ('x' in v || 'axes' in v || 'path' in v || 'follow' in v) return null;
  return v;
}

function isPointValue(v: ParamInput | undefined): v is PointValue {
  if (v === 'pointer' || v === 'center') return true;
  if (typeof v !== 'object' || v === null) return false;
  return ('x' in v && 'y' in v) || 'axes' in v || 'path' in v || 'follow' in v;
}

/** Fresh bag with defaults; point params get their own reusable Vec2. */
export function createParamBag(schema: ParamSchema): ParamBag {
  const bag: ParamBag = {};
  for (const key of Object.keys(schema)) {
    const spec = schema[key]!;
    bag[key] = spec.type === 'point' ? createPointState() : spec.default;
  }
  return bag;
}

/**
 * Resolves authored values into `bag` in place. Called every frame, so it
 * must not allocate: point params mutate the Vec2 created by createParamBag.
 * Invalid inputs fall back to defaults (presets are validated in phase 4).
 */
export function resolveParams(
  schema: ParamSchema,
  keys: readonly string[],
  values: Readonly<Record<string, ParamInput>>,
  frame: ParamFrame,
  bag: ParamBag,
  /** Seconds since the effect was activated; modulation clock. */
  t: number,
): void {
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k]!;
    const spec = schema[key]!;
    const value = values[key];
    switch (spec.type) {
      case 'number':
        bag[key] = resolveNumber(spec, value, t);
        break;
      case 'boolean':
        bag[key] = typeof value === 'boolean' ? value : spec.default;
        break;
      case 'select':
        bag[key] = typeof value === 'string' && spec.options.includes(value) ? value : spec.default;
        break;
      case 'color':
        bag[key] = typeof value === 'string' ? value : spec.default;
        break;
      case 'point':
        // createParamBag made a PointState for every point key.
        resolvePoint(isPointValue(value) ? value : spec.default, frame, t, bag[key] as PointState);
        break;
    }
  }
}
