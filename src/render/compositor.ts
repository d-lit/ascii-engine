import type { Polarity, WorkBuffer } from '../core/field.ts';
import type { QuantizeMode, Ramp } from '../core/ramp.ts';
import type { Rgb } from '../core/color.ts';
import { resolveCellChar } from './cell-char.ts';

/** Coverage masks, one `cellW*cellH` byte tile per slot (0..255). */
export interface MaskSource {
  readonly cellW: number;
  readonly cellH: number;
  /** Slot for a charCode, or -1 when there is nothing to draw. May grow `data`. */
  slot(code: number): number;
  /** Re-read after `slot()`: growing replaces the array. */
  readonly data: Uint8Array;
}


// Alpha is quantized to this many steps; finer steps are invisible on a glyph.
const ALPHA_STEPS = 64;
// Marks a cell as needing a redraw whatever its new state.
const STALE = 0xffff;

/** Integer alpha scale 0..256 so that (coverage * scale) >> 8 stays 0..255. */
export function alphaScale(a: number): number {
  if (a >= 1) return 256;
  if (a <= 0) return 0;
  return Math.round(a * ALPHA_STEPS) * (256 / ALPHA_STEPS);
}

// Pixel packing into the Uint32 view: RGBA bytes in memory order on any platform.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const SHIFT_R = LITTLE_ENDIAN ? 0 : 24;
const SHIFT_G = LITTLE_ENDIAN ? 8 : 16;
const SHIFT_B = LITTLE_ENDIAN ? 16 : 8;
const OPAQUE = LITTLE_ENDIAN ? 0xff << 24 : 0xff;
// Colour path: coverage*alpha is quantized to this many levels per cell, so a
// changed cell builds a tiny palette instead of blending every pixel.
const INK_LEVELS = 32;
const INK_SHIFT = 11; // (coverage 0..255 * scale 0..256) >> 11 -> 0..32

/**
 * Software glyph compositor (DECISIONS 014). Writes cells straight into an RGBA
 * buffer through a 256-entry bg->fg palette and skips cells whose glyph and
 * alpha did not change since the previous frame. DOM-free: the renderer wraps
 * `pixels` in an ImageData and puts only the dirty row band.
 */
export class Compositor {
  readonly cols: number;
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  /** Dirty band of the last compose, in pixel rows; top >= bottom means clean. */
  dirtyTop = 0;
  dirtyBottom = 0;

  private readonly px: Uint32Array;
  private readonly palette = new Uint32Array(256);
  private readonly prevCode: Uint16Array;
  private readonly prevAlpha: Uint16Array;
  // Colour path (DECISIONS 015): per-cell ink change key, 5 bits per channel.
  private readonly prevInk: Int32Array;
  private readonly bg = new Int32Array(3);
  private readonly inkPalette = new Int32Array(INK_LEVELS + 1);
  private lastColored = false;

  constructor(cols: number, rows: number, cellW: number, cellH: number) {
    this.cols = cols;
    this.rows = rows;
    this.cellW = cellW;
    this.cellH = cellH;
    this.width = cols * cellW;
    this.height = rows * cellH;
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
    this.px = new Uint32Array(this.pixels.buffer);
    this.prevCode = new Uint16Array(cols * rows).fill(STALE);
    this.prevAlpha = new Uint16Array(cols * rows);
    this.prevInk = new Int32Array(cols * rows);
  }

  /** Rebuilds the palette; every cell is redrawn on the next compose. */
  setColors(bg: Rgb, fg: Rgb): void {
    // Byte view keeps the packing independent of platform endianness.
    const bytes = new Uint8Array(this.palette.buffer);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      bytes[i * 4] = Math.round(bg[0] + (fg[0] - bg[0]) * t);
      bytes[i * 4 + 1] = Math.round(bg[1] + (fg[1] - bg[1]) * t);
      bytes[i * 4 + 2] = Math.round(bg[2] + (fg[2] - bg[2]) * t);
      bytes[i * 4 + 3] = 255;
    }
    this.bg[0] = bg[0];
    this.bg[1] = bg[1];
    this.bg[2] = bg[2];
    this.invalidate();
  }

  invalidate(): void {
    this.prevCode.fill(STALE);
  }

  compose(
    work: WorkBuffer,
    ramp: Ramp,
    polarity: Polarity,
    useSourceChars: boolean,
    mode: QuantizeMode,
    masks: MaskSource,
  ): void {
    const colored = work.color !== null;
    if (colored !== this.lastColored) {
      this.lastColored = colored;
      this.invalidate();
    }
    if (colored) {
      this.composeColor(work, ramp, polarity, useSourceChars, mode, masks);
      return;
    }

    const { cols, rows, cellW, cellH, width, px, palette, prevCode, prevAlpha } = this;
    const alpha = work.alpha;
    const bg = palette[0]!;
    const tile = cellW * cellH;
    let top = -1;
    let bottom = -1;

    // Hot loop: indices bounded by cols*rows, tile offsets by the mask size.
    let i = 0;
    for (let y = 0; y < rows; y++) {
      const rowBase = y * cellH * width;
      for (let x = 0; x < cols; x++, i++) {
        const code = resolveCellChar(work, i, ramp, polarity, useSourceChars, mode);
        const slot = code === 0 ? -1 : masks.slot(code);
        const scale = slot < 0 ? 0 : alphaScale(alpha[i]!);
        // Empty and fully transparent cells look the same: store them alike.
        const key = scale === 0 ? 0 : code;
        if (key === prevCode[i] && scale === prevAlpha[i]) continue;
        prevCode[i] = key;
        prevAlpha[i] = scale;
        if (top < 0) top = y;
        bottom = y;

        let dst = rowBase + x * cellW;
        if (scale === 0) {
          for (let r = 0; r < cellH; r++, dst += width) px.fill(bg, dst, dst + cellW);
          continue;
        }
        const mask = masks.data;
        let src = slot * tile;
        for (let r = 0; r < cellH; r++, dst += width) {
          for (let c = 0; c < cellW; c++, src++) {
            px[dst + c] = palette[(mask[src]! * scale) >> 8]!;
          }
        }
      }
    }

    this.dirtyTop = top < 0 ? 0 : top * cellH;
    this.dirtyBottom = top < 0 ? 0 : (bottom + 1) * cellH;
  }

  /**
   * Per-cell ink: pixel = bg + (ink - bg) * coverage * alpha, with coverage
   * quantized to INK_LEVELS through a per-cell palette. A cell is redrawn when
   * its glyph, alpha step or ink changes.
   */
  private composeColor(
    work: WorkBuffer,
    ramp: Ramp,
    polarity: Polarity,
    useSourceChars: boolean,
    mode: QuantizeMode,
    masks: MaskSource,
  ): void {
    const { cols, rows, cellW, cellH, width, px, prevCode, prevAlpha, prevInk } = this;
    const alpha = work.alpha;
    const color = work.color!; // checked by compose()
    const br = this.bg[0]!;
    const bgc = this.bg[1]!;
    const bb = this.bg[2]!;
    const bgPx = OPAQUE | (br << SHIFT_R) | (bgc << SHIFT_G) | (bb << SHIFT_B);
    const tile = cellW * cellH;
    let top = -1;
    let bottom = -1;

    // Hot loop: indices bounded by cols*rows, tile offsets by the mask size.
    let i = 0;
    for (let y = 0; y < rows; y++) {
      const rowBase = y * cellH * width;
      for (let x = 0; x < cols; x++, i++) {
        const code = resolveCellChar(work, i, ramp, polarity, useSourceChars, mode);
        const slot = code === 0 ? -1 : masks.slot(code);
        const scale = slot < 0 ? 0 : alphaScale(alpha[i]!);
        const key = scale === 0 ? 0 : code;
        const ir = color[i * 3]!;
        const ig = color[i * 3 + 1]!;
        const ib = color[i * 3 + 2]!;
        // Change key with 3 bits of tolerance per channel: slow colour drift
        // redraws a cell every few frames, not every frame. The drawn colour is
        // exact; it lags the true one by under 8/255 at most.
        const ink = scale === 0 ? 0 : ((ir >> 3) << 10) | ((ig >> 3) << 5) | (ib >> 3) | 0x8000;
        if (key === prevCode[i] && scale === prevAlpha[i] && ink === prevInk[i]) continue;
        prevCode[i] = key;
        prevAlpha[i] = scale;
        prevInk[i] = ink;
        if (top < 0) top = y;
        bottom = y;

        let dst = rowBase + x * cellW;
        if (scale === 0) {
          for (let r = 0; r < cellH; r++, dst += width) px.fill(bgPx, dst, dst + cellW);
          continue;
        }
        // Level 0 is the background; INK_LEVELS is full ink.
        const pal = this.inkPalette;
        const dr = ir - br;
        const dg = ig - bgc;
        const db = ib - bb;
        // Fixed point, 5 fractional bits (INK_LEVELS = 32): one add per channel per level.
        let ar = (br << 5) + 16;
        let ag = (bgc << 5) + 16;
        let ab = (bb << 5) + 16;
        for (let l = 0; l <= INK_LEVELS; l++) {
          pal[l] = OPAQUE | ((ar >> 5) << SHIFT_R) | ((ag >> 5) << SHIFT_G) | ((ab >> 5) << SHIFT_B);
          ar += dr;
          ag += dg;
          ab += db;
        }
        const mask = masks.data;
        let src = slot * tile;
        for (let r = 0; r < cellH; r++, dst += width) {
          for (let c = 0; c < cellW; c++, src++) {
            px[dst + c] = pal[(mask[src]! * scale + 1024) >> INK_SHIFT]!;
          }
        }
      }
    }

    this.dirtyTop = top < 0 ? 0 : top * cellH;
    this.dirtyBottom = top < 0 ? 0 : (bottom + 1) * cellH;
  }
}
