import type { FontSpec } from '../core/ramp.ts';
import { drawBlockGlyph, isBlockGlyph } from './block-glyphs.ts';
import { setupGlyphFont } from './glyph-font.ts';

const SPACE = 0x20;
const COLUMNS = 16;
const COLUMN_SHIFT = 4; // log2(COLUMNS)
const INITIAL_ROWS = 4;
const NO_SLOT = -1;
const UNSEEN = -2;

/** `cellW`/`cellH` are integral physical pixels. */
export interface AtlasOptions extends FontSpec {
  color: string;
}

/**
 * One tile per glyph, filled lazily. Lookup is a typed array indexed by
 * charCode, so the render loop resolves a glyph without allocating.
 */
export class GlyphAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly cellW: number;
  readonly cellH: number;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly opts: AtlasOptions;
  private readonly slots = new Int32Array(0x10000).fill(UNSEEN);
  private readonly codes: number[] = [];
  private rows = INITIAL_ROWS;

  constructor(opts: AtlasOptions) {
    if (!Number.isInteger(opts.cellW) || !Number.isInteger(opts.cellH)) {
      throw new Error(`GlyphAtlas: cell must be integral, got ${opts.cellW}x${opts.cellH}`);
    }
    this.opts = opts;
    this.cellW = opts.cellW;
    this.cellH = opts.cellH;
    this.canvas = document.createElement('canvas');
    this.canvas.width = COLUMNS * opts.cellW;
    this.canvas.height = this.rows * opts.cellH;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('GlyphAtlas: no 2d context');
    this.ctx = ctx;
    setupGlyphFont(this.ctx, opts);
  }

  /** Tile slot for a charCode, or -1 when there is nothing to draw. */
  slot(code: number): number {
    const s = this.slots[code]!; // code is a Uint16 value: always in range
    if (s !== UNSEEN) return s;
    return this.add(code);
  }

  slotX(slot: number): number {
    return (slot & (COLUMNS - 1)) * this.cellW;
  }

  slotY(slot: number): number {
    return (slot >> COLUMN_SHIFT) * this.cellH;
  }

  dispose(): void {
    this.slots.fill(UNSEEN);
    this.codes.length = 0;
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  private add(code: number): number {
    if (code === 0 || code === SPACE) {
      this.slots[code] = NO_SLOT;
      return NO_SLOT;
    }
    if (this.codes.length === COLUMNS * this.rows) this.grow();

    const s = this.codes.length;
    this.codes.push(code);
    this.slots[code] = s;
    this.draw(code, s);
    return s;
  }

  private draw(code: number, s: number): void {
    const { cellW, cellH, color } = this.opts;
    const x = this.slotX(s);
    const y = this.slotY(s);

    if (isBlockGlyph(code)) {
      drawBlockGlyph(this.ctx, code, x, y, cellW, cellH, color);
      return;
    }

    // Clip to the tile: a glyph's ink may reach past its advance box.
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x, y, cellW, cellH);
    this.ctx.clip();
    this.ctx.fillStyle = color;
    this.ctx.fillText(String.fromCharCode(code), x + cellW / 2, y + cellH / 2);
    this.ctx.restore();
  }

  /** Columns never change, so existing slots keep their coordinates. */
  private grow(): void {
    this.rows *= 2;
    this.canvas.height = this.rows * this.cellH; // resets context state
    setupGlyphFont(this.ctx, this.opts);
    for (let s = 0; s < this.codes.length; s++) this.draw(this.codes[s]!, s);
  }
}

const cache = new Map<string, GlyphAtlas>();

function cacheKey(opts: AtlasOptions): string {
  return `${opts.family}|${opts.weight}|${opts.cellW}x${opts.cellH}|${opts.color}`;
}

/** Cell size is physical, so the key covers devicePixelRatio as well. */
export function getAtlas(opts: AtlasOptions): GlyphAtlas {
  const key = cacheKey(opts);
  const hit = cache.get(key);
  if (hit) return hit;

  const atlas = new GlyphAtlas(opts);
  cache.set(key, atlas);
  return atlas;
}

export function clearAtlasCache(): void {
  for (const atlas of cache.values()) atlas.dispose();
  cache.clear();
}
