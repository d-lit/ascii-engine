import { ALPHA_EPS } from '../../render/cell-char.ts';
import { defineEffect } from '../types.ts';

// Physics runs in fixed steps, whatever the frame rate: the same motion on
// screen and in an offline render (DECISIONS 024).
const STEP = 1 / 120;
const MAX_STEPS = 12;
// A particle this close to home (cell widths) and this slow is at rest: it
// snaps home and goes back into the grid.
const REST_DIST = 0.02;
const REST_SPEED = 0.05;

/**
 * Every cell is a particle with a home (SPEC 13, DECISIONS 024): a spring
 * pulls it back, damping calms it, a click blows the particles around the
 * pointer apart. A moved particle leaves its cell empty and is drawn as a
 * sprite carrying the cell's live glyph and colour; at rest it is a plain
 * cell again. Positions are in cell widths on both axes (isotropic).
 */
export const particles = defineEffect({
  id: 'particles',
  name: 'Particles',
  kind: 'system',
  params: {
    stiffness: { type: 'number', min: 0.5, max: 60, step: 0.5, default: 12, label: 'spring', random: [4, 25] },
    damping: { type: 'number', min: 0, max: 20, step: 0.1, default: 3, random: [1.5, 6] },
    explode: { type: 'number', min: 0, max: 200, step: 1, default: 60, label: 'click force, cells/s', random: [30, 120] },
    radius: { type: 'number', min: 1, max: 200, step: 1, default: 30, label: 'click radius, cells', random: [15, 60] },
    snap: { type: 'boolean', default: false, label: 'snap to cells' },
  },
  create(p) {
    let n = 0;
    let cols = 0;
    // Position and velocity, cell widths and cell widths per second.
    let px = new Float32Array(0);
    let py = new Float32Array(0);
    let vx = new Float32Array(0);
    let vy = new Float32Array(0);
    // 1 = away from home (simulated, drawn as a sprite).
    let moving = new Uint8Array(0);
    let pending = 0;

    const setup = (c: number, r: number, aspect: number): void => {
      n = c * r;
      cols = c;
      px = new Float32Array(n);
      py = new Float32Array(n);
      vx = new Float32Array(n);
      vy = new Float32Array(n);
      moving = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        px[i] = i % c;
        py[i] = Math.floor(i / c) / aspect;
      }
      pending = 0;
    };

    return {
      kind: 'system',
      system: {
        step(ctx, work, mask, mix) {
          const aspect = ctx.cellAspect;
          if (work.cols * work.rows !== n || work.cols !== cols) setup(work.cols, work.rows, aspect);
          const alpha = work.alpha;

          // Click: an outward kick around the pointer, fading to the radius.
          const ptr = ctx.pointer;
          if (ptr.clicked && ptr.inside && p.explode > 0) {
            const cx = ptr.x;
            const cy = ptr.y / aspect;
            const r = p.radius;
            for (let i = 0; i < n; i++) {
              if (alpha[i]! < ALPHA_EPS) continue;
              const w = mask === null ? 1 : mask[i]!;
              if (w <= 0) continue;
              const dx = px[i]! - cx;
              const dy = py[i]! - cy;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d >= r) continue;
              const f = p.explode * mix * w * (1 - d / r);
              // Dead centre: a pseudo-random direction from the index.
              const ux = d > 1e-6 ? dx / d : Math.cos(i * 2.399);
              const uy = d > 1e-6 ? dy / d : Math.sin(i * 2.399);
              vx[i] = vx[i]! + ux * f;
              vy[i] = vy[i]! + uy * f;
              moving[i] = 1;
            }
          }

          // Fixed steps; the remainder carries to the next frame.
          pending += ctx.dt;
          let steps = Math.floor(pending / STEP);
          pending -= steps * STEP;
          if (steps > MAX_STEPS) steps = MAX_STEPS;
          const k = p.stiffness;
          const c = p.damping;
          for (let s = 0; s < steps; s++) {
            for (let i = 0; i < n; i++) {
              if (moving[i] === 0) continue;
              const hx = i % cols;
              const hy = Math.floor(i / cols) / aspect;
              // Semi-implicit Euler: velocity first, then position.
              let ux = vx[i]! + (k * (hx - px[i]!) - c * vx[i]!) * STEP;
              let uy = vy[i]! + (k * (hy - py[i]!) - c * vy[i]!) * STEP;
              const x = px[i]! + ux * STEP;
              const y = py[i]! + uy * STEP;
              const ex = hx - x;
              const ey = hy - y;
              if (ex * ex + ey * ey < REST_DIST * REST_DIST && ux * ux + uy * uy < REST_SPEED * REST_SPEED) {
                px[i] = hx;
                py[i] = hy;
                ux = 0;
                uy = 0;
                moving[i] = 0;
              } else {
                px[i] = x;
                py[i] = y;
              }
              vx[i] = ux;
              vy[i] = uy;
            }
          }

          // Moved particles: out of the grid, into sprites.
          const sp = work.sprites;
          const hidden = work.hidden;
          let count = sp.count;
          for (let i = 0; i < n && count < sp.capacity; i++) {
            if (moving[i] === 0 || alpha[i]! < ALPHA_EPS) continue;
            hidden[i] = 1;
            const x = px[i]!;
            const y = py[i]! * aspect;
            sp.x[count] = p.snap ? Math.round(x) : x;
            sp.y[count] = p.snap ? Math.round(y) : y;
            sp.src[count] = i;
            sp.alpha[count] = 1;
            count++;
          }
          sp.count = count;
        },
      },
    };
  },
});
