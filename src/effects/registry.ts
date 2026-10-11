import type { ParamSchema } from '../pipeline/params.ts';
import type { EffectDef } from './types.ts';

export type AnyEffectDef = EffectDef<ParamSchema>;

const defs = new Map<string, AnyEffectDef>();

export function registerEffect(def: AnyEffectDef): void {
  if (defs.has(def.id)) throw new Error(`effect already registered: ${def.id}`);
  defs.set(def.id, def);
}

export function getEffect(id: string): AnyEffectDef | undefined {
  return defs.get(id);
}

export function listEffects(): readonly AnyEffectDef[] {
  return [...defs.values()];
}
