import type { Field } from './field.ts';

/**
 * Bilinear sampling with edge clamp (SPEC 5). Cell centres sit on integer
 * coordinates. Small enough for V8 to inline; hot loops that sample several
 * channels at once should still compute weights once (see pipeline displace).
 */
export function sampleChannel(
  data: Float32Array,
  cols: number,
  rows: number,
  x: number,
  y: number,
): number {
  const sx = x < 0 ? 0 : x > cols - 1 ? cols - 1 : x;
  const sy = y < 0 ? 0 : y > rows - 1 ? rows - 1 : y;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = x0 + 1 < cols ? x0 + 1 : x0;
  const y1 = y0 + 1 < rows ? y0 + 1 : y0;
  const fx = sx - x0;
  const fy = sy - y0;
  const r0 = y0 * cols;
  const r1 = y1 * cols;
  const top = data[r0 + x0]! + (data[r0 + x1]! - data[r0 + x0]!) * fx;
  const bottom = data[r1 + x0]! + (data[r1 + x1]! - data[r1 + x0]!) * fx;
  return top + (bottom - top) * fy;
}

export function sampleLum(field: Readonly<Field>, x: number, y: number): number {
  return sampleChannel(field.lum, field.cols, field.rows, x, y);
}

export function sampleAlpha(field: Readonly<Field>, x: number, y: number): number {
  return sampleChannel(field.alpha, field.cols, field.rows, x, y);
}

/**
 * Distance in cell widths: a row is 1 / cellAspect cell widths tall, so equal
 * values mean equal on-screen distance.
 */
export function distIso(dx: number, dy: number, cellAspect: number): number {
  const ry = dy / cellAspect;
  return Math.sqrt(dx * dx + ry * ry);
}

export interface RgbOut {
  r: number;
  g: number;
  b: number;
}

/** Bilinear RGB into `out`; leaves `out` untouched when the field has no colour. */
export function sampleColor(field: Readonly<Field>, x: number, y: number, out: RgbOut): void {
  const color = field.color;
  if (color === null) return;
  const { cols, rows } = field;
  const sx = x < 0 ? 0 : x > cols - 1 ? cols - 1 : x;
  const sy = y < 0 ? 0 : y > rows - 1 ? rows - 1 : y;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = x0 + 1 < cols ? x0 + 1 : x0;
  const y1 = y0 + 1 < rows ? y0 + 1 : y0;
  const fx = sx - x0;
  const fy = sy - y0;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const i00 = (y0 * cols + x0) * 3;
  const i10 = (y0 * cols + x1) * 3;
  const i01 = (y1 * cols + x0) * 3;
  const i11 = (y1 * cols + x1) * 3;
  out.r = color[i00]! * w00 + color[i10]! * w10 + color[i01]! * w01 + color[i11]! * w11;
  out.g = color[i00 + 1]! * w00 + color[i10 + 1]! * w10 + color[i01 + 1]! * w01 + color[i11 + 1]! * w11;
  out.b = color[i00 + 2]! * w00 + color[i10 + 2]! * w10 + color[i01 + 2]! * w01 + color[i11 + 2]! * w11;
}
