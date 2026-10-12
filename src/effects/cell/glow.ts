import { parseHex } from '../../core/color.ts';
import { defineEffect } from '../types.ts';

/**
 * Lights cell plates around a point: the plate takes `color` with a smooth
 * falloff to `radius` (isotropic, cell widths). Works over any plate mode,
 * including none: the pipeline keeps a plate channel for it (DECISIONS 021).
 */
export const glow = defineEffect({
  id: 'glow',
  name: 'Glow',
  kind: 'cell',
  writesPlate: true,
  params: {
    center: { type: 'point', default: 'pointer' },
    color: { type: 'color', default: '#ffb347' },
    radius: { type: 'number', min: 1, max: 120, step: 1, default: 16, label: 'radius, cells', random: [6, 40] },
    strength: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.8, random: [0.4, 1] },
    falloff: { type: 'number', min: 0.2, max: 4, step: 0.05, default: 1.5, label: 'falloff', random: [0.8, 2.5] },
  },
  create(p) {
    let parsed = '';
    const rgb = new Float64Array(3);

    return {
      kind: 'cell',
      apply(cell, x, y, ctx) {
        if (p.color !== parsed) {
          parsed = p.color;
          const c = parseHex(p.color);
          rgb[0] = c[0];
          rgb[1] = c[1];
          rgb[2] = c[2];
        }
        const dx = x - p.center.x;
        const dy = (y - p.center.y) / ctx.cellAspect;
        const d = Math.sqrt(dx * dx + dy * dy) / p.radius;
        if (d >= 1) return;
        // 1 at the centre, 0 at the radius; `falloff` shapes the curve.
        const k = Math.pow(1 - d, p.falloff) * p.strength;
        const a = k * 255;
        // Over the existing plate: colour by weight, alpha accumulates.
        const total = a + cell.pa * (1 - k);
        if (total <= 0) return;
        cell.pr = (rgb[0]! * a + cell.pr * cell.pa * (1 - k)) / total;
        cell.pg = (rgb[1]! * a + cell.pg * cell.pa * (1 - k)) / total;
        cell.pb = (rgb[2]! * a + cell.pb * cell.pa * (1 - k)) / total;
        cell.pa = total;
      },
    };
  },
});
