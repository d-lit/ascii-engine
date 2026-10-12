/**
 * How a picture sits in a box (the grid for the source, the frame for an
 * image backdrop): fitted, zoomed and shifted like CSS `object-fit` +
 * `object-position`. Session state, never stored in presets (task 015).
 */
export type PlaceFit = 'cover' | 'contain' | 'stretch';
export const PLACE_FITS: readonly PlaceFit[] = ['cover', 'contain', 'stretch'];

export interface Placement {
  fit: PlaceFit;
  /** Which part shows when the picture overflows: 0 = left / top edge, 1 = right / bottom. */
  x: number;
  y: number;
  /** 1 = fitted; larger crops in. */
  zoom: number;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

export const DEFAULT_PLACEMENT: Placement = { fit: 'cover', x: 0.5, y: 0.5, zoom: 1 };

/** Placement without the fit: for an image backdrop, whose fit lives in the preset. */
export type Crop = Omit<Placement, 'fit'>;
export const DEFAULT_CROP: Crop = { x: 0.5, y: 0.5, zoom: 1 };

/** Picture rectangle in box units; may extend past the box (cropped). */
export interface PlacedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a `imgW x imgH` picture lands inside a `boxW x boxH` box. */
export function placeRect(imgW: number, imgH: number, boxW: number, boxH: number, p: Placement): PlacedRect {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, p.zoom));
  let w: number;
  let h: number;
  if (p.fit === 'stretch' || imgW <= 0 || imgH <= 0) {
    w = boxW * zoom;
    h = boxH * zoom;
  } else {
    const s = (p.fit === 'cover' ? Math.max(boxW / imgW, boxH / imgH) : Math.min(boxW / imgW, boxH / imgH)) * zoom;
    w = imgW * s;
    h = imgH * s;
  }
  const px = Math.min(1, Math.max(0, p.x));
  const py = Math.min(1, Math.max(0, p.y));
  // `+ 0` turns -0 (zero overflow times a position) into 0.
  return { x: (boxW - w) * px + 0, y: (boxH - h) * py + 0, w, h };
}

