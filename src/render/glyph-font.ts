import type { FontSpec } from '../core/ramp.ts';

// Glyph used to probe the font's advance; monospace makes any glyph equivalent.
const PROBE = 'M';

const sizeCache = new Map<string, number>();

/**
 * Largest font size whose advance fits the cell width and whose em fits the
 * cell height. Without the width limit a monospace glyph (~0.6 em wide) would
 * overflow a cell with aspect ~0.5.
 */
function fitFontSize(ctx: CanvasRenderingContext2D, font: FontSpec): number {
  const key = `${font.family}|${font.weight}|${font.cellW}x${font.cellH}`;
  const hit = sizeCache.get(key);
  if (hit !== undefined) return hit;

  ctx.font = `${font.weight} ${font.cellH}px ${font.family}`;
  const advance = ctx.measureText(PROBE).width;
  const size = advance > font.cellW ? (font.cellH * font.cellW) / advance : font.cellH;
  sizeCache.set(key, size);
  return size;
}

/**
 * Single source of glyph text state. Both density measurement and the atlas
 * call this, so a measured density always describes the glyph actually drawn.
 */
export function setupGlyphFont(ctx: CanvasRenderingContext2D, font: FontSpec): void {
  const size = fitFontSize(ctx, font);
  ctx.font = `${font.weight} ${size}px ${font.family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
}
