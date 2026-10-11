export const BLOCK_LIGHT = 0x2591; // U+2591 light shade
export const BLOCK_MEDIUM = 0x2592; // U+2592 medium shade
export const BLOCK_DARK = 0x2593; // U+2593 dark shade
export const BLOCK_FULL = 0x2588; // U+2588 full block
export const BLOCK_UPPER = 0x2580; // U+2580 upper half
export const BLOCK_LOWER = 0x2584; // U+2584 lower half
export const BLOCK_LEFT = 0x258c; // U+258C left half
export const BLOCK_RIGHT = 0x2590; // U+2590 right half

const SHADE_DENSITY: ReadonlyMap<number, number> = new Map([
  [BLOCK_LIGHT, 0.25],
  [BLOCK_MEDIUM, 0.5],
  [BLOCK_DARK, 0.75],
]);

const SHAPES: ReadonlySet<number> = new Set([
  BLOCK_FULL,
  BLOCK_UPPER,
  BLOCK_LOWER,
  BLOCK_LEFT,
  BLOCK_RIGHT,
]);

// Ordered 4x4 dither matrix, values 0..15.
const BAYER_4X4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function bayer(x: number, y: number): number {
  return BAYER_4X4[(y & 3) * 4 + (x & 3)]!;
}

export function isBlockGlyph(code: number): boolean {
  return SHADE_DENSITY.has(code) || SHAPES.has(code);
}

function shadeCount(d: number, w: number, h: number): number {
  return Math.round(d * w * h);
}

/**
 * Exact coverage of the glyph as drawn on a `w x h` tile, or undefined for
 * non-block glyphs. Matches drawBlockGlyph by construction (DECISIONS 010).
 */
export function blockGlyphDensity(code: number, w: number, h: number): number | undefined {
  const area = w * h;
  if (area <= 0) return undefined;

  const shade = SHADE_DENSITY.get(code);
  if (shade !== undefined) return shadeCount(shade, w, h) / area;

  switch (code) {
    case BLOCK_FULL:
      return 1;
    case BLOCK_UPPER:
      return Math.round(h / 2) / h;
    case BLOCK_LOWER:
      return (h - Math.round(h / 2)) / h;
    case BLOCK_LEFT:
      return Math.round(w / 2) / w;
    case BLOCK_RIGHT:
      return (w - Math.round(w / 2)) / w;
    default:
      return undefined;
  }
}

const orderCache = new Map<string, Uint32Array>();

/**
 * Tile pixel indices in dither order: by Bayer value, ties broken by Bayer of
 * the 4x4 block position, so extra pixels on a large tile spread evenly too.
 */
function ditherOrder(w: number, h: number): Uint32Array {
  const key = `${w}x${h}`;
  const hit = orderCache.get(key);
  if (hit) return hit;

  const keys = new Float64Array(w * h);
  const order: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      keys[i] = bayer(x, y) * 16 + bayer(x >> 2, y >> 2) + (i / (w * h)) * 1e-3;
      order.push(i);
    }
  }
  order.sort((a, b) => keys[a]! - keys[b]!);

  const out = Uint32Array.from(order);
  orderCache.set(key, out);
  return out;
}

export interface RectSink {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/**
 * Draws a block glyph with rectangles instead of text. All coordinates are
 * physical pixels and stay integral, so neighbouring tiles leave no seams.
 * Shades light exactly round(d * w * h) pixels (DECISIONS 010).
 */
export function drawBlockGlyph(
  ctx: RectSink,
  code: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;

  const shade = SHADE_DENSITY.get(code);
  if (shade !== undefined) {
    const order = ditherOrder(w, h);
    const n = shadeCount(shade, w, h);
    for (let k = 0; k < n; k++) {
      const i = order[k]!;
      ctx.fillRect(x + (i % w), y + Math.floor(i / w), 1, 1);
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
