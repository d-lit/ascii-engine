import { DEFAULT_CROP, placeRect, type Crop } from '../core/placement.ts';

/** How an image backdrop is placed; `grid` lays it exactly under the glyph grid. */
export type ImageFit = 'grid' | 'cover' | 'contain' | 'stretch';
export const IMAGE_FITS: readonly ImageFit[] = ['grid', 'cover', 'contain', 'stretch'];

/** Which picture an image backdrop shows: the source photo or a separate file. */
export type ImageOrigin = 'picture' | 'custom';
export const IMAGE_ORIGINS: readonly ImageOrigin[] = ['picture', 'custom'];

export interface ImageBackdrop {
  kind: 'image';
  origin: ImageOrigin;
  fit: ImageFit;
  /** Image strength over the theme colour, 0..1. */
  opacity: number;
  /** Darkening for legibility of the glyphs, 0..1. */
  dim: number;
  /** Blur radius as a share of the frame width, 0..0.05. */
  blur: number;
}

/**
 * What lies under the glyph layer (DECISIONS 020). Presets store only these
 * settings; the image itself is session state and never saved.
 */
export type Backdrop =
  | { kind: 'theme' }
  | { kind: 'color'; color: string }
  | { kind: 'transparent' }
  | ImageBackdrop;

export const BACKDROP_KINDS = ['theme', 'color', 'transparent', 'image'] as const;
export const BLUR_MAX = 0.05;

export const DEFAULT_IMAGE_BACKDROP: ImageBackdrop = {
  kind: 'image',
  origin: 'picture',
  fit: 'grid',
  opacity: 1,
  dim: 0.55,
  blur: 0.004,
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the image goes in a `frameW x frameH` frame: `grid` takes `picture`,
 * where the source picture lies; the other fits are cropped by `crop`
 * (session state, task 015).
 */
export function fitRect(
  fit: ImageFit,
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
  picture: Rect,
  crop: Crop = DEFAULT_CROP,
): Rect {
  if (fit === 'grid') return { ...picture };
  return placeRect(imgW, imgH, frameW, frameH, { fit, ...crop });
}

export interface BackdropImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

/**
 * Draws the static part of the frame into `target` (sized to the frame):
 * a fill colour, or the theme colour plus the prepared image, or nothing
 * (transparent). Done once per change, not per frame. An image backdrop
 * without an image falls back to the theme colour.
 */
export function prepareBackdrop(
  target: HTMLCanvasElement,
  backdrop: Backdrop,
  themeBg: string,
  image: BackdropImage | null,
  picture: Rect,
  crop: Crop = DEFAULT_CROP,
): void {
  const ctx = target.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('prepareBackdrop: no 2d context');
  const { width, height } = target;
  ctx.clearRect(0, 0, width, height);

  if (backdrop.kind === 'transparent') return;
  ctx.fillStyle = backdrop.kind === 'color' ? backdrop.color : themeBg;
  ctx.fillRect(0, 0, width, height);
  if (backdrop.kind !== 'image' || image === null) return;

  const r = fitRect(backdrop.fit, image.width, image.height, width, height, picture, crop);
  ctx.save();
  // Clip to the image rect so blur does not bleed into letterbox bars.
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const blur = Math.min(Math.max(backdrop.blur, 0), BLUR_MAX) * width;
  if (blur > 0.5) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.globalAlpha = Math.min(Math.max(backdrop.opacity, 0), 1);
  // Blur pulls in transparent edges; overscan by the blur radius hides that.
  const o = blur > 0.5 ? blur * 2 : 0;
  ctx.drawImage(image.source, r.x - o, r.y - o, r.w + 2 * o, r.h + 2 * o);
  ctx.restore();

  const dim = Math.min(Math.max(backdrop.dim, 0), 1);
  if (dim > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
}

/** Fill for frames without a prepared backdrop canvas. */
export function backdropFill(backdrop: Backdrop, themeBg: string): string | null {
  switch (backdrop.kind) {
    case 'theme':
    case 'image':
      return themeBg;
    case 'color':
      return backdrop.color;
    case 'transparent':
      return null;
  }
}

/**
 * Builds one frame: the backdrop (a prepared canvas, a fill colour, or
 * nothing), then the glyph layer at (x, y), scaled to `w x h` when given. The browser does the alpha
 * blending, so the compositor never blends per pixel.
 */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  layer: CanvasImageSource,
  under: HTMLCanvasElement | string | null,
  x: number,
  y: number,
  w?: number,
  h?: number,
  /** Sprite layer (SPEC 6.3), same size and place as the glyph layer. */
  sprites: CanvasImageSource | null = null,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  if (typeof under === 'string') {
    ctx.fillStyle = under;
    ctx.fillRect(0, 0, width, height);
  } else if (under !== null) {
    ctx.drawImage(under, 0, 0);
  }
  if (w === undefined || h === undefined) {
    ctx.drawImage(layer, x, y);
    if (sprites !== null) ctx.drawImage(sprites, x, y);
  } else {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(layer, x, y, w, h);
    if (sprites !== null) ctx.drawImage(sprites, x, y, w, h);
  }
}
