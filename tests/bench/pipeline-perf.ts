// CPU cost of one pipeline frame at the SPEC 12 target size (200x100).
// Not part of `npm run check`. Run: node tests/bench/pipeline-perf.ts
// Allocation check (SPEC 12): count young-generation GCs inside the measured loop;
// 0 means no per-frame allocation:
//   ONLY=erosion node --trace-gc tests/bench/pipeline-perf.ts \
//     | sed -n '/measure start/,/measure end/p' | grep -c Scavenge
// Keep measured loops inside functions: top-level module code allocates on its own.
import { createField } from '../../src/core/field.ts';
import { decode } from '../../src/effects/cell/decode.ts';
import { erosion } from '../../src/effects/cell/erosion.ts';
import { pulse } from '../../src/effects/cell/pulse.ts';
import { wave } from '../../src/effects/cell/wave.ts';
import type { AnyEffectDef } from '../../src/effects/types.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

// The project has no @types/node; this script needs just these bits.
declare const process: {
  env: Record<string, string | undefined>;
};

const COLS = 200;
const ROWS = 100;
const WARMUP = 200;
const FRAMES = 600;

function makePipeline(defs: AnyEffectDef[]): Pipeline {
  const src = createField(COLS, ROWS);
  for (let i = 0; i < src.lum.length; i++) {
    src.lum[i] = (i % COLS) / COLS;
    src.alpha[i] = 1;
  }
  const pointer = createPointer();
  pointer.x = COLS / 2;
  pointer.y = ROWS / 2;
  const p = new Pipeline(src, { cellAspect: 0.55, polarity: 'light-on-dark' }, pointer);
  // Long scramble keeps decode in its most expensive state.
  for (const def of defs) p.add(def, def === decode ? { speed: 400, scramble: 30, jitter: 0 } : {});
  return p;
}

function measure(defs: AnyEffectDef[]): { median: number; p95: number } {
  const p = makePipeline(defs);
  for (let i = 0; i < WARMUP; i++) p.frame(1 / 60);
  const times = new Float64Array(FRAMES);
  if (only !== undefined) console.log('--- measure start');
  for (let i = 0; i < FRAMES; i++) {
    const t0 = performance.now();
    p.frame(1 / 60);
    times[i] = performance.now() - t0;
  }
  if (only !== undefined) console.log('--- measure end');
  times.sort();
  return {
    median: times[FRAMES >> 1]!,
    p95: times[Math.floor(FRAMES * 0.95)]!,
  };
}

const cases: Array<[string, AnyEffectDef[]]> = [
  ['copy only', []],
  ['wave', [wave]],
  ['pulse', [pulse]],
  ['erosion', [erosion]],
  ['decode', [decode]],
  ['all four', [wave, pulse, erosion, decode]],
];

// ONLY=<case name> runs a single case, e.g. with --trace-gc to count scavenges.
const only = process.env.ONLY;
console.log(`pipeline.frame ${COLS}x${ROWS}, ${FRAMES} frames`);
for (const [name, defs] of cases) {
  if (only !== undefined && name !== only) continue;
  const r = measure(defs);
  console.log(
    `${name.padEnd(10)} median ${r.median.toFixed(2).padStart(6)} ms  p95 ${r.p95.toFixed(2).padStart(6)} ms`,
  );
}
