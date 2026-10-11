import type { Vec2 } from '../core/math.ts';

export type PointValue = Vec2 | 'pointer' | 'center';

export type ParamSpec =
  | { type: 'number'; min: number; max: number; step?: number; default: number; label?: string }
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
