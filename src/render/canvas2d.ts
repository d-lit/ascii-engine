import type { FieldMeta, Polarity, WorkBuffer } from '../core/field.ts';
import type { FontSpec, QuantizeMode, Ramp } from '../core/ramp.ts';
import { getAtlas, type GlyphAtlas } from './atlas.ts';
import { parseHex } from '../core/color.ts';
import { DEFAULT_CROP, type Crop, type PlacedRect } from '../core/placement.ts';
import { paintFrame, prepareBackdrop, type Backdrop, type BackdropImage, type Rect } from './backdrop.ts';
import { Compositor } from './compositor.ts';
import { SpriteLayer } from './sprite-layer.ts';
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

export interface FrameLayout {
  cellW: number;
  cellH: number;
  /** Grid offset inside the frame, pixels; the rest is background. */
  offsetX: number;
  offsetY: number;
}

/**
 * Largest aspect-correct integral cell that fits the grid into `width x
 * height`, grid centred (letterboxed). Offsets are even so the grid sits on
 * the same pixel grid as the encoder's chroma blocks.
 */
export function layoutFrame(cols: number, rows: number, cellAspect: number, width: number, height: number): FrameLayout {
  const cell = fitCell(Math.floor(width / cols), Math.floor(height / rows), cellAspect);
  const offsetX = ((width - cols * cell.w) >> 2) * 2;
  const offsetY = ((height - rows * cell.h) >> 2) * 2;
  return { cellW: cell.w, cellH: cell.h, offsetX, offsetY };
}

/**
 * Grid stretched over a whole `width x height` frame: integral cells as
 * close as possible to `width / cols` x `height / rows`; the glyph layer is
 * scaled to the frame by a few percent at most. For a fixed canvas, whose
 * rows already follow its aspect (task 015).
 */
export function fillFrame(cols: number, rows: number, width: number, height: number): FrameLayout {
  return {
    cellW: Math.max(1, Math.round(width / cols)),
    cellH: Math.max(1, Math.round(height / rows)),
    offsetX: 0,
    offsetY: 0,
  };
}

/** Largest even-sized `w x h` with the aspect of `frameW x frameH` inside `maxW x maxH`. */
export function fitFrame(frameW: number, frameH: number, maxW: number, maxH: number): { w: number; h: number } {
  const s = Math.min(maxW / frameW, maxH / frameH);
  return { w: Math.max(2, Math.floor((frameW * s) / 2) * 2), h: Math.max(2, Math.floor((frameH * s) / 2) * 2) };
}

/** Where the source picture lies, `rect` in grid fractions, mapped to frame pixels. */
export function pictureRect(grid: Rect, rect: PlacedRect): Rect {
  return { x: grid.x + rect.x * grid.w, y: grid.y + rect.y * grid.h, w: rect.w * grid.w, h: rect.h * grid.h };
}

export class Canvas2DRenderer implements Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  // Glyph layer: transparent where there is no ink (DECISIONS 020).
  private readonly layer: HTMLCanvasElement;
  private readonly layerCtx: CanvasRenderingContext2D;
  private opts: Canvas2DOptions;
  private backdrop: Backdrop = { kind: 'theme' };
  private backdropImage: BackdropImage | null = null;
  private backdropCrop: Crop = DEFAULT_CROP;
  // Static part of the frame (fill or prepared image), rebuilt on change only.
  private readonly under: HTMLCanvasElement = document.createElement('canvas');
  private underDirty = true;
  private cols = 0;
  private rows = 0;
  private cell: CellSize = { w: 1, h: 1 };
  // Size the glyph layer is drawn at; differs from the layer when it fills a fixed frame.
  private drawW = 0;
  private drawH = 0;
  // Where the source picture lies, in grid fractions; `grid` backdrops follow it.
  private pictureFrac: PlacedRect = { x: 0, y: 0, w: 1, h: 1 };
  private compositor: Compositor | null = null;
  private image: ImageData | null = null;
  // Sprites over the glyph layer (SPEC 6.3); same size as the glyph layer.
  private readonly spriteCanvas: HTMLCanvasElement = document.createElement('canvas');
  private spriteCtx: CanvasRenderingContext2D | null = null;
  private sprites: SpriteLayer | null = null;
  private spriteImage: ImageData | null = null;
  // The sprite canvas holds something: drawn with the frame.
  private spritesShown = false;
  private atlas: GlyphAtlas | null = null;
  // Theme the ink palette was built for; rebuilt on change only.
  private inkFor: ThemeColors | null = null;
  // The frame needs repainting even if no cell changed (backdrop, resize).
  private frameDirty = true;

  constructor(canvas: HTMLCanvasElement, opts: Canvas2DOptions) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas2DRenderer: no 2d context');
    this.layer = document.createElement('canvas');
    const layerCtx = this.layer.getContext('2d', { alpha: true });
    if (!layerCtx) throw new Error('Canvas2DRenderer: no 2d context');
    this.canvas = canvas;
    this.ctx = ctx;
    this.layerCtx = layerCtx;
    this.opts = opts;
  }

  setOptions(patch: Partial<Canvas2DOptions>): void {
    this.opts = { ...this.opts, ...patch };
    this.inkFor = null;
    this.atlas = null;
  }

  /** `image` is used by image backdrops; it is session state, never stored. */
  setBackdrop(backdrop: Backdrop, image: BackdropImage | null = null, crop: Crop = DEFAULT_CROP): void {
    this.backdrop = backdrop;
    this.backdropImage = image;
    this.backdropCrop = { ...crop };
    this.underDirty = true;
    this.frameDirty = true;
    // Checkerboard behind transparent pixels, on screen only.
    this.canvas.classList.toggle('transparent', backdrop.kind === 'transparent');
  }

  /** Source picture placement in grid fractions (task 015). */
  setPicture(rect: PlacedRect): void {
    const p = this.pictureFrac;
    if (p.x === rect.x && p.y === rect.y && p.w === rect.w && p.h === rect.h) return;
    this.pictureFrac = { ...rect };
    this.underDirty = true;
    this.frameDirty = true;
  }

  get picture(): PlacedRect {
    return { ...this.pictureFrac };
  }

  /** Grid rectangle inside the canvas, physical pixels. */
  get gridRect(): Rect {
    return { x: 0, y: 0, w: this.drawW, h: this.drawH };
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

  /**
   * Fits the picture into the canvas's parent element. Without `frame` the
   * canvas is the grid; with it the canvas has the frame's aspect and the
   * grid fills it (`fillFrame`).
   */
  resize(cols: number, rows: number, cellAspect: number, frame: { width: number; height: number } | null = null): void {
    const parent = this.canvas.parentElement;
    if (!parent) throw new Error('Canvas2DRenderer: canvas has no parent');

    const dpr = window.devicePixelRatio || 1;
    const maxW = parent.clientWidth * dpr;
    const maxH = parent.clientHeight * dpr;
    let cell: CellSize;
    let cw: number;
    let ch: number;
    if (frame === null) {
      cell = fitCell(Math.floor(maxW / cols), Math.floor(maxH / rows), cellAspect);
      const pw = cols * cell.w;
      const ph = rows * cell.h;
      // Video encoders (H.264 4:2:0) need even frame sizes: the frame is padded
      // by a pixel of backdrop where the grid is odd.
      cw = pw + (pw & 1);
      ch = ph + (ph & 1);
    } else {
      const size = fitFrame(frame.width, frame.height, maxW, maxH);
      cw = size.w;
      ch = size.h;
      const layout = fillFrame(cols, rows, cw, ch);
      cell = { w: layout.cellW, h: layout.cellH };
    }
    const pw = cols * cell.w;
    const ph = rows * cell.h;
    const drawW = frame === null ? pw : cw;
    const drawH = frame === null ? ph : ch;

    const same =
      this.compositor !== null &&
      cols === this.cols &&
      rows === this.rows &&
      cell.w === this.cell.w &&
      cell.h === this.cell.h &&
      cw === this.canvas.width &&
      ch === this.canvas.height &&
      drawW === this.drawW &&
      drawH === this.drawH;
    this.cols = cols;
    this.rows = rows;
    this.cell = cell;
    this.drawW = drawW;
    this.drawH = drawH;
    this.canvas.style.width = `${cw / dpr}px`;
    this.canvas.style.height = `${ch / dpr}px`;
    if (same) return;

    // Setting a canvas size clears it, so everything is redrawn.
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.layer.width = pw;
    this.layer.height = ph;
    this.under.width = cw;
    this.under.height = ch;
    this.underDirty = true;
    this.compositor = new Compositor(cols, rows, cell.w, cell.h);
    this.image = new ImageData(this.compositor.pixels, pw, ph);
    this.spriteCanvas.width = pw;
    this.spriteCanvas.height = ph;
    this.spriteCtx = this.spriteCanvas.getContext('2d', { alpha: true });
    this.sprites = new SpriteLayer(pw, ph, cell.w, cell.h);
    this.spriteImage = new ImageData(this.sprites.pixels, pw, ph);
    this.spritesShown = false;
    this.inkFor = null;
    this.atlas = null;
    this.frameDirty = true;
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
    if (this.inkFor !== theme) {
      const ink = parseHex(theme.fg);
      compositor.setInk(ink);
      this.sprites?.setInk(ink);
      this.inkFor = theme;
      this.underDirty = true; // the theme backdrop colour may have changed too
      this.frameDirty = true;
    }

    // Masks are colour-free: an ink change alone keeps the atlas.
    this.atlas ??= getAtlas(this.font);
    const { useSourceChars, quantizeMode } = this.opts;
    compositor.compose(work, ramp, meta.polarity, useSourceChars, quantizeMode, this.atlas);

    const { dirtyTop, dirtyBottom } = compositor;
    let layerDirty = dirtyBottom > dirtyTop;
    if (layerDirty) {
      this.layerCtx.putImageData(image, 0, 0, 0, dirtyTop, compositor.width, dirtyBottom - dirtyTop);
    }
    // Sprites: drawn while there are some, and once more to clear the last ones.
    const sprites = this.sprites;
    if (sprites !== null && this.spriteCtx !== null && this.spriteImage !== null && (work.sprites.count > 0 || this.spritesShown)) {
      sprites.draw(work, ramp, meta.polarity, useSourceChars, quantizeMode, this.atlas);
      if (sprites.dirty) {
        this.spriteCtx.putImageData(this.spriteImage, 0, 0, sprites.dirtyX, sprites.dirtyY, sprites.dirtyW, sprites.dirtyH);
        layerDirty = true;
      }
      this.spritesShown = work.sprites.count > 0;
    }
    if (this.underDirty) {
      prepareBackdrop(this.under, this.backdrop, theme.bg, this.backdropImage, pictureRect(this.gridRect, this.pictureFrac), this.backdropCrop);
      this.underDirty = false;
    }
    if (layerDirty || this.frameDirty) {
      paintFrame(this.ctx, this.layer, this.under, 0, 0, this.drawW, this.drawH, this.spriteCanvas);
      this.frameDirty = false;
    }
  }

  dispose(): void {
    this.compositor = null;
    this.atlas = null;
    this.image = null;
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.layer.width = 0;
    this.layer.height = 0;
  }
}
