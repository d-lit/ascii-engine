/**
 * Browser bench (task 017, chunk 5): the real renderer at 200 columns,
 * scenario by scenario, timed with requestAnimationFrame. Not part of the
 * app: served by Vite at /bench/ and driven by scripts/bench-browser.ts,
 * which reads `window.__bench`.
 */
import { parseHex } from '../core/color.ts';
import type { FieldMeta } from '../core/field.ts';
import { importPixels } from '../core/import-image.ts';
import { BUILTIN_RAMP_CHARS, measureRampSet } from '../core/ramp.ts';
import { registerBuiltinEffects } from '../effects/builtin.ts';
import { getEffect } from '../effects/registry.ts';
import { createPointer, MAX_DT, Pipeline } from '../pipeline/pipeline.ts';
import { BUILTIN_PRESETS } from '../presets/builtin.ts';
import { applyChain, validatePreset, type Preset } from '../presets/preset.ts';
import type { ParamInput } from '../pipeline/params.ts';
import { Canvas2DRenderer } from '../render/canvas2d.ts';

const COLS = 200;
const CELL_ASPECT = 0.55;
const WARMUP = 1;
const MEASURE = 5;
const THEMES = {
  'light-on-dark': { bg: '#0b0b0d', fg: '#e8e6e3' },
  'dark-on-light': { bg: '#f4f1ea', fg: '#16151a' },
} as const;

interface Scenario {
  name: string;
  preset: string;
  /** Changes to the preset's chain, by effect id. */
  tweak?: Record<string, Record<string, ParamInput>>;
  /** Called every frame with seconds since the measured part began (negative in warm-up). */
  drive?: (t: number, pointer: ReturnType<typeof createPointer>) => void;
}

export interface ScenarioResult {
  name: string;
  frames: number;
  fps: number;
  frameP50: number;
  frameP95: number;
  /** CPU per frame: pipeline + render, ms. */
  cpuP50: number;
  cpuP95: number;
  stages: Record<string, number>;
  maxSprites: number;
}

const clickAt = (when: number, x: number, y: number) => {
  let done = false;
  return (t: number, p: ReturnType<typeof createPointer>): void => {
    if (!done && t >= when) {
      p.x = x;
      p.y = y;
      p.inside = true;
      p.clicked = true;
      done = true;
    }
  };
};

const SCENARIOS: Scenario[] = [
  { name: 'baseline: Liquid portrait', preset: 'Liquid portrait' },
  { name: 'colour + plates: Ember glow', preset: 'Ember glow' },
  { name: 'particles intro: Shatter', preset: 'Shatter', drive: () => undefined },
  {
    name: 'whole-picture blast + tails: Comets',
    preset: 'Comets',
    tweak: { particles: { intro: 'none', explode: 160, radius: 400 } },
    // A blast every 2 s keeps everything in the air.
    drive: (() => {
      let next = 0;
      return (t: number, p: ReturnType<typeof createPointer>) => {
        if (t >= next) {
          p.x = COLS / 2;
          p.y = 55;
          p.inside = true;
          p.clicked = true;
          next += 2;
        }
      };
    })(),
  },
  { name: 'sand, heavy crumble: Crumble', preset: 'Crumble', tweak: { sand: { crumble: 0.12 } } },
  { name: 'click blast, radius 30', preset: 'Shatter', tweak: { particles: { intro: 'none' } }, drive: clickAt(0.5, 100, 55) },
];

/** A photo-like test picture: gradients, soft discs, some texture. */
function testPixels(size: number): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const disc = Math.max(0, 1 - Math.hypot(u - 0.45, v - 0.42) * 2.6);
      const ring = 0.5 + 0.5 * Math.sin(Math.hypot(u - 0.7, v - 0.75) * 40);
      const grain = ((x * 73856093) ^ (y * 19349663)) & 15;
      const o = (y * size + x) * 4;
      data[o] = 40 + 180 * disc + 30 * ring + grain;
      data[o + 1] = 30 + 120 * v + 80 * disc + grain;
      data[o + 2] = 60 + 140 * (1 - u) * (1 - disc) + grain;
      data[o + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] ?? 0;
}

async function runScenario(s: Scenario, renderer: Canvas2DRenderer, log: (line: string) => void): Promise<ScenarioResult> {
  const raw = BUILTIN_PRESETS.find((p) => (p as { name: string }).name === s.preset);
  if (raw === undefined) throw new Error(`bench: no preset ${s.preset}`);
  const { preset } = validatePreset(raw, getEffect);
  const chain = (preset as Preset).chain.map((e) => (s.tweak?.[e.effect] ? { ...e, params: { ...e.params, ...s.tweak[e.effect] } } : e));

  const meta: FieldMeta = { cellAspect: CELL_ASPECT, polarity: preset.polarity };
  const pixels = testPixels(800);
  const rows = Math.round(COLS * CELL_ASPECT);
  const field = importPixels(pixels, { cols: COLS, rows, cellAspect: CELL_ASPECT, color: true });
  renderer.resize(COLS, rows, CELL_ASPECT);
  const theme = THEMES[preset.polarity];
  renderer.setBackdrop(preset.backdrop);
  const ramp = measureRampSet(BUILTIN_RAMP_CHARS[preset.ramp], renderer.font);
  const pointer = createPointer();
  const pipeline = new Pipeline(field, meta, pointer);
  pipeline.setColor(preset.color, parseHex(theme.fg));
  applyChain(pipeline, chain, getEffect);

  const dts: number[] = [];
  const cpu: number[] = [];
  const stages = { params: 0, sample: 0, cell: 0, system: 0, post: 0, render: 0 };
  let maxSprites = 0;
  let last = await nextFrame();
  const start = last;
  for (;;) {
    const now = await nextFrame();
    const dt = (now - last) / 1000;
    last = now;
    const t = (now - start) / 1000 - WARMUP;
    if (t > MEASURE) break;
    s.drive?.(t, pointer);
    const t0 = performance.now();
    const work = pipeline.frame(Math.min(dt, MAX_DT));
    const t1 = performance.now();
    renderer.render(work, ramp, meta);
    const t2 = performance.now();
    if (t < 0) continue;
    dts.push(dt * 1000);
    cpu.push(t2 - t0);
    const tm = pipeline.timings;
    stages.params += tm.params;
    stages.sample += tm.sample;
    stages.cell += tm.cell;
    stages.system += tm.system;
    stages.post += tm.post;
    stages.render += t2 - t1;
    if (work.sprites.count > maxSprites) maxSprites = work.sprites.count;
  }
  const frames = dts.length;
  for (const k of Object.keys(stages) as Array<keyof typeof stages>) stages[k] = Number((stages[k] / frames).toFixed(2));
  const result: ScenarioResult = {
    name: s.name,
    frames,
    fps: Number((frames / dts.reduce((a, b) => a + b, 0) * 1000).toFixed(1)),
    frameP50: Number(percentile(dts, 0.5).toFixed(2)),
    frameP95: Number(percentile(dts, 0.95).toFixed(2)),
    cpuP50: Number(percentile(cpu, 0.5).toFixed(2)),
    cpuP95: Number(percentile(cpu, 0.95).toFixed(2)),
    stages,
    maxSprites,
  };
  log(`${s.name}: ${result.fps} fps, cpu p95 ${result.cpuP95} ms, sprites ${maxSprites}`);
  return result;
}

declare global {
  interface Window {
    __bench?: { done: boolean; results: ScenarioResult[]; error?: string; info: string };
  }
}

async function main(): Promise<void> {
  const logEl = document.getElementById('log')!;
  const lines: string[] = [];
  const log = (line: string): void => {
    lines.push(line);
    logEl.textContent = lines.join('\n');
  };
  const state: NonNullable<Window['__bench']> = { done: false, results: [], info: '' };
  window.__bench = state;
  try {
    registerBuiltinEffects();
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    const renderer = new Canvas2DRenderer(canvas, {
      family: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      weight: 400,
      themes: THEMES,
      useSourceChars: true,
      quantizeMode: 'nearest-density',
    });
    const only = new URLSearchParams(location.search).get('only');
    for (const s of SCENARIOS) {
      if (only !== null && !s.name.includes(only)) continue;
      log(`running ${s.name}…`);
      state.results.push(await runScenario(s, renderer, log));
    }
    const font = renderer.font;
    state.info = `${COLS}×${Math.round(COLS * CELL_ASPECT)} cells, cell ${font.cellW}×${font.cellH} px, canvas ${canvas.width}×${canvas.height}, dpr ${window.devicePixelRatio}`;
    log(state.info);
  } catch (err) {
    state.error = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    log(`error: ${state.error}`);
  }
  state.done = true;
}

void main();
