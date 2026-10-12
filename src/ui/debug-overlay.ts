// Display refresh interval and smoothing for the numbers, seconds.
const REFRESH = 0.25;
const TAU = 0.5;

export interface StageSample {
  readonly name: string;
  ms: number;
}

/**
 * fps and per-stage milliseconds (SPEC 10). Values are smoothed so the text
 * is readable; DOM is touched a few times per second, not every frame.
 */
export class DebugOverlay {
  readonly el: HTMLElement;
  private readonly names: readonly string[];
  private readonly avg: Float64Array;
  private frameAvg = 0;
  private sinceRefresh = 0;
  private extra = '';
  // Live sprites (SPEC 10); shown while a system has produced some.
  private sprites = 0;
  private spritesSeen = false;

  constructor(parent: HTMLElement, stages: readonly string[]) {
    this.names = stages;
    this.avg = new Float64Array(stages.length);
    this.el = document.createElement('pre');
    this.el.className = 'debug-overlay';
    parent.append(this.el);
  }

  /** `stageMs` in the order of `stages`; dt in seconds. */
  sample(dt: number, stageMs: ArrayLike<number>): void {
    if (dt <= 0) return;
    const k = 1 - Math.exp(-dt / TAU);
    this.frameAvg += (dt - this.frameAvg) * k;
    for (let s = 0; s < this.avg.length; s++) {
      this.avg[s]! += ((stageMs[s] ?? 0) - this.avg[s]!) * k;
    }

    this.sinceRefresh += dt;
    if (this.sinceRefresh < REFRESH) return;
    this.sinceRefresh = 0;
    this.draw();
  }

  /** Sprites drawn this frame; cheap, call every frame. */
  setSprites(count: number): void {
    this.sprites = count;
    if (count > 0) this.spritesSeen = true;
  }

  /** Static line shown under the numbers (grid size and so on). */
  setInfo(text: string): void {
    this.extra = text;
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  private draw(): void {
    const fps = this.frameAvg > 0 ? 1 / this.frameAvg : 0;
    let text = `${fps.toFixed(0).padStart(3)} fps`;
    for (let s = 0; s < this.names.length; s++) {
      text += `\n${this.names[s]!.padEnd(7)}${this.avg[s]!.toFixed(2).padStart(6)} ms`;
    }
    if (this.spritesSeen) text += `\n${'sprites'.padEnd(7)}${String(this.sprites).padStart(6)}`;
    if (this.extra) text += `\n${this.extra}`;
    this.el.textContent = text;
  }
}
