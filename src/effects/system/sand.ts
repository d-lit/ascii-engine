import { HASH_UNIT, hashInt2 } from '../../core/prng.ts';
import { ALPHA_EPS } from '../../render/cell-char.ts';
import { defineEffect } from '../types.ts';

const MAX_STEPS = 8;
const SEED_RELEASE = 0x5a1;
const SEED_SIDE = 0x5a2;
// Grain states.
const HOME = 0;
const SAND = 1;
const BACK = 2;

/**
 * Sand (SPEC 13, DECISIONS 026): characters crumble off the picture and fall
 * as grains of a cellular automaton (down, else down-left or down-right),
 * piling up at the bottom edge over the picture; after `return, s` each
 * grain flies home. Only grains block grains, so a full photo crumbles too:
 * a fallen grain leaves a hole showing the backdrop. Grains are sprites
 * carrying their cell's live glyph; between automaton steps they move
 * smoothly. Fixed steps and hashes: the same on screen, after a seek and in
 * an offline render.
 */
export const sand = defineEffect({
  id: 'sand',
  name: 'Sand',
  kind: 'system',
  params: {
    crumble: { type: 'number', min: 0, max: 0.3, step: 0.005, default: 0.02, label: 'crumble, share/s', random: [0.01, 0.06] },
    clickRadius: { type: 'number', min: 0, max: 60, step: 1, default: 8, label: 'click radius, cells', random: [5, 15] },
    beatRadius: { type: 'number', min: 0, max: 60, step: 1, default: 0, label: 'beat radius, cells', random: [0, 0] },
    center: { type: 'point', default: 'center', label: 'center (beat)' },
    speed: { type: 'number', min: 5, max: 60, step: 1, default: 25, label: 'fall, cells/s', random: [15, 40] },
    hold: { type: 'number', min: 0.5, max: 30, step: 0.1, default: 4, label: 'return after, s', random: [2, 8] },
    flight: { type: 'number', min: 0.1, max: 3, step: 0.05, default: 0.7, label: 'flight home, s' },
  },
  create(p) {
    let n = 0;
    let cols = 0;
    let rows = 0;
    // Per grain (= home cell index): state, cell now and before the last step.
    let state = new Uint8Array(0);
    let pos = new Int32Array(0);
    let prev = new Int32Array(0);
    // Release time (SAND), or flight start (BACK), seconds of the pipeline clock.
    let since = new Float32Array(0);
    // Cell -> grain lying there, -1 = free. Only SAND grains occupy cells.
    let occ = new Int32Array(0);
    let pending = 0;
    let stepNo = 0;
    // Clock of the automaton: advances by whole steps, so release and return
    // times do not depend on the frame rate.
    let simTime = 0;

    const setup = (c: number, r: number): void => {
      n = c * r;
      cols = c;
      rows = r;
      state = new Uint8Array(n);
      pos = new Int32Array(n);
      prev = new Int32Array(n);
      since = new Float32Array(n);
      occ = new Int32Array(n).fill(-1);
      for (let i = 0; i < n; i++) {
        pos[i] = i;
        prev[i] = i;
      }
      pending = 0;
      stepNo = 0;
      simTime = 0;
    };

    /** Lets a resting grain go, if its cell is free of sand. */
    const release = (g: number, time: number): void => {
      if (state[g] !== HOME || occ[g] !== -1) return;
      state[g] = SAND;
      pos[g] = g;
      prev[g] = g;
      since[g] = time;
      occ[g] = g;
    };

    /** Grains within `r` (iso cells) of (cx, cy rows). */
    const releaseAround = (cx: number, cy: number, r: number, aspect: number, alpha: Float32Array, mask: Float32Array | null, time: number): void => {
      const x0 = Math.max(0, Math.floor(cx - r));
      const x1 = Math.min(cols - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r * aspect));
      const y1 = Math.min(rows - 1, Math.ceil(cy + r * aspect));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const g = y * cols + x;
          if (alpha[g]! < ALPHA_EPS || (mask !== null && mask[g]! <= 0)) continue;
          const dx = x - cx;
          const dy = (y - cy) / aspect;
          if (dx * dx + dy * dy <= r * r) release(g, time);
        }
      }
    };

    const step = (interval: number, alpha: Float32Array, mask: Float32Array | null, mix: number): void => {
      stepNo++;
      simTime += interval;
      const time = simTime;
      // Crumbling: each resting grain lets go with a chance per step.
      const chance = p.crumble * interval * mix;
      for (let g = 0; g < n; g++) {
        if (state[g] === SAND) {
          prev[g] = pos[g]!;
          // Time to go home: leaves the pile and flies.
          if (time - since[g]! >= p.hold) {
            occ[pos[g]!] = -1;
            state[g] = BACK;
            since[g] = time;
          }
          continue;
        }
        if (state[g] !== HOME || chance <= 0 || alpha[g]! < ALPHA_EPS) continue;
        const w = mask === null ? 1 : mask[g]!;
        if (w > 0 && hashInt2(g, stepNo, SEED_RELEASE) * HASH_UNIT < chance * w) release(g, time);
      }
      // Fall: bottom-up so a column moves together; sweep direction alternates.
      for (let y = rows - 2; y >= 0; y--) {
        const ltr = (stepNo & 1) === 0;
        for (let k = 0; k < cols; k++) {
          const x = ltr ? k : cols - 1 - k;
          const c = y * cols + x;
          const g = occ[c]!;
          if (g < 0 || pos[g] !== prev[g]) continue; // moved this step already
          const below = c + cols;
          let to = -1;
          if (occ[below] === -1) to = below;
          else {
            const left = (hashInt2(g, stepNo, SEED_SIDE) & 1) === 0;
            const a = left ? -1 : 1;
            if (x + a >= 0 && x + a < cols && occ[below + a] === -1) to = below + a;
            else if (x - a >= 0 && x - a < cols && occ[below - a] === -1) to = below - a;
          }
          if (to < 0) continue;
          occ[c] = -1;
          occ[to] = g;
          pos[g] = to;
        }
      }
    };

    return {
      kind: 'system',
      system: {
        step(ctx, work, mask, mix) {
          const aspect = ctx.cellAspect;
          if (work.cols * work.rows !== n || work.cols !== cols) setup(work.cols, work.rows);
          const alpha = work.alpha;

          const ptr = ctx.pointer;
          if (ptr.clicked && ptr.inside && p.clickRadius > 0) releaseAround(ptr.x, ptr.y, p.clickRadius, aspect, alpha, mask, simTime);
          if (ctx.beat > 0 && p.beatRadius > 0) releaseAround(p.center.x, p.center.y, p.beatRadius * ctx.beat, aspect, alpha, mask, simTime);

          const interval = 1 / p.speed;
          pending += ctx.dt;
          let steps = Math.floor(pending / interval);
          pending -= steps * interval;
          if (steps > MAX_STEPS) steps = MAX_STEPS;
          for (let s = 0; s < steps; s++) step(interval, alpha, mask, mix);
          // Between steps grains glide from `prev` to `pos`.
          const glide = Math.min(1, pending / interval);

          const sp = work.sprites;
          const hidden = work.hidden;
          let count = sp.count;
          for (let g = 0; g < n && count < sp.capacity; g++) {
            const st = state[g]!;
            if (st === HOME) continue;
            let x: number;
            let y: number;
            if (st === SAND) {
              const a = prev[g]!;
              const b = pos[g]!;
              x = (a % cols) + ((b % cols) - (a % cols)) * glide;
              y = Math.floor(a / cols) + (Math.floor(b / cols) - Math.floor(a / cols)) * glide;
            } else {
              // Flying home, eased; home again at the end.
              // Flight on the automaton clock plus the glide: smooth between steps.
              const t = (simTime + pending - since[g]!) / p.flight;
              const from = pos[g]!;
              if (t >= 1) {
                state[g] = HOME;
                pos[g] = g;
                prev[g] = g;
                continue;
              }
              const e = t * t * (3 - 2 * t);
              x = (from % cols) + ((g % cols) - (from % cols)) * e;
              y = Math.floor(from / cols) + (Math.floor(g / cols) - Math.floor(from / cols)) * e;
            }
            if (alpha[g]! < ALPHA_EPS) continue;
            hidden[g] = 1;
            sp.x[count] = x;
            sp.y[count] = y;
            sp.src[count] = g;
            sp.alpha[count] = 1;
            count++;
          }
          sp.count = count;
        },
      },
    };
  },
});
