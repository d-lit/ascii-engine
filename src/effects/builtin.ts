import { bands } from './cell/bands.ts';
import { decode } from './cell/decode.ts';
import { field } from './cell/field.ts';
import { rings } from './cell/rings.ts';
import { erosion } from './cell/erosion.ts';
import { glow } from './cell/glow.ts';
import { hueCycle } from './cell/hue-cycle.ts';
import { pulse } from './cell/pulse.ts';
import { tint } from './cell/tint.ts';
import { wave } from './cell/wave.ts';
import { glitchRows } from './displace/glitch-rows.ts';
import { lens } from './displace/lens.ts';
import { liquid } from './displace/liquid.ts';
import { ripple } from './displace/ripple.ts';
import { shake } from './displace/shake.ts';
import { swirl } from './displace/swirl.ts';
import { particles } from './system/particles.ts';
import { sand } from './system/sand.ts';
import { trails } from './system/trails.ts';
import { getEffect, registerEffect } from './registry.ts';

/** Registers every built-in effect once; safe to call repeatedly. */
export function registerBuiltinEffects(): void {
  for (const def of [ripple, swirl, lens, liquid, glitchRows, shake, wave, pulse, erosion, decode, tint, hueCycle, glow, field, bands, rings, particles, trails, sand]) {
    if (getEffect(def.id) === undefined) registerEffect(def);
  }
}
