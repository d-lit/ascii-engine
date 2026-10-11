import { defineEffect } from '../types.ts';

/**
 * Lens at `center`: positive strength magnifies (samples pulled toward the
 * centre), negative shrinks. The effect fades smoothly to nothing at `radius`.
 * Magnification at the centre is 1 / (1 - strength).
 */
export const lens = defineEffect({
  id: 'lens',
  name: 'Lens',
  kind: 'displace',
  params: {
    center: { type: 'point', default: 'pointer' },
    radius: { type: 'number', min: 2, max: 100, step: 1, default: 18, label: 'radius, cells' },
    strength: { type: 'number', min: -1, max: 0.9, step: 0.05, default: 0.5 },
  },
  create(p) {
    return {
      kind: 'displace',
      apply(_x, _y, ctx, out) {
        const aspect = ctx.cellAspect;
        const dx = out.x - p.center.x;
        const dy = (out.y - p.center.y) / aspect;
        const q = (dx * dx + dy * dy) / (p.radius * p.radius);
        if (q >= 1) return;

        const w = 1 - q;
        const scale = 1 - p.strength * w * w;
        out.x = p.center.x + dx * scale;
        out.y = p.center.y + dy * scale * aspect;
      },
    };
  },
});
