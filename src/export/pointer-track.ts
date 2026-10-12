import type { Pointer } from '../core/context.ts';

const FLAG_INSIDE = 1;
const FLAG_DOWN = 2;
const FLAG_CLICK = 4;

/**
 * Pointer state sampled once per frame against pipeline time, so an offline
 * render can replay a live take exactly (DECISIONS 012: same source, seed, dt
 * and pointer give the same frames). Arrays grow by doubling while recording.
 */
export class PointerTrack {
  private t = new Float64Array(256);
  private x = new Float32Array(256);
  private y = new Float32Array(256);
  private flags = new Uint8Array(256);
  private n = 0;

  get length(): number {
    return this.n;
  }

  /** Time of the last sample, seconds. */
  get duration(): number {
    return this.n === 0 ? 0 : this.t[this.n - 1]!;
  }

  clear(): void {
    this.n = 0;
  }

  /** Samples must arrive in non-decreasing time. */
  push(time: number, p: Readonly<Pointer>): void {
    if (this.n === this.t.length) this.grow();
    const i = this.n++;
    this.t[i] = time;
    this.x[i] = p.x;
    this.y[i] = p.y;
    this.flags[i] = (p.inside ? FLAG_INSIDE : 0) | (p.down ? FLAG_DOWN : 0) | (p.clicked ? FLAG_CLICK : 0);
  }

  /**
   * Writes the state at `time` into `out`: position interpolated between
   * samples, inside/down from the latest sample at or before `time`, `clicked`
   * if a click sample falls in `(prevTime, time]`. Velocity comes from the
   * positions at `time` and `prevTime`.
   */
  apply(time: number, prevTime: number, out: Pointer): void {
    if (this.n === 0) {
      out.inside = false;
      out.down = false;
      out.clicked = false;
      out.vx = 0;
      out.vy = 0;
      return;
    }
    const i = this.indexAt(time);
    const flags = this.flags[Math.max(i, 0)]!;
    this.positionAt(time, i, out);
    const x1 = out.x;
    const y1 = out.y;
    this.positionAt(prevTime, this.indexAt(prevTime), out);
    const dt = time - prevTime;
    out.vx = dt > 0 ? (x1 - out.x) / dt : 0;
    out.vy = dt > 0 ? (y1 - out.y) / dt : 0;
    out.x = x1;
    out.y = y1;
    out.inside = i >= 0 && (flags & FLAG_INSIDE) !== 0;
    out.down = i >= 0 && (flags & FLAG_DOWN) !== 0;

    let clicked = false;
    for (let k = Math.max(i, 0); k >= 0 && this.t[k]! > prevTime; k--) {
      if (this.t[k]! <= time && (this.flags[k]! & FLAG_CLICK) !== 0) clicked = true;
    }
    out.clicked = clicked;
  }

  /** Last sample index with t <= time, or -1. */
  private indexAt(time: number): number {
    let lo = 0;
    let hi = this.n - 1;
    if (this.t[0]! > time) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.t[mid]! <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private positionAt(time: number, i: number, out: Pointer): void {
    if (i < 0) {
      out.x = this.x[0]!;
      out.y = this.y[0]!;
      return;
    }
    const j = i + 1;
    if (j >= this.n) {
      out.x = this.x[i]!;
      out.y = this.y[i]!;
      return;
    }
    const span = this.t[j]! - this.t[i]!;
    const f = span > 0 ? (time - this.t[i]!) / span : 0;
    out.x = this.x[i]! + (this.x[j]! - this.x[i]!) * f;
    out.y = this.y[i]! + (this.y[j]! - this.y[i]!) * f;
  }

  private grow(): void {
    const size = this.t.length * 2;
    const t = new Float64Array(size);
    const x = new Float32Array(size);
    const y = new Float32Array(size);
    const flags = new Uint8Array(size);
    t.set(this.t);
    x.set(this.x);
    y.set(this.y);
    flags.set(this.flags);
    this.t = t;
    this.x = x;
    this.y = y;
    this.flags = flags;
  }
}
