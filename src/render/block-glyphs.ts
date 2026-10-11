export const BLOCK_LIGHT = 0x2591; // U+2591 light shade
export const BLOCK_MEDIUM = 0x2592; // U+2592 medium shade
export const BLOCK_DARK = 0x2593; // U+2593 dark shade
export const BLOCK_FULL = 0x2588; // U+2588 full block
export const BLOCK_UPPER = 0x2580; // U+2580 upper half
export const BLOCK_LOWER = 0x2584; // U+2584 lower half
export const BLOCK_LEFT = 0x258c; // U+258C left half
export const BLOCK_RIGHT = 0x2590; // U+2590 right half

const SPACE = 0x20;

/**
 * Analytic coverage, not measured: a font may render these with padding or
 * antialiased edges, which would make the ramp uneven (SPEC 9.3).
 */
export const BLOCK_DENSITY: ReadonlyMap<number, number> = new Map([
  [SPACE, 0],
  [BLOCK_LIGHT, 0.25],
  [BLOCK_MEDIUM, 0.5],
  [BLOCK_DARK, 0.75],
  [BLOCK_FULL, 1],
  [BLOCK_UPPER, 0.5],
  [BLOCK_LOWER, 0.5],
  [BLOCK_LEFT, 0.5],
  [BLOCK_RIGHT, 0.5],
]);

const SHADE_LEVEL: ReadonlyMap<number, number> = new Map([
  [BLOCK_LIGHT, 4],
  [BLOCK_MEDIUM, 8],
  [BLOCK_DARK, 12],
]);

// Ordered 4x4 dither; a pixel lights up when its threshold is below the level.
const BAYER_4X4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function isBlockGlyph(code: number): boolean {
  return code !== SPACE && BLOCK_DENSITY.has(code);
}

/**
 * Draws a block glyph with rectangles instead of text. All coordinates are
 * physical pixels and stay integral, so neighbouring tiles leave no seams.
 */
export function drawBlockGlyph(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  code: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;

  const shade = SHADE_LEVEL.get(code);
  if (shade !== undefined) {
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const threshold = BAYER_4X4[(py & 3) * 4 + (px & 3)]!;
        if (threshold < shade) ctx.fillRect(x + px, y + py, 1, 1);
      }
    }
    return;
  }

  // Halves split at the same rounded edge, so a pair covers the cell exactly.
  const halfH = Math.round(h / 2);
  const halfW = Math.round(w / 2);

  switch (code) {
    case BLOCK_FULL:
      ctx.fillRect(x, y, w, h);
      return;
    case BLOCK_UPPER:
      ctx.fillRect(x, y, w, halfH);
      return;
    case BLOCK_LOWER:
      ctx.fillRect(x, y + halfH, w, h - halfH);
      return;
    case BLOCK_LEFT:
      ctx.fillRect(x, y, halfW, h);
      return;
    case BLOCK_RIGHT:
      ctx.fillRect(x + halfW, y, w - halfW, h);
      return;
    default:
      throw new Error(`drawBlockGlyph: not a block glyph: ${code}`);
  }
}
