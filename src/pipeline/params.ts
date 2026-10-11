import type { Vec2 } from '../core/math.ts';

export type PointValue = Vec2 | 'pointer' | 'center';

export interface NumberSpec {
  type: 'number';
  min: number;
  max: number;
  step?: number;
  default: number;
  label?: string;
}

export type ParamSpec =
  | NumberSpec
  | { type: 'boolean'; default: boolean; label?: string }
  | { type: 'select'; options: readonly string[]; default: string; label?: string }
  | { type: 'color'; default: string; label?: string }
  | { type: 'point'; default: PointValue; label?: string };

export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'noise';

export type ParamValue =
  | number
  | { lfo: LfoShape; freq: number; min: number; max: number; phase?: number }
  | { env: Array<[t: number, v: number]>; loop?: boolean; ease?: 'linear' | 'smooth' };

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
export interface ParamFrame {
  time: number;
  cols: number;
  rows: number;
  pointer: Vec2;
}

/**
 * Number value at `time`, clamped to the spec. LFO and envelopes arrive in
 * phase 4; until then a modulated value resolves to the default.
 */
export function resolveNumber(spec: NumberSpec, value: ParamInput | undefined): number {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : spec.default;
  return v < spec.min ? spec.min : v > spec.max ? spec.max : v;
}

/** Writes a point in cell coordinates into `out`; normalized 0..1 spans cell centres. */
export function resolvePoint(value: PointValue, frame: ParamFrame, out: Vec2): void {
  if (value === 'pointer') {
    out.x = frame.pointer.x;
    out.y = frame.pointer.y;
  } else if (value === 'center') {
    out.x = (frame.cols - 1) / 2;
    out.y = (frame.rows - 1) / 2;
  } else {
    out.x = value.x * (frame.cols - 1);
    out.y = value.y * (frame.rows - 1);
  }
}

function isPointValue(v: ParamInput | undefined): v is PointValue {
  if (v === 'pointer' || v === 'center') return true;
  return typeof v === 'object' && 'x' in v && 'y' in v;
}

/** Fresh bag with defaults; point params get their own reusable Vec2. */
export function createParamBag(schema: ParamSchema): ParamBag {
  const bag: ParamBag = {};
  for (const key of Object.keys(schema)) {
    const spec = schema[key]!;
    bag[key] = spec.type === 'point' ? { x: 0, y: 0 } : spec.default;
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
): void {
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k]!;
    const spec = schema[key]!;
    const value = values[key];
    switch (spec.type) {
      case 'number':
        bag[key] = resolveNumber(spec, value);
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
        resolvePoint(isPointValue(value) ? value : spec.default, frame, bag[key] as Vec2);
        break;
    }
  }
}
