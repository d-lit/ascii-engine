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
export interface WorkBuffer {
  readonly cols: number;
  readonly rows: number;
  lum: Float32Array;
  alpha: Float32Array;
  color: Uint8ClampedArray | null;
  char: Uint16Array;
  charOverride: Uint16Array;
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
    char: new Uint16Array(n),
    charOverride: new Uint16Array(n),
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
