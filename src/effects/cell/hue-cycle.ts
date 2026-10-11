import { defineEffect } from '../types.ts';

const DEG = Math.PI / 180;

/**
 * Rotates the hue of every cell's ink over time and across the picture.
 * `saturation` lifts grey inks (mono mode, grey photos) to at least that
 * saturation, so there is a hue to rotate. Value (brightness) is kept.
 */
export const hueCycle = defineEffect({
  id: 'hue-cycle',
  name: 'Hue cycle',
  kind: 'cell',
  writesColor: true,
  params: {
    speed: { type: 'number', min: -2, max: 2, step: 0.01, default: 0.1, label: 'speed, turns/s', random: [-0.3, 0.3] },
    spread: { type: 'number', min: 0, max: 4, step: 0.05, default: 1, label: 'spread, turns', random: [0.2, 2] },
    direction: { type: 'number', min: 0, max: 360, step: 1, default: 0, label: 'direction, deg' },
    saturation: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.6, random: [0.3, 1] },
  },
  create(p) {
    let dir = Number.NaN;
    const dv = new Float64Array(2);

    return {
      kind: 'cell',
      apply(cell, x, y, ctx) {
        if (p.direction !== dir) {
          dir = p.direction;
          dv[0] = Math.cos(dir * DEG);
          dv[1] = Math.sin(dir * DEG);
        }
        // Position along the direction, in picture widths (isotropic).
        const along = (x * dv[0]! + (y / ctx.cellAspect) * dv[1]!) / ctx.cols;
        const shift = p.speed * ctx.time + p.spread * along;

        // RGB -> HSV, inline to keep doubles out of calls.
        const r = cell.r / 255;
        const g = cell.g / 255;
        const b = cell.b / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d > 1e-6) {
          if (max === r) h = (g - b) / d / 6;
          else if (max === g) h = ((b - r) / d + 2) / 6;
          else h = ((r - g) / d + 4) / 6;
        }
        const s = Math.max(max > 0 ? d / max : 0, p.saturation);
        const v = max;

        h += shift;
        h -= Math.floor(h);

        // HSV -> RGB.
        const h6 = h * 6;
        const sector = Math.floor(h6);
        const f = h6 - sector;
        const pv = v * (1 - s);
        const qv = v * (1 - s * f);
        const tv = v * (1 - s * (1 - f));
        let ro = v;
        let go = tv;
        let bo = pv;
        if (sector === 1) {
          ro = qv;
          go = v;
          bo = pv;
        } else if (sector === 2) {
          ro = pv;
          go = v;
          bo = tv;
        } else if (sector === 3) {
          ro = pv;
          go = qv;
          bo = v;
        } else if (sector === 4) {
          ro = tv;
          go = pv;
          bo = v;
        } else if (sector >= 5) {
          ro = v;
          go = pv;
          bo = qv;
        }
        cell.r = ro * 255;
        cell.g = go * 255;
        cell.b = bo * 255;
      },
    };
  },
});
