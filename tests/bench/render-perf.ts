// CPU cost of composing one frame (render minus putImageData) at 200x110.
// Not part of `npm run check`. Run: node tests/bench/render-perf.ts
// Allocation check: ONLY=<case> node --trace-gc ... as in pipeline-perf.ts.
import { createField } from '../../src/core/field.ts';
import { makeRamp } from '../../src/core/ramp.ts';
import { decode } from '../../src/effects/cell/decode.ts';
import { erosion } from '../../src/effects/cell/erosion.ts';
import { pulse } from '../../src/effects/cell/pulse.ts';
import { wave } from '../../src/effects/cell/wave.ts';
import { liquid } from '../../src/effects/displace/liquid.ts';
import { ripple } from '../../src/effects/displace/ripple.ts';
import type { AnyEffectDef } from '../../src/effects/types.ts';
import type { ColorSettings } from '../../src/pipeline/colorize.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';
import { Compositor, type MaskSource } from '../../src/render/compositor.ts';

declare const process: { env: Record<string, string | undefined> };

const COLS = 200;
const ROWS = 110;
const WARMUP = 120;
const FRAMES = 400;
const ramp = makeRamp(' .:-=+*#%@', [0, 0.08, 0.15, 0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1]);

/** Every glyph gets a pseudo-random antialiased tile, like real text masks. */
function fakeMasks(w: number, h: number): MaskSource {
  const slots = new Int32Array(0x10000).fill(-1);
  let count = 0;
  const src = {
    cellW: w,
    cellH: h,
    data: new Uint8Array(256 * w * h),
    slot(code: number): number {
      if (code === 32) return -1;
      if (slots[code]! >= 0) return slots[code]!;
      const s = count++;
      for (let p = 0; p < w * h; p++) src.data[s * w * h + p] = (code * 31 + p * 17) & 255;
      slots[code] = s;
      return s;
    },
  };
  return src;
}

const GRADIENT: ColorSettings = {
  mode: 'gradient',
  stops: [
    { pos: 0, color: '#1b1a4a' },
    { pos: 0.5, color: '#d0386b' },
    { pos: 1, color: '#ffd27a' },
  ],
};

function measure(
  defs: AnyEffectDef[],
  cellW: number,
  cellH: number,
  color?: ColorSettings,
): [number, number] {
  const field = createField(COLS, ROWS);
  for (let i = 0; i < field.lum.length; i++) {
    field.lum[i] = (i % COLS) / COLS;
    field.alpha[i] = 1;
  }
  const pointer = createPointer();
  pointer.x = COLS / 2;
  pointer.y = ROWS / 2;
  const p = new Pipeline(field, { cellAspect: 0.55, polarity: 'light-on-dark' }, pointer);
  if (color !== undefined) p.setColor(color, [232, 230, 227]);
  for (const def of defs) p.add(def, def === decode ? { speed: 400, scramble: 30, jitter: 0 } : {});
  const c = new Compositor(COLS, ROWS, cellW, cellH);
  c.setInk([232, 230, 227]);
  const masks = fakeMasks(cellW, cellH);

  const step = (): void => {
    const work = p.frame(1 / 60);
    c.compose(work, ramp, 'light-on-dark', true, 'nearest-density', masks);
  };
  for (let i = 0; i < WARMUP; i++) step();
  if (process.env.ONLY !== undefined) console.log('--- measure start');
  const times = new Float64Array(FRAMES);
  for (let i = 0; i < FRAMES; i++) {
    const w = p.frame(1 / 60);
    const t0 = performance.now();
    c.compose(w, ramp, 'light-on-dark', true, 'nearest-density', masks);
    times[i] = performance.now() - t0;
  }
  if (process.env.ONLY !== undefined) console.log('--- measure end');
  times.sort();
  return [times[FRAMES >> 1]!, times[Math.floor(FRAMES * 0.95)]!];
}

const cases: Array<[string, AnyEffectDef[], ColorSettings?]> = [
  ['static', []],
  ['wave', [wave]],
  ['erosion', [erosion]],
  ['all four', [wave, pulse, erosion, decode]],
  ['ripple+liquid', [ripple, liquid]],
  ['grad static', [], GRADIENT],
  ['grad wave', [wave], GRADIENT],
  ['grad all four', [wave, pulse, erosion, decode], GRADIENT],
  ['grad ripple+liquid', [ripple, liquid], GRADIENT],
  ['plates static', [], { mode: 'mono', stops: [], plates: { mode: 'source', opacity: 0.6 } }],
  ['plates grad wave', [wave], { ...GRADIENT, plates: { mode: 'gradient', opacity: 0.6 } }],
];

const only = process.env.ONLY;
console.log(`compose ${COLS}x${ROWS}, median / p95 ms`);
for (const [w, h] of [
  [6, 11],
  [12, 22],
] as const) {
  for (const [name, defs, color] of cases) {
    if (only !== undefined && name !== only) continue;
    const [med, p95] = measure(defs, w, h, color);
    console.log(`cell ${w}x${h}  ${name.padEnd(19)} ${med.toFixed(2).padStart(6)} / ${p95.toFixed(2).padStart(6)}`);
  }
}
