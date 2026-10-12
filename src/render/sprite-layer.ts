import type { Rgb } from '../core/color.ts';
import type { Polarity, WorkBuffer } from '../core/field.ts';
import type { QuantizeMode, Ramp } from '../core/ramp.ts';
import { resolveCellChar } from './cell-char.ts';
import { alphaScale, type MaskSource } from './compositor.ts';

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const SHIFT_R = LITTLE_ENDIAN ? 0 : 24;
const SHIFT_G = LITTLE_ENDIAN ? 8 : 16;
const SHIFT_B = LITTLE_ENDIAN ? 16 : 8;
const SHIFT_A = LITTLE_ENDIAN ? 24 : 0;

/**
 * The sprite layer (SPEC 6.3, DECISIONS 024): glyphs of `work.sprites` at
 * pixel positions over the grid layer, straight alpha; overlaps get the
 * exact "over" alpha and the stronger glyph's colour. Cleared and redrawn every frame, but only inside the box where
 * sprites were or are, so an idle system costs nothing. DOM-free.
 */
export class SpriteLayer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  /** Region to upload after `draw`, pixels; empty when w or h is 0. */
  dirtyX = 0;
  dirtyY = 0;
  dirtyW = 0;
  dirtyH = 0;

  private readonly px: Uint32Array;
  private readonly cellW: number;
  private readonly cellH: number;
  private ink: Rgb = [255, 255, 255];
  // Box drawn last frame (x0 >= x1: nothing).
  private x0 = 0;
  private y0 = 0;
  private x1 = 0;
  private y1 = 0;

  constructor(width: number, height: number, cellW: number, cellH: number) {
    this.width = width;
    this.height = height;
    this.cellW = cellW;
    this.cellH = cellH;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.px = new Uint32Array(this.pixels.buffer);
  }

  /** Theme ink, for sprites when the work buffer has no colour channel. */
  setInk(ink: Rgb): void {
    this.ink = ink;
  }

  draw(
    work: WorkBuffer,
    ramp: Ramp,
    polarity: Polarity,
    useSourceChars: boolean,
    mode: QuantizeMode,
    masks: MaskSource,
  ): void {
    const { px, width, height, cellW, cellH } = this;
    // Clear what the last frame drew.
    const px0 = this.x0;
    const py0 = this.y0;
    const px1 = this.x1;
    const py1 = this.y1;
    if (px1 > px0) {
      for (let y = py0; y < py1; y++) px.fill(0, y * width + px0, y * width + px1);
    }

    const sp = work.sprites;
    const alpha = work.alpha;
    const color = work.color;
    const [inkR, inkG, inkB] = this.ink;
    let nx0 = width;
    let ny0 = height;
    let nx1 = 0;
    let ny1 = 0;
    const tile = cellW * cellH;

    // Hot loop: sprite index < count <= capacity; pixel indices clipped below.
    for (let s = 0; s < sp.count; s++) {
      const src = sp.src[s]!;
      const code = resolveCellChar(work, src, ramp, polarity, useSourceChars, mode);
      if (code === 0) continue;
      const slot = masks.slot(code);
      if (slot < 0) continue;
      const scale = alphaScale(alpha[src]! * sp.alpha[s]!);
      if (scale === 0) continue;
      const left = Math.round(sp.x[s]! * cellW);
      const top = Math.round(sp.y[s]! * cellH);
      const cx0 = Math.max(0, left);
      const cy0 = Math.max(0, top);
      const cx1 = Math.min(width, left + cellW);
      const cy1 = Math.min(height, top + cellH);
      if (cx1 <= cx0 || cy1 <= cy0) continue;
      if (cx0 < nx0) nx0 = cx0;
      if (cy0 < ny0) ny0 = cy0;
      if (cx1 > nx1) nx1 = cx1;
      if (cy1 > ny1) ny1 = cy1;

      const r = color === null ? inkR : color[src * 3]!;
      const g = color === null ? inkG : color[src * 3 + 1]!;
      const b = color === null ? inkB : color[src * 3 + 2]!;
      const rgb = (r << SHIFT_R) | (g << SHIFT_G) | (b << SHIFT_B);
      const mask = masks.data;
      for (let y = cy0; y < cy1; y++) {
        let m = slot * tile + (y - top) * cellW + (cx0 - left);
        let d = y * width + cx0;
        for (let x = cx0; x < cx1; x++, m++, d++) {
          const a = (mask[m]! * scale) >> 8;
          if (a === 0) continue;
          const under = px[d]!;
          const da = (under >>> SHIFT_A) & 255;
          if (da === 0) {
            px[d] = (rgb | (a << SHIFT_A)) >>> 0;
            continue;
          }
          // Overlap: exact "over" alpha, the colour of the stronger glyph.
          // Exact for one ink (mono), close enough for neighbours' colours,
          // and no division per pixel.
          const outA = a + ((da * (255 - a) * 257 + 32768) >> 16);
          px[d] = ((a >= da ? rgb : under & ~(255 << SHIFT_A)) | (outA << SHIFT_A)) >>> 0;
        }
      }
    }

    // Upload the union of the old and the new box.
    const ux0 = Math.min(px1 > px0 ? px0 : width, nx1 > nx0 ? nx0 : width);
    const uy0 = Math.min(px1 > px0 ? py0 : height, nx1 > nx0 ? ny0 : height);
    const ux1 = Math.max(px1 > px0 ? px1 : 0, nx1 > nx0 ? nx1 : 0);
    const uy1 = Math.max(px1 > px0 ? py1 : 0, nx1 > nx0 ? ny1 : 0);
    this.dirtyX = ux0;
    this.dirtyY = uy0;
    this.dirtyW = Math.max(0, ux1 - ux0);
    this.dirtyH = Math.max(0, uy1 - uy0);
    this.x0 = nx1 > nx0 ? nx0 : 0;
    this.y0 = nx1 > nx0 ? ny0 : 0;
    this.x1 = nx1 > nx0 ? nx1 : 0;
    this.y1 = nx1 > nx0 ? ny1 : 0;
  }

  /** Something is drawn (or was, and must be cleared on screen). */
  get dirty(): boolean {
    return this.dirtyW > 0 && this.dirtyH > 0;
  }
}
