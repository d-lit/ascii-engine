import type { Polarity, WorkBuffer } from '../core/field.ts';
import type { QuantizeMode, Ramp } from '../core/ramp.ts';
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

export type Rgb = readonly [r: number, g: number, b: number];

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
}
