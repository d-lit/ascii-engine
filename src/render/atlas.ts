import type { FontSpec } from '../core/ramp.ts';
import { drawBlockGlyph, isBlockGlyph } from './block-glyphs.ts';
import type { MaskSource } from './compositor.ts';
import { setupGlyphFont } from './glyph-font.ts';

const SPACE = 0x20;
const INITIAL_SLOTS = 64;
const NO_SLOT = -1;
const UNSEEN = -2;

/**
 * Glyph atlas of coverage masks (SPEC 9.2): one byte per physical pixel,
 * rasterized lazily on first use. Colour-free, so one atlas serves every
 * theme. Lookup is a typed array indexed by charCode: no allocation per cell.
 */
export class GlyphAtlas implements MaskSource {
  readonly cellW: number;
  readonly cellH: number;
  data: Uint8Array;

  private readonly slots = new Int32Array(0x10000).fill(UNSEEN);
  private count = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(font: FontSpec) {
    if (!Number.isInteger(font.cellW) || !Number.isInteger(font.cellH)) {
      throw new Error(`GlyphAtlas: cell must be integral, got ${font.cellW}x${font.cellH}`);
    }
    this.cellW = font.cellW;
    this.cellH = font.cellH;
    this.data = new Uint8Array(INITIAL_SLOTS * font.cellW * font.cellH);

    // One-tile scratch canvas; getImageData reads it back once per glyph.
    this.canvas = document.createElement('canvas');
    this.canvas.width = font.cellW;
    this.canvas.height = font.cellH;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('GlyphAtlas: no 2d context');
    this.ctx = ctx;
    setupGlyphFont(ctx, font);
  }

  slot(code: number): number {
    const s = this.slots[code]!; // code is a Uint16 value: always in range
    if (s !== UNSEEN) return s;
    return this.add(code);
  }

  private add(code: number): number {
    if (code === 0 || code === SPACE) {
      this.slots[code] = NO_SLOT;
      return NO_SLOT;
    }
    const tile = this.cellW * this.cellH;
    const s = this.count++;
    if ((s + 1) * tile > this.data.length) {
      const grown = new Uint8Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.rasterize(code, s * tile);
    this.slots[code] = s;
    return s;
  }

  private rasterize(code: number, offset: number): void {
    const { ctx, cellW, cellH } = this;
    ctx.clearRect(0, 0, cellW, cellH);
    if (isBlockGlyph(code)) {
      drawBlockGlyph(ctx, code, 0, 0, cellW, cellH, '#fff');
    } else {
      ctx.fillStyle = '#fff';
      // The canvas is exactly one tile, so ink past the cell is clipped for free.
      ctx.fillText(String.fromCharCode(code), cellW / 2, cellH / 2);
    }
    const rgba = ctx.getImageData(0, 0, cellW, cellH).data;
    for (let p = 0, o = offset; p < rgba.length; p += 4, o++) this.data[o] = rgba[p + 3]!;
  }
}

const cache = new Map<string, GlyphAtlas>();

/** Cell size is physical, so the key covers devicePixelRatio as well. */
export function getAtlas(font: FontSpec): GlyphAtlas {
  const key = `${font.family}|${font.weight}|${font.cellW}x${font.cellH}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const atlas = new GlyphAtlas(font);
  cache.set(key, atlas);
  return atlas;
}

export function clearAtlasCache(): void {
  cache.clear();
}
