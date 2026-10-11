import type { FrameContext } from '../core/context.ts';
import type { WorkBuffer } from '../core/field.ts';
import type { Vec2 } from '../core/math.ts';
import type { ParamSchema, ResolvedParams } from '../pipeline/params.ts';

export type EffectKind = 'displace' | 'cell' | 'system';

export type DisplaceFn = (x: number, y: number, ctx: FrameContext, out: Vec2) => void;

export interface CellRef {
  lum: number;
  alpha: number;
  r: number;
  g: number;
  b: number;
  char: number;
}

export type CellFn = (cell: CellRef, x: number, y: number, ctx: FrameContext) => void;

export interface SystemInstance {
  init(ctx: FrameContext, work: WorkBuffer): void;
  update(ctx: FrameContext): void;
  render(work: WorkBuffer, ctx: FrameContext): void;
  reset?(): void;
  dispose?(): void;
}

export type EffectInstance =
  | { kind: 'displace'; apply: DisplaceFn }
  | { kind: 'cell'; apply: CellFn }
  | { kind: 'system'; system: SystemInstance };

export interface EffectDef<P extends ParamSchema> {
  id: string;
  name: string;
  kind: EffectKind;
  params: P;
  create(params: ResolvedParams<P>): EffectInstance;
}
