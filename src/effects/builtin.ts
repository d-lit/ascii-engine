import { decode } from './cell/decode.ts';
import { erosion } from './cell/erosion.ts';
import { pulse } from './cell/pulse.ts';
import { wave } from './cell/wave.ts';
import { getEffect, registerEffect } from './registry.ts';

/** Registers every built-in effect once; safe to call repeatedly. */
export function registerBuiltinEffects(): void {
  for (const def of [wave, pulse, erosion, decode]) {
    if (getEffect(def.id) === undefined) registerEffect(def);
  }
}
