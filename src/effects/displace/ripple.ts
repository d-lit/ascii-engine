import { defineEffect } from '../types.ts';

const TAU = Math.PI * 2;
const MAX_RINGS = 8;

/**
 * Circular waves that push the sample point along the radius. `continuous`
 * radiates from `center` all the time; `click` launches a ring at the pointer
 * on every click (up to 8 at once, oldest replaced). Distances, amplitude and
 * speed are in cell widths, so rings stay round on screen.
 */
export const ripple = defineEffect({
  id: 'ripple',
  name: 'Ripple',
  kind: 'displace',
  params: {
    mode: { type: 'select', options: ['continuous', 'click'], default: 'continuous' },
    center: { type: 'point', default: 'pointer', label: 'center (continuous)' },
    amplitude: { type: 'number', min: 0, max: 6, step: 0.1, default: 1.5, label: 'amplitude, cells', random: [0.5, 3] },
    wavelength: { type: 'number', min: 2, max: 80, step: 1, default: 12, label: 'wavelength, cells', random: [6, 30] },
    speed: { type: 'number', min: 0, max: 120, step: 1, default: 24, label: 'speed, cells/s', random: [8, 40] },
    decay: { type: 'number', min: 0, max: 200, step: 1, default: 40, label: 'fade radius, cells', random: [15, 80] },
    life: { type: 'number', min: 0.5, max: 10, step: 0.1, default: 3, label: 'ring life, s' },
  },
  create(p) {
    // Ring pool: centre and launch time; t0 < 0 marks a free slot.
    const ringX = new Float64Array(MAX_RINGS);
    const ringY = new Float64Array(MAX_RINGS);
    const ringT0 = new Float64Array(MAX_RINGS).fill(-1);
    let next = 0;
    let lastFrame = -1;

    return {
      kind: 'displace',
      apply(_x, _y, ctx, out) {
        const t = ctx.time;
        const aspect = ctx.cellAspect;

        // Once per frame: launch a ring on click.
        if (ctx.frame !== lastFrame) {
          lastFrame = ctx.frame;
          const ptr = ctx.pointer;
          if (p.mode === 'click' && ptr.clicked && ptr.inside) {
            ringX[next] = ptr.x;
            ringY[next] = ptr.y;
            ringT0[next] = t;
            next = (next + 1) % MAX_RINGS;
          }
        }

        const px = out.x;
        const py = out.y;
        let ox = 0;
        let oy = 0;

        if (p.mode === 'continuous') {
          const dx = px - p.center.x;
          const dy = (py - p.center.y) / aspect;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 1e-6) {
            let off = p.amplitude * Math.sin((TAU * (d - p.speed * t)) / p.wavelength);
            if (p.decay > 0) off *= Math.exp(-d / p.decay);
            ox = (off * dx) / d;
            oy = (off * dy) / d;
          }
        } else {
          for (let r = 0; r < MAX_RINGS; r++) {
            const t0 = ringT0[r]!;
            if (t0 < 0) continue;
            const age = t - t0;
            if (age >= p.life) {
              ringT0[r] = -1;
              continue;
            }
            const dx = px - ringX[r]!;
            const dy = (py - ringY[r]!) / aspect;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < 1e-6) continue;
            // Wave packet around the travelling front, fading with age.
            const u = (d - p.speed * age) / p.wavelength;
            if (u < -2 || u > 2) continue;
            let off = p.amplitude * Math.sin(TAU * u) * Math.exp(-u * u * 2) * (1 - age / p.life);
            if (p.decay > 0) off *= Math.exp(-d / p.decay);
            ox += (off * dx) / d;
            oy += (off * dy) / d;
          }
        }

        out.x = px + ox;
        out.y = py + oy * aspect;
      },
    };
  },
});
