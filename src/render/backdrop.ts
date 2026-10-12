/**
 * What lies under the glyph layer (DECISIONS 020). Step 3 of phase 4.7 adds
 * an image backdrop; it is session state, never stored in presets.
 */
export type Backdrop =
  | { kind: 'theme' }
  | { kind: 'color'; color: string }
  | { kind: 'transparent' };

export const BACKDROP_KINDS = ['theme', 'color', 'transparent'] as const;

/** CSS fill for the backdrop, or null for a transparent frame. */
export function backdropFill(backdrop: Backdrop, themeBg: string): string | null {
  switch (backdrop.kind) {
    case 'theme':
      return themeBg;
    case 'color':
      return backdrop.color;
    case 'transparent':
      return null;
  }
}

/**
 * Builds one frame: backdrop, then the glyph layer at (x, y). The browser
 * does the alpha blending (GPU), so the compositor never blends per pixel.
 */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  layer: CanvasImageSource,
  fill: string | null,
  x: number,
  y: number,
): void {
  const { width, height } = ctx.canvas;
  if (fill === null) ctx.clearRect(0, 0, width, height);
  else {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(layer, x, y);
}
