import { defineEffect } from '../types.ts';

const TAU = Math.PI * 2;

/**
 * Travelling sine wave added to brightness. Distances are isotropic: one unit
 * is one cell width, so a 45-degree wave really runs diagonally on screen.
 */
export const wave = defineEffect({
  id: 'wave',
  name: 'Wave',
  kind: 'cell',
  params: {
    direction: { type: 'number', min: 0, max: 360, step: 1, default: 0, label: 'direction, deg' },
    wavelength: { type: 'number', min: 2, max: 200, step: 1, default: 24, label: 'wavelength, cells' },
    speed: { type: 'number', min: -5, max: 5, step: 0.05, default: 0.5, label: 'speed, waves/s' },
    amplitude: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  create(p) {
    // Direction changes rarely; recompute the unit vector only when it does.
    let dir = Number.NaN;
    let dx = 1;
    let dy = 0;

    return {
      kind: 'cell',
      apply(cell, x, y, ctx) {
        if (p.direction !== dir) {
          dir = p.direction;
          const a = (dir * Math.PI) / 180;
          dx = Math.cos(a);
          dy = Math.sin(a);
        }
        // y / cellAspect converts rows to cell widths.
        const along = x * dx + (y / ctx.cellAspect) * dy;
        cell.lum += p.amplitude * Math.sin(TAU * (along / p.wavelength - p.speed * ctx.time));
      },
    };
  },
});
