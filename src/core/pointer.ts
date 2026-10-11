import type { Pointer } from './context.ts';

// Velocity smoothing time constant, seconds.
const VELOCITY_TAU = 0.06;

export interface GridRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Client pixels -> fractional cell coords; cell centres sit on integers. */
export function clientToCell(
  clientX: number,
  clientY: number,
  rect: GridRect,
  cols: number,
  rows: number,
  out: { x: number; y: number },
): void {
  out.x = ((clientX - rect.left) / rect.width) * cols - 0.5;
  out.y = ((clientY - rect.top) / rect.height) * rows - 0.5;
}

/** Frame-rate independent exponential smoothing toward `target`. */
export function smoothToward(current: number, target: number, dt: number, tau: number): number {
  if (dt <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/**
 * Tracks pointer events on an element and exposes them as a Pointer in cell
 * coordinates. Events only record raw state; `tick` turns movement into a
 * smoothed velocity once per frame, so it decays to 0 when the pointer stops.
 */
export class PointerInput {
  readonly pointer: Pointer = { x: -1, y: -1, vx: 0, vy: 0, inside: false, down: false, clicked: false };
  private readonly el: HTMLElement;
  private readonly grid: () => { cols: number; rows: number };
  private readonly raw = { x: -1, y: -1 };
  private prevX = -1;
  private prevY = -1;
  private hasPrev = false;
  private readonly abort = new AbortController();

  constructor(el: HTMLElement, grid: () => { cols: number; rows: number }) {
    this.el = el;
    this.grid = grid;
    el.style.touchAction = 'none';
    const opts = { signal: this.abort.signal };

    el.addEventListener('pointermove', (e) => this.move(e), opts);
    el.addEventListener('pointerenter', (e) => this.move(e), opts);
    el.addEventListener(
      'pointerdown',
      (e) => {
        this.move(e);
        el.setPointerCapture(e.pointerId);
        this.pointer.down = true;
        this.pointer.clicked = true;
      },
      opts,
    );
    const up = (e: PointerEvent): void => {
      this.pointer.down = false;
      // Touch has no hover: a lifted finger is gone.
      if (e.pointerType !== 'mouse') this.leave();
    };
    el.addEventListener('pointerup', up, opts);
    el.addEventListener('pointercancel', up, opts);
    el.addEventListener('pointerleave', () => this.leave(), opts);
  }

  /** Call once per frame before the pipeline. */
  tick(dt: number): void {
    const p = this.pointer;
    p.x = this.raw.x;
    p.y = this.raw.y;

    let tx = 0;
    let ty = 0;
    if (p.inside && this.hasPrev && dt > 0) {
      tx = (p.x - this.prevX) / dt;
      ty = (p.y - this.prevY) / dt;
    }
    p.vx = smoothToward(p.vx, tx, dt, VELOCITY_TAU);
    p.vy = smoothToward(p.vy, ty, dt, VELOCITY_TAU);

    this.prevX = p.x;
    this.prevY = p.y;
    this.hasPrev = p.inside;
  }

  dispose(): void {
    this.abort.abort();
  }

  private move(e: PointerEvent): void {
    const { cols, rows } = this.grid();
    clientToCell(e.clientX, e.clientY, this.el.getBoundingClientRect(), cols, rows, this.raw);
    this.pointer.inside = true;
  }

  private leave(): void {
    this.pointer.inside = false;
    this.hasPrev = false;
  }
}
