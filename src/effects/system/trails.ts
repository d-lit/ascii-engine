import { defineEffect } from '../types.ts';

/**
 * Trails (SPEC 13, DECISIONS 025): the picture remembers itself. `grid` —
 * every cell eases toward its value of the last frame (an echo: moving
 * details leave fading copies, in both polarities); `sprites` — the sprite
 * layer fades instead of clearing, so flying characters draw tails. `fade`
 * is the time for a trail to drop to about a third; frame-rate independent.
 * Order against `particles` does not matter: the sprite layer draws tails.
 */
export const trails = defineEffect({
  id: 'trails',
  name: 'Trails',
  kind: 'system',
  params: {
    on: { type: 'select', options: ['both', 'grid', 'sprites'], default: 'both' },
    fade: { type: 'number', min: 0.02, max: 3, step: 0.01, default: 0.35, label: 'fade, s', random: [0.15, 0.8] },
  },
  create(p) {
    let n = 0;
    // Last frame's output, the echo source.
    let lum = new Float32Array(0);
    let alpha = new Float32Array(0);
    let fresh = true;

    return {
      kind: 'system',
      system: {
        step(ctx, work, mask, mix) {
          const keep = Math.exp(-ctx.dt / Math.max(1e-3, p.fade));
          // Sprite tails: the layer keeps this much of itself; mix shortens them.
          if (p.on !== 'grid') work.spriteFade = keep * Math.min(1, mix);
          if (p.on === 'sprites') return;

          const size = work.cols * work.rows;
          if (size !== n) {
            n = size;
            lum = new Float32Array(n);
            alpha = new Float32Array(n);
            fresh = true;
          }
          const wl = work.lum;
          const wa = work.alpha;
          if (fresh) {
            lum.set(wl);
            alpha.set(wa);
            fresh = false;
            return;
          }
          // Hot loop: i < n = cells of work. k = how much of the past stays here.
          const base = keep * mix;
          for (let i = 0; i < n; i++) {
            const k = mask === null ? base : base * mask[i]!;
            const l = wl[i]! + (lum[i]! - wl[i]!) * k;
            const a = wa[i]! + (alpha[i]! - wa[i]!) * k;
            wl[i] = l;
            wa[i] = a;
            lum[i] = l;
            alpha[i] = a;
          }
        },
      },
    };
  },
});
