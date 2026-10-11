import { smoothstep } from '../../core/math.ts';
import { createNoise } from '../../core/noise.ts';
import { defineEffect } from '../types.ts';

const NOISE_SEED = 0xe205;

/**
 * Noise threshold: a cell fades out where animated fbm noise falls below
 * `threshold`. 0 keeps everything, 1 erodes everything; `softness` widens the
 * fading edge. Noise space is isotropic (cell widths).
 */
export const erosion = defineEffect({
  id: 'erosion',
  name: 'Erosion',
  kind: 'cell',
  params: {
    threshold: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.45, random: [0.2, 0.6] },
    softness: { type: 'number', min: 0, max: 0.5, step: 0.01, default: 0.08, random: [0.03, 0.2] },
    scale: { type: 'number', min: 2, max: 100, step: 1, default: 14, label: 'scale, cells', random: [6, 40] },
    speed: { type: 'number', min: 0, max: 2, step: 0.01, default: 0.2, random: [0.05, 0.6] },
    octaves: { type: 'number', min: 1, max: 5, step: 1, default: 2 },
    mode: { type: 'select', options: ['hide', 'darken'], default: 'hide' },
  },
  create(p) {
    const noise = createNoise(NOISE_SEED);

    return {
      kind: 'cell',
      apply(cell, x, y, ctx) {
        const inv = 1 / p.scale;
        // io form: no doubles cross a call that V8 may not inline (DECISIONS 013).
        const io = noise.io;
        io[0] = x * inv;
        io[1] = (y / ctx.cellAspect) * inv;
        io[2] = ctx.time * p.speed;
        noise.fbm3io(p.octaves | 0);
        const n = 0.5 + 0.5 * io[3]!;
        const keep = smoothstep(p.threshold - p.softness, p.threshold, n);
        if (p.mode === 'hide') cell.alpha *= keep;
        else cell.lum *= keep;
      },
    };
  },
});
