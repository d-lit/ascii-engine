export type Polarity = 'light-on-dark' | 'dark-on-light';

export interface Field {
  readonly cols: number;
  readonly rows: number;
  lum: Float32Array;
  alpha: Float32Array;
  color: Uint8ClampedArray | null;
  char: Uint16Array | null;
  gradX: Float32Array | null;
  gradY: Float32Array | null;
}

export interface FieldMeta {
  cellAspect: number;
  polarity: Polarity;
}

/** Per-frame mutable target. Effects write here; `source` stays untouched. */
/**
 * Freely placed glyphs drawn over the grid (SPEC 6.3). A sprite shows the
 * glyph and colour of its source cell `src` as resolved this frame, at `x, y`
 * in cell units (the cell's top-left corner at integers), times `alpha`.
 * Filled by systems each frame; `count` is how many are live.
 */
export interface SpritePool {
  count: number;
  readonly capacity: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly src: Int32Array;
  readonly alpha: Float32Array;
}

export function createSpritePool(capacity: number): SpritePool {
  return {
    count: 0,
    capacity,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    src: new Int32Array(capacity),
    alpha: new Float32Array(capacity),
  };
}

export interface WorkBuffer {
  readonly cols: number;
  readonly rows: number;
  lum: Float32Array;
  alpha: Float32Array;
  color: Uint8ClampedArray | null;
  /** Cell background plate, RGBA per cell; null when no plates are used (DECISIONS 021). */
  plate: Uint8ClampedArray | null;
  char: Uint16Array;
  charOverride: Uint16Array;
  /**
   * 1 = the cell is drawn by a sprite this frame and left empty in the grid
   * (its data stays for the sprite). Written by systems (SPEC 6.3).
   */
  hidden: Uint8Array;
  /** One slot per cell: a system moves at most every cell. */
  sprites: SpritePool;
  /**
   * How much of last frame's sprite layer stays (0..1, 0 = cleared): tails
   * behind moving sprites. Set by systems each frame (`trails`).
   */
  spriteFade: number;
}

export interface FieldOptions {
  color?: boolean;
  char?: boolean;
  grad?: boolean;
}

export function idx(cols: number, x: number, y: number): number {
  return y * cols + x;
}

export function createField(cols: number, rows: number, opts: FieldOptions = {}): Field {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
    throw new Error(`createField: bad size ${cols}x${rows}`);
  }
  const n = cols * rows;
  return {
    cols,
    rows,
    lum: new Float32Array(n),
    alpha: new Float32Array(n),
    color: opts.color === true ? new Uint8ClampedArray(n * 3) : null,
    char: opts.char === true ? new Uint16Array(n) : null,
    gradX: opts.grad === true ? new Float32Array(n) : null,
    gradY: opts.grad === true ? new Float32Array(n) : null,
  };
}

export function createWorkBuffer(cols: number, rows: number, opts: FieldOptions = {}): WorkBuffer {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
    throw new Error(`createWorkBuffer: bad size ${cols}x${rows}`);
  }
  const n = cols * rows;
  return {
    cols,
    rows,
    lum: new Float32Array(n),
    alpha: new Float32Array(n),
    color: opts.color === true ? new Uint8ClampedArray(n * 3) : null,
    plate: null,
    char: new Uint16Array(n),
    charOverride: new Uint16Array(n),
    hidden: new Uint8Array(n),
    sprites: createSpritePool(n),
    spriteFade: 0,
  };
}

/** Allocation-free refill of `dst` from `src`; sizes must match. */
export function copyFieldToWork(src: Field, dst: WorkBuffer): void {
  if (src.cols !== dst.cols || src.rows !== dst.rows) {
    throw new Error(
      `copyFieldToWork: size mismatch ${src.cols}x${src.rows} -> ${dst.cols}x${dst.rows}`,
    );
  }
  dst.lum.set(src.lum);
  dst.alpha.set(src.alpha);

  if (dst.color !== null) {
    if (src.color !== null) dst.color.set(src.color);
    else dst.color.fill(0);
  }

  if (src.char !== null) dst.char.set(src.char);
  else dst.char.fill(0);

  dst.charOverride.fill(0);
}
