import { createNoise } from '../../core/noise.ts';
import { HASH_UNIT, hashInt2 } from '../../core/prng.ts';
import { defineEffect } from '../types.ts';

const NOISE_SEED = 0x5ac3;
const SEED_JITTER = 0x7177;

/**
 * Whole-picture shake: one offset per frame, shared by every cell. `smooth`
 * follows noise (camera shake), `jitter` jumps to a new random offset at
 * `frequency` steps per second. Amplitude in cell widths.
 */
export const shake = defineEffect({
  id: 'shake',
  name: 'Shake',
  kind: 'displace',
  params: {
    mode: { type: 'select', options: ['smooth', 'jitter'], default: 'smooth' },
    amplitude: { type: 'number', min: 0, max: 5, step: 0.05, default: 0.6, label: 'amplitude, cells', random: [0.1, 1.2] },
    frequency: { type: 'number', min: 0.5, max: 60, step: 0.5, default: 8, label: 'frequency, Hz', random: [3, 20] },
  },
  create(p) {
    const noise = createNoise(NOISE_SEED);
    let lastFrame = -1;
    // Per-frame offset; a typed array, since doubles stored in closure
    // variables are boxed on every write.
    const offset = new Float64Array(2);

    return {
      kind: 'displace',
      apply(_x, _y, ctx, out) {
        if (ctx.frame !== lastFrame) {
          lastFrame = ctx.frame;
          const u = ctx.time * p.frequency;
          let ox: number;
          let oy: number;
          if (p.mode === 'smooth') {
            ox = noise.noise2(u, 0.5);
            oy = noise.noise2(u, 40.5);
          } else {
            const tick = Math.floor(u) | 0;
            ox = hashInt2(tick, 0, SEED_JITTER) * HASH_UNIT * 2 - 1;
            oy = hashInt2(tick, 1, SEED_JITTER) * HASH_UNIT * 2 - 1;
          }
          offset[0] = ox * p.amplitude;
          offset[1] = oy * p.amplitude * ctx.cellAspect;
        }
        out.x += offset[0]!;
        out.y += offset[1]!;
      },
    };
  },
});
