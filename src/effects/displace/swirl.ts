import { defineEffect } from '../types.ts';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * Twist around `center`: rotation is `angle` at the centre and fades to 0 at
 * `radius` (smooth quadratic falloff). `wobble` > 0 swings the twist back and
 * forth at that frequency. Rotation happens in isotropic space.
 */
export const swirl = defineEffect({
  id: 'swirl',
  name: 'Swirl',
  kind: 'displace',
  params: {
    center: { type: 'point', default: 'center' },
    angle: { type: 'number', min: -720, max: 720, step: 5, default: 180, label: 'angle, deg' },
    radius: { type: 'number', min: 1, max: 200, step: 1, default: 30, label: 'radius, cells' },
    wobble: { type: 'number', min: 0, max: 3, step: 0.05, default: 0.25, label: 'wobble, Hz' },
  },
  create(p) {
    return {
      kind: 'displace',
      apply(_x, _y, ctx, out) {
        const aspect = ctx.cellAspect;
        const dx = out.x - p.center.x;
        const dy = (out.y - p.center.y) / aspect;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= p.radius) return;

        const k = 1 - d / p.radius;
        let theta = p.angle * DEG * k * k;
        if (p.wobble > 0) theta *= Math.sin(TAU * p.wobble * ctx.time);
        // Inverse mapping: sample from the point rotated back by theta.
        const c = Math.cos(-theta);
        const s = Math.sin(-theta);
        out.x = p.center.x + dx * c - dy * s;
        out.y = p.center.y + (dx * s + dy * c) * aspect;
      },
    };
  },
});
