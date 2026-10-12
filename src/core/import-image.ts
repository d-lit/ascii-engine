import { clamp01 } from './math.ts';
import { createField, type Field } from './field.ts';
import { placeRect, type PlacedRect, type Placement } from './placement.ts';

export interface Levels {
  brightness: number;
  contrast: number;
  gamma: number;
  invert: boolean;
}

export interface ImageImportOptions extends Partial<Levels> {
  cols: number;
  cellAspect: number;
  color?: boolean;
  bgThreshold?: number;
  /** Grid height; by default from the picture's aspect. */
  rows?: number;
  /** How the picture sits in the grid; by default stretched over it. */
  place?: Placement;
}

export const DEFAULT_LEVELS: Levels = {
  brightness: 0,
  contrast: 1,
  gamma: 1,
  invert: false,
};

export function computeRows(imgW: number, imgH: number, cols: number, cellAspect: number): number {
  if (imgW <= 0 || imgH <= 0) throw new Error(`computeRows: bad image ${imgW}x${imgH}`);
  return Math.max(1, Math.round(cols * (imgH / imgW) * cellAspect));
}

/** gamma -> contrast -> brightness -> invert, clamped once at the end. */
export function applyLevels(lum: number, levels: Levels): number {
  let l = clamp01(lum);
  if (levels.gamma !== 1 && levels.gamma > 0) l = Math.pow(l, 1 / levels.gamma);
  if (levels.contrast !== 1) l = (l - 0.5) * levels.contrast + 0.5;
  if (levels.brightness !== 0) l = l + levels.brightness;
  if (levels.invert) l = 1 - l;
  return clamp01(l);
}

/**
 * Sobel over `lum`, clamped at the edges. Writes into the out arrays; both must
 * be cols*rows long.
 */
export function sobel(
  lum: Float32Array,
  cols: number,
  rows: number,
  outX: Float32Array,
  outY: Float32Array,
): void {
  const at = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= cols ? cols - 1 : x;
    const cy = y < 0 ? 0 : y >= rows ? rows - 1 : y;
    return lum[cy * cols + cx]!;
  };

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const tl = at(x - 1, y - 1);
      const tc = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const ml = at(x - 1, y);
      const mr = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const bc = at(x, y + 1);
      const br = at(x + 1, y + 1);

      const i = y * cols + x;
      outX[i] = tr + 2 * mr + br - (tl + 2 * ml + bl);
      outY[i] = bl + 2 * bc + br - (tl + 2 * tc + tr);
    }
  }
}

/**
 * Knocks out cells whose brightness is close to the average of the four corner
 * cells (SPEC 3.1.5).
 */
export function detectBackground(
  lum: Float32Array,
  cols: number,
  rows: number,
  threshold: number,
  outAlpha: Float32Array,
): void {
  const corners =
    (lum[0]! + lum[cols - 1]! + lum[(rows - 1) * cols]! + lum[rows * cols - 1]!) / 4;

  for (let i = 0; i < lum.length; i++) {
    if (Math.abs(lum[i]! - corners) < threshold) outAlpha[i] = 0;
  }
}

/**
 * Picture rectangle as fractions of the grid (0..1 = the grid, may overflow),
 * placed isotropically: a grid cell is `cellAspect` times as wide as tall.
 */
export function placeInGrid(
  imgW: number,
  imgH: number,
  cols: number,
  rows: number,
  cellAspect: number,
  place: Placement,
): PlacedRect {
  const boxW = cols * cellAspect;
  const r = placeRect(imgW, imgH, boxW, rows, place);
  return { x: r.x / boxW, y: r.y / rows, w: r.w / boxW, h: r.h / rows };
}

/**
 * Area-averaged downscale of RGBA pixels into a cols x rows grid; the picture
 * covers `rect` (fractions of the grid). Cells it covers partly get partial
 * alpha, cells outside it are empty.
 */
function downscale(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  cols: number,
  rows: number,
  rect: PlacedRect,
  outRgb: Float32Array,
  outAlpha: Float32Array,
): void {
  // Picture pixels per cell, and the grid origin in picture pixels.
  const scaleX = srcW / (rect.w * cols);
  const scaleY = srcH / (rect.h * rows);
  const originX = -rect.x * cols * scaleX;
  const originY = -rect.y * rows * scaleY;
  const cellArea = scaleX * scaleY;

  for (let cy = 0; cy < rows; cy++) {
    const sourceTop = originY + cy * scaleY;
    const sourceBottom = sourceTop + scaleY;
    const yStart = Math.max(0, Math.floor(sourceTop));
    const yEnd = Math.min(srcH, Math.ceil(sourceBottom));

    for (let cx = 0; cx < cols; cx++) {
      const sourceLeft = originX + cx * scaleX;
      const sourceRight = sourceLeft + scaleX;
      const xStart = Math.max(0, Math.floor(sourceLeft));
      const xEnd = Math.min(srcW, Math.ceil(sourceRight));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let totalWeight = 0;

      for (let y = yStart; y < yEnd; y++) {
        const overlapY = Math.min(y + 1, sourceBottom) - Math.max(y, sourceTop);
        if (overlapY <= 0) continue;

        for (let x = xStart; x < xEnd; x++) {
          const overlapX = Math.min(x + 1, sourceRight) - Math.max(x, sourceLeft);
          if (overlapX <= 0) continue;

          const weight = overlapX * overlapY;
          const p = (y * srcW + x) * 4;
          r += src[p]! * weight;
          g += src[p + 1]! * weight;
          b += src[p + 2]! * weight;
          a += src[p + 3]! * weight;
          totalWeight += weight;
        }
      }

      const i = cy * cols + cx;
      // Colour of the covered part; alpha also counts the uncovered part as empty.
      const k = totalWeight > 0 ? 1 / totalWeight : 0;
      outRgb[i * 3] = r * k;
      outRgb[i * 3 + 1] = g * k;
      outRgb[i * 3 + 2] = b * k;
      outAlpha[i] = Math.min(1, a / cellArea / 255);
    }
  }
}

/** Rec.709 luma over sRGB values, 0..1 each. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** RGBA pixels of a picture, possibly scaled down. */
export interface Pixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/**
 * Reads a bitmap's pixels, scaled down so the longer side is at most
 * `maxSide`: re-importing on every crop or `cols` change stays cheap.
 */
export function readPixels(bitmap: ImageBitmap, maxSide = Infinity): Pixels {
  const s = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * s));
  const height = Math.max(1, Math.round(bitmap.height * s));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('readPixels: no 2d context');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

export function importImage(bitmap: ImageBitmap, opts: ImageImportOptions): Field {
  return importPixels(readPixels(bitmap), opts);
}

export function importPixels(image: Pixels, opts: ImageImportOptions): Field {
  const cols = Math.max(1, Math.round(opts.cols));
  const rows = Math.max(1, Math.round(opts.rows ?? computeRows(image.width, image.height, cols, opts.cellAspect)));
  const rect = opts.place === undefined
    ? { x: 0, y: 0, w: 1, h: 1 }
    : placeInGrid(image.width, image.height, cols, rows, opts.cellAspect, opts.place);
  const pixels = image.data;

  const wantColor = opts.color === true;
  const field = createField(cols, rows, { color: wantColor, grad: true });
  const { gradX, gradY } = field;
  if (gradX === null || gradY === null) {
    throw new Error('importImage: gradient buffers were not allocated');
  }

  const rgb = new Float32Array(cols * rows * 3);
  downscale(pixels, image.width, image.height, cols, rows, rect, rgb, field.alpha);

  const levels: Levels = {
    brightness: opts.brightness ?? DEFAULT_LEVELS.brightness,
    contrast: opts.contrast ?? DEFAULT_LEVELS.contrast,
    gamma: opts.gamma ?? DEFAULT_LEVELS.gamma,
    invert: opts.invert ?? DEFAULT_LEVELS.invert,
  };

  for (let i = 0; i < cols * rows; i++) {
    const r = rgb[i * 3]! / 255;
    const g = rgb[i * 3 + 1]! / 255;
    const b = rgb[i * 3 + 2]! / 255;
    field.lum[i] = applyLevels(luma(r, g, b), levels);

    if (field.color !== null) {
      field.color[i * 3] = rgb[i * 3]!;
      field.color[i * 3 + 1] = rgb[i * 3 + 1]!;
      field.color[i * 3 + 2] = rgb[i * 3 + 2]!;
    }
  }

  if (opts.bgThreshold !== undefined && opts.bgThreshold > 0) {
    detectBackground(field.lum, cols, rows, opts.bgThreshold, field.alpha);
  }

  sobel(field.lum, cols, rows, gradX, gradY);
  return field;
}
