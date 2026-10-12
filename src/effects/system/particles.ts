import { HASH_UNIT, hashInt2 } from '../../core/prng.ts';
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
const INTRO_SEED = 0x1a7;

/**
 * Every cell is a particle with a home (SPEC 13, DECISIONS 024): a spring
 * pulls it back, damping calms it. The pointer pushes particles aside, a
 * click blasts them apart around it, a beat of the track blasts them around
 * `center`; `intro` starts them scattered so the picture assembles itself.
 * A moved particle leaves its cell empty and is drawn as a sprite carrying
 * the cell's live glyph and colour; at rest it is a plain cell again.
 * Positions are in cell widths on both axes (isotropic).
 */
export const particles = defineEffect({
  id: 'particles',
  name: 'Particles',
  kind: 'system',
  params: {
    intro: { type: 'select', options: ['none', 'scatter', 'rain', 'implode'], default: 'none' },
    stiffness: { type: 'number', min: 0.5, max: 60, step: 0.5, default: 12, label: 'spring', random: [4, 25] },
    damping: { type: 'number', min: 0, max: 20, step: 0.1, default: 3, random: [1.5, 6] },
    push: { type: 'number', min: 0, max: 800, step: 5, default: 0, label: 'cursor push', random: [100, 400] },
    pushRadius: { type: 'number', min: 1, max: 60, step: 1, default: 8, label: 'push radius, cells', random: [5, 15] },
    explode: { type: 'number', min: 0, max: 200, step: 1, default: 60, label: 'click force, cells/s', random: [30, 120] },
    beat: { type: 'number', min: 0, max: 200, step: 1, default: 0, label: 'beat force, cells/s', random: [0, 0] },
    center: { type: 'point', default: 'center', label: 'center (beat)' },
    radius: { type: 'number', min: 1, max: 200, step: 1, default: 30, label: 'blast radius, cells', random: [15, 60] },
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
    // Intro: seconds a particle waits at its start before it is let go.
    let wait = new Float32Array(0);
    let pending = 0;

    const setup = (c: number, r: number, aspect: number): void => {
      n = c * r;
      cols = c;
      px = new Float32Array(n);
      py = new Float32Array(n);
      vx = new Float32Array(n);
      vy = new Float32Array(n);
      moving = new Uint8Array(n);
      wait = new Float32Array(n);
      const w = c;
      const h = r / aspect;
      for (let i = 0; i < n; i++) {
        const hx = i % c;
        const hy = Math.floor(i / c) / aspect;
        // Two hashes per cell: the same scatter on every run (no PRNG state).
        const u = hashInt2(i, 0, INTRO_SEED) * HASH_UNIT;
        const v = hashInt2(i, 1, INTRO_SEED) * HASH_UNIT;
        switch (p.intro) {
          case 'scatter':
            px[i] = (u * 1.4 - 0.2) * w;
            py[i] = (v * 1.4 - 0.2) * h;
            wait[i] = v * 0.6;
            break;
          case 'rain':
            // Just above the top; bottom rows let go first, so the picture
            // fills from the bottom up. (A spring's travel time hardly
            // depends on the distance: the order comes from the waits.)
            px[i] = hx;
            py[i] = -1 - v * 2;
            wait[i] = (1 - hy / h) * 1.6 + u * 0.25;
            break;
          case 'implode': {
            // Out on a ring around the picture, falling inwards.
            const a = u * Math.PI * 2;
            const rad = Math.max(w, h) * (0.8 + v * 0.4);
            px[i] = w / 2 + Math.cos(a) * rad;
            py[i] = h / 2 + Math.sin(a) * rad;
            break;
          }
          default:
            px[i] = hx;
            py[i] = hy;
        }
        moving[i] = p.intro === 'none' ? 0 : 1;
      }
      pending = 0;
    };

    /** Outward kick around (cx, cy), iso units, fading to `r`. */
    const blast = (cx: number, cy: number, force: number, r: number, alpha: Float32Array, mask: Float32Array | null): void => {
      for (let i = 0; i < n; i++) {
        if (alpha[i]! < ALPHA_EPS) continue;
        const w = mask === null ? 1 : mask[i]!;
        if (w <= 0) continue;
        const dx = px[i]! - cx;
        const dy = py[i]! - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= r) continue;
        const f = force * w * (1 - d / r);
        // Dead centre: a direction from the index.
        const ux = d > 1e-6 ? dx / d : Math.cos(i * 2.399);
        const uy = d > 1e-6 ? dy / d : Math.sin(i * 2.399);
        vx[i] = vx[i]! + ux * f;
        vy[i] = vy[i]! + uy * f;
        moving[i] = 1;
      }
    };

    return {
      kind: 'system',
      system: {
        step(ctx, work, mask, mix) {
          const aspect = ctx.cellAspect;
          if (work.cols * work.rows !== n || work.cols !== cols) setup(work.cols, work.rows, aspect);
          const alpha = work.alpha;
          const rows = work.rows;

          // Click: a blast at the pointer. Beat: a blast at `center`, as strong as the beat.
          const ptr = ctx.pointer;
          if (ptr.clicked && ptr.inside && p.explode > 0) blast(ptr.x, ptr.y / aspect, p.explode * mix, p.radius, alpha, mask);
          if (ctx.beat > 0 && p.beat > 0) blast(p.center.x, p.center.y / aspect, p.beat * ctx.beat * mix, p.radius, alpha, mask);

          // Pointer push: wake the resting cells under it; the steps push every moving one.
          const pushing = ptr.inside && p.push > 0;
          const pcx = ptr.x;
          const pcy = ptr.y / aspect;
          const pr = p.pushRadius;
          if (pushing) {
            const x0 = Math.max(0, Math.floor(pcx - pr));
            const x1 = Math.min(cols - 1, Math.ceil(pcx + pr));
            const y0 = Math.max(0, Math.floor((pcy - pr) * aspect));
            const y1 = Math.min(rows - 1, Math.ceil((pcy + pr) * aspect));
            for (let y = y0; y <= y1; y++) {
              for (let x = x0; x <= x1; x++) {
                const i = y * cols + x;
                if (moving[i] === 1 || alpha[i]! < ALPHA_EPS) continue;
                if (mask !== null && mask[i]! <= 0) continue;
                const dx = px[i]! - pcx;
                const dy = py[i]! - pcy;
                if (dx * dx + dy * dy < pr * pr) moving[i] = 1;
              }
            }
          }

          // Fixed steps; the remainder carries to the next frame.
          pending += ctx.dt;
          let steps = Math.floor(pending / STEP);
          pending -= steps * STEP;
          if (steps > MAX_STEPS) steps = MAX_STEPS;
          const k = p.stiffness;
          const c = p.damping;
          const push = p.push * mix;
          for (let s = 0; s < steps; s++) {
            for (let i = 0; i < n; i++) {
              if (moving[i] === 0) continue;
              if (wait[i]! > 0) {
                wait[i] = wait[i]! - STEP;
                continue;
              }
              const hx = i % cols;
              const hy = Math.floor(i / cols) / aspect;
              let ax = k * (hx - px[i]!) - c * vx[i]!;
              let ay = k * (hy - py[i]!) - c * vy[i]!;
              if (pushing) {
                const dx = px[i]! - pcx;
                const dy = py[i]! - pcy;
                const d2 = dx * dx + dy * dy;
                if (d2 < pr * pr) {
                  const d = Math.sqrt(d2);
                  const w = mask === null ? 1 : mask[i]!;
                  // Strongest at the pointer, gone at the radius.
                  const f = push * w * (1 - d / pr) * (1 - d / pr);
                  // Right under the pointer: a direction from the index.
                  ax += d > 1e-4 ? (dx / d) * f : Math.cos(i * 2.399) * f;
                  ay += d > 1e-4 ? (dy / d) * f : Math.sin(i * 2.399) * f;
                }
              }
              // Semi-implicit Euler: velocity first, then position.
              let ux = vx[i]! + ax * STEP;
              let uy = vy[i]! + ay * STEP;
              const x = px[i]! + ux * STEP;
              const y = py[i]! + uy * STEP;
              const ex = hx - x;
              const ey = hy - y;
              const near = pushing && (x - pcx) * (x - pcx) + (y - pcy) * (y - pcy) < pr * pr;
              if (!near && ex * ex + ey * ey < REST_DIST * REST_DIST && ux * ux + uy * uy < REST_SPEED * REST_SPEED) {
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
