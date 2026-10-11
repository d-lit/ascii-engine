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
import { createMaskScratch, fillMask, type MaskScratch, type MaskSpec } from './mask.ts';
import {
  createParamBag,
  resolveNumber,
  resolveParams,
  type NumberSpec,
  type ParamBag,
  type ParamInput,
  type ParamValue,
} from './params.ts';

export const MAX_DT = 1 / 20;
const DEFAULT_SEED = 0x5eed;
const MIX_SPEC: NumberSpec = { type: 'number', min: 0, max: 1, default: 1 };

export interface ChainEntry {
  readonly def: AnyEffectDef;
  /** Authored values, owned by the caller (UI, preset); re-resolved every frame. */
  readonly values: Record<string, ParamInput>;
  enabled: boolean;
  /** Live resolved params handed to the instance. */
  readonly params: ParamBag;
  readonly keys: readonly string[];
  instance: EffectInstance;
  /** ctx.time when the effect was last activated; LFO/envelope clock origin. */
  activatedAt: number;
  /** Strength 0..1, may be modulated; set directly, re-resolved every frame. */
  mix: ParamValue;
  /** Where the effect applies; change through Pipeline.setMask (it owns the buffer). */
  readonly mask: MaskSpec | null;
}

export interface AddOptions {
  mix?: ParamValue;
  mask?: MaskSpec | null;
}

/** Engine-side state of an entry, kept out of the public shape. */
interface EntryState {
  maskBuf: Float32Array | null;
  readonly scratch: MaskScratch;
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
  private readonly state = new Map<ChainEntry, EntryState>();
  // Per-stage lists aligned by index: entry, fn, this frame's mix and mask.
  private cellEntries: ChainEntry[] = [];
  private cellFns: CellFn[] = [];
  private cellMix = new Float64Array(0);
  private cellMasks: Array<Float32Array | null> = [];
  private displaceEntries: ChainEntry[] = [];
  private displaceFns: DisplaceFn[] = [];
  private displaceMix = new Float64Array(0);
  private displaceMasks: Array<Float32Array | null> = [];
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
    for (const entry of this.chain) this.allocMask(entry);
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
      entry.activatedAt = 0;
      this.resolve(entry);
      entry.instance = entry.def.create(entry.params);
    }
    this.rebuild();
  }

  add(
    def: AnyEffectDef,
    values: Record<string, ParamInput> = {},
    opts: AddOptions = {},
  ): ChainEntry {
    const params = createParamBag(def.params);
    const keys = Object.keys(def.params);
    const entry: ChainEntry = {
      def,
      values,
      enabled: true,
      params,
      keys,
      instance: { kind: 'cell', apply: noopCell },
      activatedAt: this.ctx.time,
      mix: opts.mix ?? 1,
      mask: opts.mask ?? null,
    };
    this.state.set(entry, { maskBuf: null, scratch: createMaskScratch() });
    this.allocMask(entry);
    this.resolve(entry);
    entry.instance = def.create(params);
    this.chain.push(entry);
    this.rebuild();
    return entry;
  }

  remove(entry: ChainEntry): void {
    const i = this.chain.indexOf(entry);
    if (i >= 0) this.chain.splice(i, 1);
    this.state.delete(entry);
    this.rebuild();
  }

  /** Moves an entry to `index` in the chain (order = application order). */
  move(entry: ChainEntry, index: number): void {
    const from = this.chain.indexOf(entry);
    if (from < 0) return;
    this.chain.splice(from, 1);
    const to = Math.max(0, Math.min(this.chain.length, index));
    this.chain.splice(to, 0, entry);
    this.rebuild();
  }

  setMask(entry: ChainEntry, mask: MaskSpec | null): void {
    (entry as { mask: MaskSpec | null }).mask = mask;
    this.allocMask(entry);
    this.rebuild();
  }

  /** Enabling is activation: the instance is recreated with fresh state. */
  setEnabled(entry: ChainEntry, enabled: boolean): void {
    if (enabled && !entry.enabled) {
      entry.activatedAt = this.ctx.time;
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
    this.resolveWeights(this.cellEntries, this.cellMix);
    this.resolveWeights(this.displaceEntries, this.displaceMix);
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
    const t = this.ctx.time - entry.activatedAt;
    resolveParams(entry.def.params, entry.keys, entry.values, this.ctx, entry.params, t);
  }

  private allocMask(entry: ChainEntry): void {
    const st = this.state.get(entry);
    if (st === undefined) return;
    const n = this.source.cols * this.source.rows;
    if (entry.mask === null) st.maskBuf = null;
    else if (st.maskBuf === null || st.maskBuf.length !== n) st.maskBuf = new Float32Array(n);
  }

  /** Per frame: mix values and mask buffers for one stage's entries. */
  private resolveWeights(entries: readonly ChainEntry[], mix: Float64Array): void {
    const ctx = this.ctx;
    for (let f = 0; f < entries.length; f++) {
      const entry = entries[f]!;
      const t = ctx.time - entry.activatedAt;
      mix[f] = resolveNumber(MIX_SPEC, entry.mix, t);
      const st = this.state.get(entry);
      if (entry.mask !== null && st !== undefined && st.maskBuf !== null) {
        fillMask(entry.mask, this.source, ctx, t, st.scratch, st.maskBuf);
      }
    }
  }

  /** Flat per-stage lists of enabled effects; rebuilt on chain edits, not per frame. */
  private rebuild(): void {
    const cellEntries: ChainEntry[] = [];
    const cellFns: CellFn[] = [];
    const cellMasks: Array<Float32Array | null> = [];
    const displaceEntries: ChainEntry[] = [];
    const displaceFns: DisplaceFn[] = [];
    const displaceMasks: Array<Float32Array | null> = [];
    for (const entry of this.chain) {
      if (!entry.enabled) continue;
      const inst = entry.instance;
      const mask = this.state.get(entry)?.maskBuf ?? null;
      if (inst.kind === 'cell') {
        cellEntries.push(entry);
        cellFns.push(inst.apply);
        cellMasks.push(mask);
      } else if (inst.kind === 'displace') {
        displaceEntries.push(entry);
        displaceFns.push(inst.apply);
        displaceMasks.push(mask);
      }
    }
    this.cellEntries = cellEntries;
    this.cellFns = cellFns;
    this.cellMasks = cellMasks;
    this.cellMix = new Float64Array(cellFns.length).fill(1);
    this.displaceEntries = displaceEntries;
    this.displaceFns = displaceFns;
    this.displaceMasks = displaceMasks;
    this.displaceMix = new Float64Array(displaceFns.length).fill(1);
  }

  /**
   * Displace stage (SPEC 6.1): every displace fn moves the sample point in
   * turn, then lum/alpha/colour are sampled bilinearly from the source (edge
   * clamp) and authored chars nearest. Weights are computed once per cell for
   * all channels; nothing here calls a function with double arguments
   * (DECISIONS 013) except the displace fns, which receive integers.
   */
  private runDisplace(): void {
    const { work, source, displaceFns, displaceMix, displaceMasks, ctx, at } = this;
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
        for (let f = 0; f < nFns; f++) {
          // Weight = mix * mask (SPEC 6.4): 0 skips, 1 is the plain call,
          // in between scales this effect's displacement.
          const mask = displaceMasks[f]!;
          const w = mask === null ? displaceMix[f]! : displaceMix[f]! * mask[i]!;
          if (w <= 0) continue;
          if (w >= 1) {
            displaceFns[f]!(x, y, ctx, at);
            continue;
          }
          const bx = at.x;
          const by = at.y;
          displaceFns[f]!(x, y, ctx, at);
          at.x = bx + (at.x - bx) * w;
          at.y = by + (at.y - by) * w;
        }

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
    const { work, cell, cellFns, cellMix, cellMasks, ctx } = this;
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

        for (let f = 0; f < nFns; f++) {
          // Weight = mix * mask (SPEC 6.4): 0 skips, 1 is the plain call, in
          // between blends numeric fields; char follows the stronger side.
          const mask = cellMasks[f]!;
          const w = mask === null ? cellMix[f]! : cellMix[f]! * mask[i]!;
          if (w <= 0) continue;
          if (w >= 1) {
            cellFns[f]!(cell, x, y, ctx);
            continue;
          }
          const bl = cell.lum;
          const ba = cell.alpha;
          const br = cell.r;
          const bg = cell.g;
          const bb = cell.b;
          const bc = cell.char;
          cellFns[f]!(cell, x, y, ctx);
          cell.lum = bl + (cell.lum - bl) * w;
          cell.alpha = ba + (cell.alpha - ba) * w;
          cell.r = br + (cell.r - br) * w;
          cell.g = bg + (cell.g - bg) * w;
          cell.b = bb + (cell.b - bb) * w;
          if (w <= 0.5) cell.char = bc;
        }

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
