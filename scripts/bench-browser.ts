/**
 * Runs the browser bench (src/bench/bench.ts) in a real Chrome and prints
 * the numbers. `yarn run bench:browser [--headless] [--only <name part>]
 * [--chrome <path>]`. Headed by default: a headless browser often draws in
 * software, which is slower than what the user sees.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

interface Result {
  name: string;
  frames: number;
  fps: number;
  frameP50: number;
  frameP95: number;
  cpuP50: number;
  cpuP95: number;
  stages: Record<string, number>;
  maxSprites: number;
}

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};
const headless = args.includes('--headless');
const only = flag('--only');
// A Chromium Playwright can drive: --chrome, else the newest one Playwright
// downloaded (a Flatpak Chrome cannot be driven).
const executablePath = flag('--chrome') ?? (await findChromium());

async function findChromium(): Promise<string> {
  const { readdir, access } = await import('node:fs/promises');
  const { homedir } = await import('node:os');
  const root = `${homedir()}/.cache/ms-playwright`;
  const dirs = (await readdir(root).catch(() => [] as string[]))
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  for (const d of dirs) {
    const path = `${root}/${d}/chrome-linux/chrome`;
    if (await access(path).then(() => true, () => false)) return path;
  }
  throw new Error('bench: no Chromium found; pass --chrome <path>');
}

const server = await createServer({ logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (base === undefined) throw new Error('bench: Vite gave no URL');

const browser = await chromium.launch({
  executablePath,
  headless,
  args: [
    '--ozone-platform=x11',
    // A HiDPI-like screen: 2 physical pixels per CSS pixel, so the 700-px
    // stage gives cells of about 6×11 physical pixels, as on a laptop.
    '--force-device-scale-factor=2',
    '--window-size=900,800',
    // Keep timing honest when the window is not focused.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
try {
  const page = await browser.newPage({ viewport: null });
  page.on('pageerror', (err) => console.error('page error:', err.message));
  const url = new URL('bench/index.html', base);
  if (only !== null) url.searchParams.set('only', only);
  await page.goto(url.href);
  await page.waitForFunction(() => window.__bench?.done === true, undefined, { timeout: 5 * 60_000, polling: 500 });
  const state = await page.evaluate(() => window.__bench);
  if (state === undefined) throw new Error('bench: no results');
  if (state.error !== undefined) throw new Error(`bench failed in the page:\n${state.error}`);

  const version = browser.version();
  console.log(`\n${version}${headless ? ' (headless)' : ''} · ${state.info}\n`);
  const rows = (state.results as Result[]).map((r) => ({
    scenario: r.name,
    fps: r.fps,
    'frame p50/p95, ms': `${r.frameP50} / ${r.frameP95}`,
    'cpu p50/p95, ms': `${r.cpuP50} / ${r.cpuP95}`,
    'pipeline, ms': Number((r.stages.params! + r.stages.sample! + r.stages.cell! + r.stages.system! + r.stages.post!).toFixed(2)),
    'system, ms': r.stages.system,
    'render, ms': r.stages.render,
    sprites: r.maxSprites,
  }));
  console.table(rows);
} finally {
  await browser.close();
  await server.close();
}
