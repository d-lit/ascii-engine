import type { Field } from './field.ts';

export interface Pointer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  inside: boolean;
  down: boolean;
  clicked: boolean;
}

export interface FrameContext {
  time: number;
  dt: number;
  frame: number;
  cols: number;
  rows: number;
  cellAspect: number;
  pointer: Pointer;
  rand: () => number;
  source: Readonly<Field>;
}
