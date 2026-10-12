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
const SHIFT_A = LITTLE_ENDIAN ? 24 : 0;

function packRgb(r: number, g: number, b: number): number {
  return (r << SHIFT_R) | (g << SHIFT_G) | (b << SHIFT_B);
}

/**
 * Software glyph compositor (DECISIONS 014, 020). Writes the glyph layer: each
 * pixel is the cell's ink with alpha = coverage x cell alpha, empty pixels are
 * fully transparent. The backdrop (theme colour, custom colour, image or
 * nothing) is composited under it by the renderer with drawImage. Cells whose
 * glyph, alpha step and ink did not change are skipped. DOM-free.
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
  // Mono path: theme ink at every alpha 0..255.
  private readonly palette = new Uint32Array(256);
  private readonly prevCode: Uint16Array;
  private readonly prevAlpha: Uint16Array;
  // Colour path (DECISIONS 015): per-cell ink change key, 5 bits per channel.
  private readonly prevInk: Int32Array;
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

  /** Theme ink for the mono path; every cell is redrawn on the next compose. */
  setInk(fg: Rgb): void {
    const rgb = packRgb(fg[0], fg[1], fg[2]);
    for (let a = 0; a < 256; a++) this.palette[a] = rgb | (a << SHIFT_A);
    this.palette[0] = 0; // canonical clear pixel, same as the colour path
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
    const { cols, rows, cellW, cellH, width, px, palette, prevCode, prevAlpha, prevInk } = this;
    const alpha = work.alpha;
    const color = work.color;
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
        let ir = 0;
        let ig = 0;
        let ib = 0;
        let ink = 0;
        if (color !== null && scale !== 0) {
          ir = color[i * 3]!;
          ig = color[i * 3 + 1]!;
          ib = color[i * 3 + 2]!;
          // Change key with 3 bits of tolerance per channel: slow colour drift
          // redraws a cell every few frames. The drawn colour is exact.
          ink = ((ir >> 3) << 10) | ((ig >> 3) << 5) | (ib >> 3) | 0x8000;
        }
        if (key === prevCode[i] && scale === prevAlpha[i] && ink === prevInk[i]) continue;
        prevCode[i] = key;
        prevAlpha[i] = scale;
        prevInk[i] = ink;
        if (top < 0) top = y;
        bottom = y;

        let dst = rowBase + x * cellW;
        if (scale === 0) {
          for (let r = 0; r < cellH; r++, dst += width) px.fill(0, dst, dst + cellW);
          continue;
        }
        const mask = masks.data;
        let src = slot * tile;
        if (color === null) {
          for (let r = 0; r < cellH; r++, dst += width) {
            for (let c = 0; c < cellW; c++, src++) {
              px[dst + c] = palette[(mask[src]! * scale) >> 8]!;
            }
          }
        } else {
          const rgb = packRgb(ir, ig, ib);
          for (let r = 0; r < cellH; r++, dst += width) {
            for (let c = 0; c < cellW; c++, src++) {
              const m = mask[src]!;
              px[dst + c] = m === 0 ? 0 : rgb | (((m * scale) >> 8) << SHIFT_A);
            }
          }
        }
      }
    }

    this.dirtyTop = top < 0 ? 0 : top * cellH;
    this.dirtyBottom = top < 0 ? 0 : (bottom + 1) * cellH;
  }
}
