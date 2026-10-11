import type { ParamValue, PointValue } from './params.ts';

export type MaskSpec =
  | { type: 'alpha'; invert?: boolean }
  | { type: 'lum'; min: number; max: number; soft?: number; invert?: boolean }
  | { type: 'radial'; center: PointValue; radius: ParamValue; soft?: number; invert?: boolean }
  | { type: 'rect'; x: number; y: number; w: number; h: number; soft?: number; invert?: boolean };
