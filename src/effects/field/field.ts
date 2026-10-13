import type { FrameContext } from '../../core/context.ts';
import type { CellFn } from '../types.ts';

/**
 * Field + operation (DECISIONS 029, 030): a shape over the grid decides
 * where, an operation decides what happens to the cells inside. Shapes are
 * signed distances in cell widths (isotropic: y is scaled by cellAspect),
 * negative inside; `edge` 0 is a hard edge.
 */
export const SHAPES = ['circle', 'ring', 'box', 'stripes', 'rings', 'line', 'plasma'] as const;
export type Shape = (typeof SHAPES)[number];
export const OPS = ['invert', 'set', 'erase', 'threshold', 'dither', 'ramp'] as const;
export type FieldOp = (typeof OPS)[number];

/** Plain numbers for one frame; wrappers fill what they expose. */
export interface FieldParams {
  shape: Shape;
  op: FieldOp;
  /** Centre, cells (from a point param). */
  cx: number;
  cy: number;
  /** Radius / half-size (circle, ring, box), cells; plasma: field scale. */
  size: number;
  /** Ring, stripe and line width, cells. */
  thickness: number;
  /** Stripe and ring period, cells. */
  period: number;
  /** Degrees, plus `spin` degrees per second. */
  angle: number;
  spin: number;
  /** Stripes: cells per second across; rings: outward; plasma: flow rate. */
  speed: number;
  /** Soft edge width, cells; 0 = hard. */
  edge: number;
  /** Act outside the shape instead. */
  outside: boolean;
  /** set: the brightness; threshold: the cut. */
  level: number;
  /** plasma: share of the picture it covers, 0..1. */
  cover: number;
  /** ramp: built-in ramp index + 1 (RAMP_NAMES). */
  ramp: number;
}

// 4x4 Bayer matrix, thresholds in (0, 1).
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const DEG = Math.PI / 180;

/**
 * A cell function for a field effect. `read` copies this frame's params
 * into the given struct once per frame; the shape is evaluated inline per
 * cell (no double-returning calls in the cell loop, DECISIONS 013).
 */
export function fieldCell(read: (ctx: FrameContext, out: FieldParams) => void): CellFn {
  const f: FieldParams = {
    shape: 'circle',
    op: 'invert',
    cx: 0,
    cy: 0,
    size: 10,
    thickness: 2,
    period: 10,
    angle: 0,
    spin: 0,
    speed: 0,
    edge: 0,
    outside: false,
    level: 1,
    cover: 0.5,
    ramp: 1,
  };
  // Per-frame derived values: direction, phase, centre in iso units.
  const k = new Float64Array(6);
  // Per-cell results: distance and coverage. Branches write here instead of
  // into a local, so no double phi is formed (Maglev boxes those; DECISIONS 013).
  const r = new Float64Array(2);
  let frame = -1;

  return (cell, x, y, ctx) => {
    if (ctx.frame !== frame) {
      frame = ctx.frame;
      read(ctx, f);
      const a = (f.angle + f.spin * ctx.time) * DEG;
      k[0] = Math.cos(a);
      k[1] = Math.sin(a);
      k[2] = f.cx;
      k[3] = f.cy / ctx.cellAspect;
      k[4] = f.speed * ctx.time;
      k[5] = Math.max(1e-3, f.period);
    }
    const px = x;
    const py = y / ctx.cellAspect;
    const dx = px - k[2]!;
    const dy = py - k[3]!;
    const ca = k[0]!;
    const sa = k[1]!;

    // Signed distance, cells; negative inside.
    switch (f.shape) {
      case 'circle':
        r[0] = Math.sqrt(dx * dx + dy * dy) - f.size;
        break;
      case 'ring':
        r[0] = Math.abs(Math.sqrt(dx * dx + dy * dy) - f.size) - f.thickness * 0.5;
        break;
      case 'box': {
        const qx = Math.abs(dx * ca + dy * sa) - f.size;
        const qy = Math.abs(-dx * sa + dy * ca) - f.size;
        const ox = Math.max(qx, 0);
        const oy = Math.max(qy, 0);
        r[0] = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0);
        break;
      }
      case 'stripes': {
        // Across the stripes: along (cos, sin), scrolling by speed.
        const period = k[5]!;
        const u = px * ca + py * sa - k[4]!;
        const m = u - Math.floor(u / period) * period;
        r[0] = Math.abs(m - period * 0.5) - f.thickness * 0.5;
        break;
      }
      case 'rings': {
        // Concentric rings around the centre, travelling outward by speed.
        const period = k[5]!;
        const u = Math.sqrt(dx * dx + dy * dy) - k[4]!;
        const m = u - Math.floor(u / period) * period;
        r[0] = Math.abs(m - period * 0.5) - f.thickness * 0.5;
        break;
      }
      case 'line':
        // Through the centre, along the angle.
        r[0] = Math.abs(-dx * sa + dy * ca) - f.thickness * 0.5;
        break;
      case 'plasma': {
        // Sum of drifting waves, -1..1; the top `cover` share is inside (scaled to cells by size).
        const s = 1 / Math.max(1, f.size);
        const t = k[4]!;
        const v =
          (Math.sin(px * s + t) +
            Math.sin(py * s * 1.3 - t * 0.7) +
            Math.sin((px + py) * s * 0.7 + t * 0.5) +
            Math.sin(Math.sqrt(dx * dx + dy * dy) * s * 1.1 - t)) *
          0.25;
        r[0] = (1 - 2 * f.cover - v) * Math.max(1, f.size) * 0.5;
        break;
      }
    }

    // Coverage 0..1: hard or soft edge (a plain step); outside flips it.
    const d = r[0]!;
    const e = Math.max(f.edge, 1e-6);
    const soft = Math.min(1, Math.max(0, 0.5 - d / e));
    const hard = Math.min(1, 1 - Math.sign(d));
    const edged = f.edge > 0 ? 1 : 0;
    r[1] = hard + (soft - hard) * edged;
    if (f.outside) r[1] = 1 - r[1]!;
    const w = r[1]!;
    if (w <= 0) return;

    const lum = cell.lum;
    switch (f.op) {
      case 'invert':
        cell.lum = lum + (1 - 2 * lum) * w;
        break;
      case 'set':
        cell.lum = lum + (f.level - lum) * w;
        break;
      case 'erase':
        cell.alpha = cell.alpha * (1 - w);
        break;
      case 'threshold':
        cell.lum = lum + (Math.min(1, Math.max(0, Math.sign(lum - f.level) + 1)) - lum) * w;
        break;
      case 'dither': {
        const b = BAYER[(y & 3) * 4 + (x & 3)]!;
        cell.lum = lum + (Math.min(1, Math.max(0, Math.sign(lum - b) + 1)) - lum) * w;
        break;
      }
      case 'ramp':
        if (w >= 0.5) cell.ramp = f.ramp;
        break;
    }
  };
}
