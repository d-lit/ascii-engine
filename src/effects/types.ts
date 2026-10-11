import type { FrameContext } from '../core/context.ts';
import type { WorkBuffer } from '../core/field.ts';
import type { Vec2 } from '../core/math.ts';
import type { ParamBag, ParamSchema, ResolvedParams } from '../pipeline/params.ts';

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
  /**
   * Cell effects that write r, g, b set this: they run in the post stage,
   * after the base colour is chosen, so the colour mode does not overwrite
   * them (DECISIONS 016). Their lum changes no longer affect the colour.
   */
  writesColor?: boolean;
  create(params: ResolvedParams<P>): EffectInstance;
}

/** Type-erased descriptor stored in the registry and the chain. */
export interface AnyEffectDef {
  readonly id: string;
  readonly name: string;
  readonly kind: EffectKind;
  readonly params: ParamSchema;
  readonly writesColor: boolean;
  /** `params` is a live bag the engine re-resolves every frame. */
  create(params: ParamBag): EffectInstance;
}

/**
 * Typed authoring, erased storage. `const P` keeps select options as literal
 * unions without `as const` at the call site.
 */
export function defineEffect<const P extends ParamSchema>(def: EffectDef<P>): AnyEffectDef {
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    params: def.params,
    writesColor: def.writesColor === true,
    // The engine builds the bag from this very schema (createParamBag), so the
    // shape matches ResolvedParams<P>; TS cannot see that through the erasure.
    create: (params) => def.create(params as ResolvedParams<P>),
  };
}
