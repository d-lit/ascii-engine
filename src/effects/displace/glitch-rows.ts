import { HASH_UNIT, hashInt3 } from '../../core/prng.ts';
import { defineEffect } from '../types.ts';

const SEED_PICK = 0x611c4;
const SEED_SHIFT = 0x5417f;

/**
 * Digital glitch: the picture is cut into horizontal bands of `band` rows;
 * `rate` times a second a random subset (`amount`) is shifted sideways by a
 * whole number of cells, up to `maxShift`.
 */
export const glitchRows = defineEffect({
  id: 'glitch-rows',
  name: 'Glitch rows',
  kind: 'displace',
  params: {
    rate: { type: 'number', min: 0.5, max: 30, step: 0.5, default: 6, label: 'rate, 1/s', random: [2, 12] },
    amount: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.15, random: [0.05, 0.3] },
    band: { type: 'number', min: 1, max: 20, step: 1, default: 3, label: 'band, rows' },
    maxShift: { type: 'number', min: 0, max: 60, step: 1, default: 12, label: 'max shift, cells', random: [4, 25] },
  },
  create(p) {
    return {
      kind: 'displace',
      apply(_x, y, ctx, out) {
        // Hashes take integers only (DECISIONS 013).
        const tick = Math.floor(ctx.time * p.rate) | 0;
        const band = Math.floor(y / p.band) | 0;
        if (hashInt3(band, 0, tick, SEED_PICK) * HASH_UNIT >= p.amount) return;
        const r = hashInt3(band, 1, tick, SEED_SHIFT) * HASH_UNIT * 2 - 1;
        out.x += Math.round(r * p.maxShift);
      },
    };
  },
});
