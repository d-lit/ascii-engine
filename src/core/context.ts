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
  /** Beat of the track in this frame (SPEC 7.2): its strength 0..1, 0 = none. One-frame pulse. */
  beat: number;
  rand: () => number;
  source: Readonly<Field>;
}
