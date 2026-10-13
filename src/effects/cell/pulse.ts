import { defineEffect } from '../types.ts';

const TAU = Math.PI * 2;

/**
 * Brightness or contrast oscillation. `global` pulses the whole picture in
 * phase; `radial` sends rings out from `center`, optionally fading with
 * distance (`radius`, 0 = no fade). `frequency` 0 = no oscillation: a
 * steady push by `amount` — put `amount` on `audio` and the picture pumps
 * with the music (DECISIONS 028).
 */
export const pulse = defineEffect({
  id: 'pulse',
  name: 'Pulse',
  kind: 'cell',
  params: {
    shape: { type: 'select', options: ['global', 'radial'], default: 'radial' },
    target: { type: 'select', options: ['brightness', 'contrast'], default: 'brightness' },
    center: { type: 'point', default: 'pointer' },
    frequency: { type: 'number', min: 0, max: 5, step: 0.05, default: 1, label: 'frequency, Hz', random: [0.2, 2] },
    amount: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.35, random: [0.1, 0.45] },
    wavelength: { type: 'number', min: 2, max: 200, step: 1, default: 30, label: 'ring spacing, cells', random: [10, 60] },
    radius: { type: 'number', min: 0, max: 200, step: 1, default: 25, label: 'fade radius, cells', random: [10, 60] },
  },
  create(p) {
    return {
      kind: 'cell',
      apply(cell, x, y, ctx) {
        let phase = p.frequency * ctx.time;
        let amp = p.amount;

        if (p.shape === 'radial') {
          const dx = x - p.center.x;
          const dy = (y - p.center.y) / ctx.cellAspect;
          const d = Math.sqrt(dx * dx + dy * dy);
          phase -= d / p.wavelength;
          if (p.radius > 0) amp *= Math.exp(-d / p.radius);
        }

        // No oscillation: a steady push (a pump when `amount` follows the music).
        const s = p.frequency > 0 ? amp * Math.sin(TAU * phase) : amp;
        if (p.target === 'brightness') cell.lum += s;
        else cell.lum = 0.5 + (cell.lum - 0.5) * (1 + s);
      },
    };
  },
});
