import type { Pipeline } from '../pipeline/pipeline.ts';

const COLOR = '#7dd3a0';
const MASK_COLOR = '#d6a2ff';
const ARM = 6;

/**
 * Debug view of effect centres (SPEC 7.1): a cross per point parameter, a
 * ring per radial mask, labelled with the effect name. A separate canvas
 * over the picture, so nothing reaches the frame or the exports.
 */
export class CentersOverlay {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly view: HTMLElement;
  private readonly stage: HTMLElement;

  constructor(stage: HTMLElement, view: HTMLElement) {
    this.stage = stage;
    this.view = view;
    this.canvas.className = 'centers-overlay';
    stage.append(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('CentersOverlay: no 2d context');
    this.ctx = ctx;
  }

  set visible(v: boolean) {
    this.canvas.hidden = !v;
  }

  /** `cellW`/`cellH` in CSS pixels. */
  draw(pipeline: Pipeline, cellW: number, cellH: number): void {
    if (this.canvas.hidden) return;
    const v = this.view.getBoundingClientRect();
    const s = this.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(v.width * dpr);
    const h = Math.round(v.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    Object.assign(this.canvas.style, {
      left: `${v.left - s.left}px`,
      top: `${v.top - s.top}px`,
      width: `${v.width}px`,
      height: `${v.height}px`,
    });

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, v.width, v.height);
    ctx.font = '10px ui-monospace, monospace';
    ctx.lineWidth = 1.5;
    pipeline.forEachCenter((x, y, label, mask) => {
      const px = (x + 0.5) * cellW;
      const py = (y + 0.5) * cellH;
      ctx.strokeStyle = ctx.fillStyle = mask ? MASK_COLOR : COLOR;
      ctx.beginPath();
      if (mask) ctx.arc(px, py, ARM, 0, Math.PI * 2);
      else {
        ctx.moveTo(px - ARM, py);
        ctx.lineTo(px + ARM, py);
        ctx.moveTo(px, py - ARM);
        ctx.lineTo(px, py + ARM);
      }
      ctx.stroke();
      ctx.fillText(mask ? `${label} mask` : label, px + ARM + 2, py - ARM);
    });
  }
}
