import { createNoise } from '../../core/noise.ts';
import { defineEffect } from '../types.ts';

const NOISE_SEED = 0x11b1d;
// Second noise channel is read far away so x and y flows are independent.
const Y_CHANNEL = 137.5;
// Flow is evaluated on a coarse lattice once per frame and interpolated: the
// field is smooth (scale >= 4 cells), so a 4-cell step is visually exact and
// cuts noise evaluations ~8x.
const STEP = 4;

/**
 * Liquid flow: the sample point drifts along two animated fbm noise fields.
 * Noise space and amplitude are isotropic (cell widths). The flow is looked up
 * at the current sample point, so it composes with earlier displace effects.
 */
export const liquid = defineEffect({
  id: 'liquid',
  name: 'Liquid',
  kind: 'displace',
  params: {
    amplitude: { type: 'number', min: 0, max: 10, step: 0.1, default: 2, label: 'amplitude, cells' },
    scale: { type: 'number', min: 4, max: 100, step: 1, default: 20, label: 'scale, cells' },
    speed: { type: 'number', min: 0, max: 2, step: 0.01, default: 0.3 },
    octaves: { type: 'number', min: 1, max: 4, step: 1, default: 2 },
  },
  create(p) {
    const noise = createNoise(NOISE_SEED);
    const io = noise.io;
    let lastFrame = -1;
    let gw = 0;
    let gh = 0;
    let stepY = 1;
    let flowX = new Float32Array(0);
    let flowY = new Float32Array(0);

    /** Lattice in cell coords: x = gx * STEP, y = gy * stepY (stepY rows ~ STEP widths). */
    function rebuild(cols: number, rows: number, aspect: number, time: number): void {
      stepY = Math.max(1, Math.round(STEP * aspect));
      const w = Math.ceil((cols - 1) / STEP) + 1;
      const h = Math.ceil((rows - 1) / stepY) + 1;
      if (w !== gw || h !== gh) {
        gw = w;
        gh = h;
        flowX = new Float32Array(w * h);
        flowY = new Float32Array(w * h);
      }
      const inv = 1 / p.scale;
      const nz = time * p.speed;
      const octaves = p.octaves | 0;
      for (let gy = 0, k = 0; gy < h; gy++) {
        const ny = ((gy * stepY) / aspect) * inv;
        for (let gx = 0; gx < w; gx++, k++) {
          const nx = gx * STEP * inv;
          io[0] = nx;
          io[1] = ny;
          io[2] = nz;
          noise.fbm3io(octaves);
          flowX[k] = io[3]!;
          io[0] = nx + Y_CHANNEL;
          io[1] = ny;
          io[2] = nz;
          noise.fbm3io(octaves);
          flowY[k] = io[3]!;
        }
      }
    }

    return {
      kind: 'displace',
      apply(_x, _y, ctx, out) {
        if (ctx.frame !== lastFrame) {
          lastFrame = ctx.frame;
          rebuild(ctx.cols, ctx.rows, ctx.cellAspect, ctx.time);
        }

        // Bilinear lookup at the current sample point (lattice units, clamped).
        const gx = Math.min(Math.max(out.x / STEP, 0), gw - 1);
        const gy = Math.min(Math.max(out.y / stepY, 0), gh - 1);
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const x1 = x0 < gw - 1 ? x0 + 1 : x0;
        const y1 = y0 < gh - 1 ? y0 + 1 : y0;
        const fx = gx - x0;
        const fy = gy - y0;
        const a = y0 * gw + x0;
        const b = y0 * gw + x1;
        const c = y1 * gw + x0;
        const d = y1 * gw + x1;
        const top = flowX[a]! + (flowX[b]! - flowX[a]!) * fx;
        const bot = flowX[c]! + (flowX[d]! - flowX[c]!) * fx;
        const vx = top + (bot - top) * fy;
        const topY = flowY[a]! + (flowY[b]! - flowY[a]!) * fx;
        const botY = flowY[c]! + (flowY[d]! - flowY[c]!) * fx;
        const vy = topY + (botY - topY) * fy;

        out.x += vx * p.amplitude;
        out.y += vy * p.amplitude * ctx.cellAspect;
      },
    };
  },
});
