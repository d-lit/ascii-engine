import { parseHex } from '../../core/color.ts';
import { defineEffect } from '../types.ts';

/**
 * Paints cells with a colour. `replace` swaps the ink, `multiply` darkens it
 * through the colour (keeps picture detail), `screen` lightens toward it.
 * Covers the whole picture; limit it with a mask (radial at the pointer
 * makes a coloured spotlight).
 */
export const tint = defineEffect({
  id: 'tint',
  name: 'Tint',
  kind: 'cell',
  writesColor: true,
  params: {
    color: { type: 'color', default: '#ff3b6b' },
    blend: { type: 'select', options: ['replace', 'multiply', 'screen'], default: 'replace' },
    amount: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.7, random: [0.3, 1] },
  },
  create(p) {
    // Parsed only when the colour param changes; typed array keeps the
    // channels unboxed (DECISIONS 013).
    let parsed = '';
    const rgb = new Float64Array(3);

    return {
      kind: 'cell',
      apply(cell) {
        if (p.color !== parsed) {
          parsed = p.color;
          const c = parseHex(p.color);
          rgb[0] = c[0];
          rgb[1] = c[1];
          rgb[2] = c[2];
        }
        const a = p.amount;
        const tr = rgb[0]!;
        const tg = rgb[1]!;
        const tb = rgb[2]!;
        let r = tr;
        let g = tg;
        let b = tb;
        if (p.blend === 'multiply') {
          r = (cell.r * tr) / 255;
          g = (cell.g * tg) / 255;
          b = (cell.b * tb) / 255;
        } else if (p.blend === 'screen') {
          r = 255 - ((255 - cell.r) * (255 - tr)) / 255;
          g = 255 - ((255 - cell.g) * (255 - tg)) / 255;
          b = 255 - ((255 - cell.b) * (255 - tb)) / 255;
        }
        cell.r += (r - cell.r) * a;
        cell.g += (g - cell.g) * a;
        cell.b += (b - cell.b) * a;
      },
    };
  },
});
