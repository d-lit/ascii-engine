import type { FrameContext, Pointer } from '../core/context.ts';
import {
  copyFieldToWork,
  createWorkBuffer,
  type Field,
  type FieldMeta,
  type WorkBuffer,
} from '../core/field.ts';
import { createRand } from '../core/prng.ts';
import type { Vec2 } from '../core/math.ts';
import type {
  AnyEffectDef,
  CellFn,
  CellRef,
  DisplaceFn,
  EffectInstance,
} from '../effects/types.ts';
import { createParamBag, resolveParams, type ParamBag, type ParamInput } from './params.ts';

export const MAX_DT = 1 / 20;
const DEFAULT_SEED = 0x5eed;

export interface ChainEntry {
  readonly def: AnyEffectDef;
  /** Authored values, owned by the caller (UI, preset); re-resolved every frame. */
  readonly values: Record<string, ParamInput>;
  enabled: boolean;
  /** Live resolved params handed to the instance. */
  readonly params: ParamBag;
  readonly keys: readonly string[];
  instance: EffectInstance;
}

/** Milliseconds spent per stage in the last frame. */
export interface StageTimings {
  params: number;
  /** source -> work: plain copy, or displaced bilinear sampling. */
  sample: number;
  cell: number;
  total: number;
}

export function createPointer(): Pointer {
  return { x: -1, y: -1, vx: 0, vy: 0, inside: false, down: false, clicked: false };
}

/**
 * Owns the work buffer and the effect chain; produces one WorkBuffer per frame
 * (SPEC 10). Steady-state `frame()` does not allocate.
 */
export class Pipeline {
  readonly chain: ChainEntry[] = [];
  readonly timings: StageTimings = { params: 0, sample: 0, cell: 0, total: 0 };
  readonly ctx: FrameContext;

  private source: Field;
  private work: WorkBuffer;
  private seed: number;
  private cellFns: CellFn[] = [];
  private displaceFns: DisplaceFn[] = [];
  private readonly at: Vec2 = { x: 0, y: 0 };
  private readonly cell: CellRef = { lum: 0, alpha: 0, r: 0, g: 0, b: 0, char: 0 };

  constructor(source: Field, meta: FieldMeta, pointer: Pointer, seed = DEFAULT_SEED) {
    this.source = source;
    this.seed = seed;
    this.work = createWorkBuffer(source.cols, source.rows, { color: source.color !== null });
    this.ctx = {
      time: 0,
      dt: 0,
      frame: 0,
      cols: source.cols,
      rows: source.rows,
      cellAspect: meta.cellAspect,
      pointer,
      rand: createRand(seed),
      source,
    };
  }

  /**
   * New source: buffers are rebuilt and every effect instance is recreated, so
   * stateful effects (decode, later systems) start over on the new picture.
   */
  setSource(source: Field, meta: FieldMeta): void {
    const sameSize = source.cols === this.work.cols && source.rows === this.work.rows;
    const sameColor = (source.color !== null) === (this.work.color !== null);
    if (!sameSize || !sameColor) {
      this.work = createWorkBuffer(source.cols, source.rows, { color: source.color !== null });
    }
    this.source = source;
    const ctx = this.ctx;
    ctx.source = source;
    ctx.cols = source.cols;
    ctx.rows = source.rows;
    ctx.cellAspect = meta.cellAspect;
    this.restart();
  }

  /** Back to time 0 with the same seed: recreates instances, resets PRNG. */
  restart(): void {
    const ctx = this.ctx;
    ctx.time = 0;
    ctx.dt = 0;
    ctx.frame = 0;
    ctx.rand = createRand(this.seed);
    for (const entry of this.chain) {
      this.resolve(entry);
      entry.instance = entry.def.create(entry.params);
    }
    this.rebuild();
  }

  add(def: AnyEffectDef, values: Record<string, ParamInput> = {}): ChainEntry {
    const params = createParamBag(def.params);
    const keys = Object.keys(def.params);
    const entry: ChainEntry = {
      def,
      values,
      enabled: true,
      params,
      keys,
      instance: { kind: 'cell', apply: noopCell },
    };
    this.resolve(entry);
    entry.instance = def.create(params);
    this.chain.push(entry);
    this.rebuild();
    return entry;
  }

  remove(entry: ChainEntry): void {
    const i = this.chain.indexOf(entry);
    if (i >= 0) this.chain.splice(i, 1);
    this.rebuild();
  }

  /** Enabling is activation: the instance is recreated with fresh state. */
  setEnabled(entry: ChainEntry, enabled: boolean): void {
    if (enabled && !entry.enabled) {
      this.resolve(entry);
      entry.instance = entry.def.create(entry.params);
    }
    entry.enabled = enabled;
    this.rebuild();
  }

  /** Advances time by `dt` (clamped) and runs every stage. */
  frame(dt: number): WorkBuffer {
    const t0 = performance.now();
    const ctx = this.ctx;
    ctx.dt = dt < 0 ? 0 : dt > MAX_DT ? MAX_DT : dt;
    ctx.time += ctx.dt;
    ctx.frame++;

    for (let e = 0; e < this.chain.length; e++) {
      const entry = this.chain[e]!;
      if (entry.enabled) this.resolve(entry);
    }
    const t1 = performance.now();

    if (this.displaceFns.length > 0) this.runDisplace();
    else copyFieldToWork(this.source, this.work);
    const t2 = performance.now();

    if (this.cellFns.length > 0) this.runCells();
    const t3 = performance.now();

    const tm = this.timings;
    tm.params = t1 - t0;
    tm.sample = t2 - t1;
    tm.cell = t3 - t2;
    tm.total = t3 - t0;

    // One-frame pulse: consumed by this frame's effects.
    ctx.pointer.clicked = false;
    return this.work;
  }

  private resolve(entry: ChainEntry): void {
    resolveParams(entry.def.params, entry.keys, entry.values, this.ctx, entry.params);
  }

  /** Flat lists of enabled stage functions; rebuilt on chain edits, not per frame. */
  private rebuild(): void {
    const cells: CellFn[] = [];
    const displaces: DisplaceFn[] = [];
    for (const entry of this.chain) {
      if (!entry.enabled) continue;
      const inst = entry.instance;
      if (inst.kind === 'cell') cells.push(inst.apply);
      else if (inst.kind === 'displace') displaces.push(inst.apply);
    }
    this.cellFns = cells;
    this.displaceFns = displaces;
  }

  /**
   * Displace stage (SPEC 6.1): every displace fn moves the sample point in
   * turn, then lum/alpha/colour are sampled bilinearly from the source (edge
   * clamp) and authored chars nearest. Weights are computed once per cell for
   * all channels; nothing here calls a function with double arguments
   * (DECISIONS 013) except the displace fns, which receive integers.
   */
  private runDisplace(): void {
    const { work, source, displaceFns, ctx, at } = this;
    const { cols, rows } = work;
    const sLum = source.lum;
    const sAlpha = source.alpha;
    const sColor = source.color;
    const sChar = source.char;
    const wColor = work.color;
    const maxX = cols - 1;
    const maxY = rows - 1;
    const nFns = displaceFns.length;

    work.charOverride.fill(0);

    // Hot loop: sample indices are clamped into the grid, fn index < nFns.
    let i = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        at.x = x;
        at.y = y;
        for (let f = 0; f < nFns; f++) displaceFns[f]!(x, y, ctx, at);

        // Math.min/max keep these float64 throughout; a ternary mixing the Smi
        // 0 with a double makes Maglev box the result (DECISIONS 013).
        const sx = Math.min(Math.max(at.x, 0), maxX);
        const sy = Math.min(Math.max(at.y, 0), maxY);
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = x0 < maxX ? x0 + 1 : x0;
        const y1 = y0 < maxY ? y0 + 1 : y0;
        const fx = sx - x0;
        const fy = sy - y0;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        const i00 = y0 * cols + x0;
        const i10 = y0 * cols + x1;
        const i01 = y1 * cols + x0;
        const i11 = y1 * cols + x1;

        work.lum[i] = sLum[i00]! * w00 + sLum[i10]! * w10 + sLum[i01]! * w01 + sLum[i11]! * w11;
        work.alpha[i] =
          sAlpha[i00]! * w00 + sAlpha[i10]! * w10 + sAlpha[i01]! * w01 + sAlpha[i11]! * w11;

        if (wColor !== null && sColor !== null) {
          for (let k = 0; k < 3; k++) {
            wColor[i * 3 + k] =
              sColor[i00 * 3 + k]! * w00 +
              sColor[i10 * 3 + k]! * w10 +
              sColor[i01 * 3 + k]! * w01 +
              sColor[i11 * 3 + k]! * w11;
          }
        }

        // Authored glyphs cannot be blended: take the nearest one.
        work.char[i] = sChar === null ? 0 : sChar[(fy < 0.5 ? y0 : y1) * cols + (fx < 0.5 ? x0 : x1)]!;
      }
    }
  }

  /** One reusable CellRef per frame (SPEC 6.2); `char` maps to charOverride. */
  private runCells(): void {
    const { work, cell, cellFns, ctx } = this;
    const { lum, alpha, color, charOverride, cols, rows } = work;
    const nFns = cellFns.length;

    // Hot loop: indices bounded by cols*rows, fn index by nFns.
    let i = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        cell.lum = lum[i]!;
        cell.alpha = alpha[i]!;
        cell.char = charOverride[i]!;
        if (color !== null) {
          cell.r = color[i * 3]!;
          cell.g = color[i * 3 + 1]!;
          cell.b = color[i * 3 + 2]!;
        }

        for (let f = 0; f < nFns; f++) cellFns[f]!(cell, x, y, ctx);

        lum[i] = cell.lum;
        alpha[i] = cell.alpha;
        charOverride[i] = cell.char;
        if (color !== null) {
          color[i * 3] = cell.r;
          color[i * 3 + 1] = cell.g;
          color[i * 3 + 2] = cell.b;
        }
      }
    }
  }
}

function noopCell(): void {}
