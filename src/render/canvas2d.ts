import type { FieldMeta, Polarity, WorkBuffer } from '../core/field.ts';
import type { FontSpec, QuantizeMode, Ramp } from '../core/ramp.ts';
import { getAtlas, type GlyphAtlas } from './atlas.ts';
import { parseHex } from '../core/color.ts';
import { Compositor } from './compositor.ts';
import type { Renderer } from './renderer.ts';

/** Hex colours, `#rgb` or `#rrggbb`. */
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
  private compositor: Compositor | null = null;
  private image: ImageData | null = null;
  private atlas: GlyphAtlas | null = null;
  // Theme the compositor palette was built for; rebuilt on change only.
  private paletteFor: ThemeColors | null = null;
  // Even-size padding strip still needs the background colour.
  private padDirty = false;

  constructor(canvas: HTMLCanvasElement, opts: Canvas2DOptions) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2DRenderer: no 2d context');
    this.canvas = canvas;
    this.ctx = ctx;
    this.opts = opts;
  }

  setOptions(patch: Partial<Canvas2DOptions>): void {
    this.opts = { ...this.opts, ...patch };
    this.paletteFor = null;
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
    const cell = fitCell(maxW, maxH, cellAspect);

    const same =
      this.compositor !== null &&
      cols === this.cols &&
      rows === this.rows &&
      cell.w === this.cell.w &&
      cell.h === this.cell.h;
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;

    const pw = cols * cell.w;
    const ph = rows * cell.h;
    // Video encoders (H.264 4:2:0) need even frame sizes: pad the canvas by a
    // pixel of background where the grid is odd.
    const cw = pw + (pw & 1);
    const ch = ph + (ph & 1);
    this.canvas.style.width = `${cw / dpr}px`;
    this.canvas.style.height = `${ch / dpr}px`;
    if (same) return;

    // Setting the canvas size clears it, so everything is redrawn.
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.padDirty = true;
    this.compositor = new Compositor(cols, rows, cell.w, cell.h);
    this.image = new ImageData(this.compositor.pixels, pw, ph);
    this.paletteFor = null;
    this.atlas = null;
  }

  render(work: WorkBuffer, ramp: Ramp, meta: FieldMeta): void {
    const { compositor, image } = this;
    if (compositor === null || image === null) throw new Error('Canvas2DRenderer: resize first');
    if (work.cols !== this.cols || work.rows !== this.rows) {
      throw new Error(
        `Canvas2DRenderer: buffer ${work.cols}x${work.rows}, renderer ${this.cols}x${this.rows}`,
      );
    }

    const theme = this.opts.themes[meta.polarity];
    // Repaint the padding after a resize or a theme change.
    if (this.paletteFor !== theme) this.padDirty = true;
    const padded = this.canvas.width !== compositor.width || this.canvas.height !== compositor.height;
    if (padded && this.padDirty) {
      this.ctx.fillStyle = theme.bg;
      this.ctx.fillRect(compositor.width, 0, this.canvas.width - compositor.width, this.canvas.height);
      this.ctx.fillRect(0, compositor.height, this.canvas.width, this.canvas.height - compositor.height);
      this.padDirty = false;
    }
    if (this.paletteFor !== theme) {
      compositor.setColors(parseHex(theme.bg), parseHex(theme.fg));
      this.paletteFor = theme;
    }

    // Masks are colour-free: a palette change alone keeps the atlas.
    this.atlas ??= getAtlas(this.font);
    const atlas = this.atlas;
    const { useSourceChars, quantizeMode } = this.opts;
    compositor.compose(work, ramp, meta.polarity, useSourceChars, quantizeMode, atlas);

    const { dirtyTop, dirtyBottom } = compositor;
    if (dirtyBottom > dirtyTop) {
      this.ctx.putImageData(image, 0, 0, 0, dirtyTop, compositor.width, dirtyBottom - dirtyTop);
    }
  }

  dispose(): void {
    this.compositor = null;
    this.atlas = null;
    this.image = null;
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
