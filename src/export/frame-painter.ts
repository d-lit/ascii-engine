import type { Rgb } from '../core/color.ts';
import type { Polarity, WorkBuffer } from '../core/field.ts';
import type { Crop, PlacedRect } from '../core/placement.ts';
import { measureRamp, type QuantizeMode } from '../core/ramp.ts';
import { getAtlas } from '../render/atlas.ts';
import { paintFrame, prepareBackdrop, type Backdrop, type BackdropImage } from '../render/backdrop.ts';
import { fillFrame, layoutFrame, pictureRect } from '../render/canvas2d.ts';
import { Compositor } from '../render/compositor.ts';

/** Everything that decides how a work buffer looks in an exported frame. */
export interface FrameLook {
  cols: number;
  rows: number;
  cellAspect: number;
  polarity: Polarity;
  theme: { bg: string; fg: string };
  ink: Rgb;
  backdrop: Backdrop;
  /** Image for an image backdrop; session state, not part of presets. */
  backdropImage: BackdropImage | null;
  /** Where the source picture lies, grid fractions; `grid` backdrops follow it. */
  picture: PlacedRect;
  /** Crop of an image backdrop (cover / contain / stretch fits). */
  backdropCrop: Crop;
  rampChars: string;
  family: string;
  weight: number;
  useSourceChars: boolean;
  quantizeMode: QuantizeMode;
  /** Frame size, pixels. */
  width: number;
  height: number;
  /** Grid fills the frame (fixed canvas) instead of being letterboxed in it. */
  fill: boolean;
}

export interface FramePainter {
  readonly canvas: HTMLCanvasElement;
  /** Composes `work` at the frame's own cell size and paints the full frame. */
  paint(work: WorkBuffer): void;
}

/**
 * Off-screen frame at an exact pixel size: the grid fills it (fixed canvas)
 * or is letterboxed with the largest cell that fits; glyphs are drawn at
 * the frame's cell size, not scaled from the screen. Shared by the offline render and the PNG export.
 */
export function createFramePainter(look: FrameLook): FramePainter {
  const { cols, rows, width, height } = look;
  const layout = look.fill ? fillFrame(cols, rows, width, height) : layoutFrame(cols, rows, look.cellAspect, width, height);
  const font = { family: look.family, weight: look.weight, cellW: layout.cellW, cellH: layout.cellH };
  const ramp = measureRamp(look.rampChars, font);
  const atlas = getAtlas(font);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true });
  const compositor = new Compositor(cols, rows, layout.cellW, layout.cellH);
  const layer = document.createElement('canvas');
  layer.width = compositor.width;
  layer.height = compositor.height;
  const layerCtx = layer.getContext('2d', { alpha: true });
  if (!ctx || !layerCtx) throw new Error('createFramePainter: no 2d context');
  compositor.setInk(look.ink);
  const image = new ImageData(compositor.pixels, compositor.width, compositor.height);
  // Static backdrop at the target size; the grid rect keeps `grid` fit aligned.
  const under = document.createElement('canvas');
  under.width = width;
  under.height = height;
  // Where the glyph layer is drawn: the whole frame, or the letterboxed grid.
  const grid = look.fill
    ? { x: 0, y: 0, w: width, h: height }
    : { x: layout.offsetX, y: layout.offsetY, w: compositor.width, h: compositor.height };
  prepareBackdrop(under, look.backdrop, look.theme.bg, look.backdropImage, pictureRect(grid, look.picture), look.backdropCrop);

  return {
    canvas,
    paint(work: WorkBuffer): void {
      compositor.compose(work, ramp, look.polarity, look.useSourceChars, look.quantizeMode, atlas);
      const { dirtyTop, dirtyBottom } = compositor;
      if (dirtyBottom > dirtyTop) {
        layerCtx.putImageData(image, 0, 0, 0, dirtyTop, compositor.width, dirtyBottom - dirtyTop);
      }
      // Every frame is a full picture: backdrop, then glyphs.
      paintFrame(ctx, layer, under, grid.x, grid.y, grid.w, grid.h);
    },
  };
}
