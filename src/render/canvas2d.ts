import type { FieldMeta, Polarity, WorkBuffer } from '../core/field.ts';
import type { FontSpec, QuantizeMode, Ramp } from '../core/ramp.ts';
import { getAtlas, type GlyphAtlas } from './atlas.ts';
import { ALPHA_EPS, resolveCellChar } from './cell-char.ts';
import type { Renderer } from './renderer.ts';

export interface ThemeColors {
  bg: string;
  fg: string;
}

export interface Canvas2DOptions {
  family: string;
  weight: number;
  themes: Record<Polarity, ThemeColors>;
  /** Authored `char` wins over the ramp only when set (DECISIONS 007). */
  useSourceChars: boolean;
  quantizeMode: QuantizeMode;
}

export interface CellSize {
  w: number;
  h: number;
}

// Largest acceptable relative error between drawn and requested cell aspect.
const ASPECT_TOLERANCE = 0.02;

/**
 * Largest integral cell (physical pixels) that fits `maxW x maxH` while keeping
 * w/h within tolerance of `aspect`. Naive rounding of a small cell distorts the
 * picture by up to ~10%; this trades a little size for proportion.
 */
export function fitCell(maxW: number, maxH: number, aspect: number): CellSize {
  let best: CellSize = { w: 1, h: 1 };
  let bestErr = Infinity;
  for (let h = Math.max(1, Math.floor(maxH)); h >= 1; h--) {
    const w = Math.round(h * aspect);
    if (w < 1 || w > maxW) continue;
    const err = Math.abs(w / h - aspect) / aspect;
    if (err <= ASPECT_TOLERANCE) return { w, h };
    if (err < bestErr) {
      bestErr = err;
      best = { w, h };
    }
  }
  return best;
}

export class Canvas2DRenderer implements Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private opts: Canvas2DOptions;
  private cols = 0;
  private rows = 0;
  private cell: CellSize = { w: 1, h: 1 };
  // Atlas for the current cell, font and ink colour; refreshed on change only.
  private atlas: GlyphAtlas | null = null;
  private atlasInk = '';

  constructor(canvas: HTMLCanvasElement, opts: Canvas2DOptions) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2DRenderer: no 2d context');
    this.canvas = canvas;
    this.ctx = ctx;
    this.opts = opts;
  }

  setOptions(patch: Partial<Canvas2DOptions>): void {
    this.opts = { ...this.opts, ...patch };
    this.atlas = null;
  }

  /** Physical cell font; measure ramps with this so densities match the atlas. */
  get font(): FontSpec {
    return {
      family: this.opts.family,
      weight: this.opts.weight,
      cellW: this.cell.w,
      cellH: this.cell.h,
    };
  }

  /** Fits the grid into the canvas's parent element. */
  resize(cols: number, rows: number, cellAspect: number): void {
    const parent = this.canvas.parentElement;
    if (!parent) throw new Error('Canvas2DRenderer: canvas has no parent');

    const dpr = window.devicePixelRatio || 1;
    const maxW = Math.floor((parent.clientWidth * dpr) / cols);
    const maxH = Math.floor((parent.clientHeight * dpr) / rows);

    this.cols = cols;
    this.rows = rows;
    this.cell = fitCell(maxW, maxH, cellAspect);
    this.atlas = null;

    const pw = cols * this.cell.w;
    const ph = rows * this.cell.h;
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.canvas.style.width = `${pw / dpr}px`;
    this.canvas.style.height = `${ph / dpr}px`;
    // Resizing resets context state.
    this.ctx.imageSmoothingEnabled = false;
  }

  render(work: WorkBuffer, ramp: Ramp, meta: FieldMeta): void {
    if (work.cols !== this.cols || work.rows !== this.rows) {
      throw new Error(
        `Canvas2DRenderer: buffer ${work.cols}x${work.rows}, renderer ${this.cols}x${this.rows}`,
      );
    }

    const { ctx } = this;
    const { useSourceChars, quantizeMode } = this.opts;
    const theme = this.opts.themes[meta.polarity];
    const cw = this.cell.w;
    const ch = this.cell.h;
    const atlas = this.atlasFor(theme.fg);
    const sheet = atlas.canvas;

    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const { alpha } = work;
    const polarity = meta.polarity;
    let currentAlpha = 1;

    // Hot loop: no allocations. Indices are bounded by cols*rows of `work`.
    let i = 0;
    for (let y = 0; y < this.rows; y++) {
      const dy = y * ch;
      for (let x = 0; x < this.cols; x++, i++) {
        const a = alpha[i]!;
        if (a < ALPHA_EPS) continue;

        const code = resolveCellChar(work, i, ramp, polarity, useSourceChars, quantizeMode);

        const slot = atlas.slot(code);
        if (slot < 0) continue;

        const ga = a > 1 ? 1 : a;
        if (ga !== currentAlpha) {
          ctx.globalAlpha = ga;
          currentAlpha = ga;
        }
        ctx.drawImage(sheet, atlas.slotX(slot), atlas.slotY(slot), cw, ch, x * cw, dy, cw, ch);
      }
    }

    ctx.globalAlpha = 1;
  }

  private atlasFor(ink: string): GlyphAtlas {
    if (this.atlas === null || this.atlasInk !== ink) {
      this.atlas = getAtlas({ ...this.font, color: ink });
      this.atlasInk = ink;
    }
    return this.atlas;
  }

  dispose(): void {
    this.atlas = null;
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
