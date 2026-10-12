import type { Rgb } from '../core/color.ts';
import type { Field, FieldMeta, Polarity } from '../core/field.ts';
import { measureRamp, type QuantizeMode } from '../core/ramp.ts';
import type { EffectLookup, PresetEffect } from '../presets/preset.ts';
import { applyChain } from '../presets/preset.ts';
import type { ColorSettings } from '../pipeline/colorize.ts';
import { createPointer, Pipeline } from '../pipeline/pipeline.ts';
import { getAtlas } from '../render/atlas.ts';
import { fitCell } from '../render/canvas2d.ts';
import { Compositor } from '../render/compositor.ts';
import type { PointerTrack } from './pointer-track.ts';

/** Output frame sizes; `screen` keeps the on-screen canvas size. */
export const FRAME_SIZES = {
  screen: null,
  '1080×1080': [1080, 1080],
  '1080×1350': [1080, 1350],
  '1080×1920': [1080, 1920],
  '1920×1080': [1920, 1080],
} as const;
export type FrameSizeName = keyof typeof FRAME_SIZES;

export interface OfflineFormat {
  readonly ext: 'mp4' | 'webm';
  readonly codec: 'avc' | 'vp9';
  readonly label: string;
}

/** MP4 first: the format social media accepts everywhere. */
export const OFFLINE_FORMATS: readonly OfflineFormat[] = [
  { ext: 'mp4', codec: 'avc', label: 'MP4 · H.264' },
  { ext: 'webm', codec: 'vp9', label: 'WebM · VP9' },
];

/** Which offline formats this browser can encode at this size and bitrate. */
export async function probeOfflineFormats(width: number, height: number, bitsPerSecond: number): Promise<boolean[]> {
  const mb = await import('./mux.ts');
  const quality = new mb.Quality(bitsPerSecond);
  return Promise.all(OFFLINE_FORMATS.map((f) => mb.canEncodeVideo(f.codec, { width, height, quality })));
}

export interface FrameLayout {
  cellW: number;
  cellH: number;
  /** Grid offset inside the frame, pixels; the rest is background. */
  offsetX: number;
  offsetY: number;
}

/**
 * Largest aspect-correct integral cell that fits the grid into `width x
 * height`, grid centred (letterboxed). Offsets are even so the grid sits on
 * the same pixel grid as the encoder's chroma blocks.
 */
export function layoutFrame(cols: number, rows: number, cellAspect: number, width: number, height: number): FrameLayout {
  const cell = fitCell(Math.floor(width / cols), Math.floor(height / rows), cellAspect);
  const offsetX = ((width - cols * cell.w) >> 2) * 2;
  const offsetY = ((height - rows * cell.h) >> 2) * 2;
  return { cellW: cell.w, cellH: cell.h, offsetX, offsetY };
}

export interface OfflineJob {
  source: Field;
  meta: FieldMeta;
  chain: readonly PresetEffect[];
  lookup: EffectLookup;
  color: ColorSettings;
  theme: { bg: string; fg: string };
  ink: Rgb;
  bg: Rgb;
  rampChars: string;
  family: string;
  weight: number;
  useSourceChars: boolean;
  quantizeMode: QuantizeMode;
  width: number;
  height: number;
  fps: number;
  seconds: number;
  bitsPerSecond: number;
  format: OfflineFormat;
  /** Pointer path to replay; null = no pointer (outside the picture). */
  track: PointerTrack | null;
}

export interface OfflineResult {
  blob: Blob;
  ext: string;
}

export type ProgressFn = (done: number, total: number) => void;

/**
 * Renders frame by frame at an exact 1/fps step and encodes with WebCodecs
 * (via mediabunny, loaded on first use). Never drops frames: it runs as fast
 * as the machine allows, slower or faster than real time. Uses its own
 * pipeline, so the live view is untouched.
 */
export async function renderOffline(job: OfflineJob, onProgress: ProgressFn, signal: AbortSignal): Promise<OfflineResult> {
  const mb = await import('./mux.ts');
  const { width, height, fps } = job;
  const { cols, rows } = job.source;

  // The chosen format or nothing: no silent fallback to another container.
  const quality = new mb.Quality(job.bitsPerSecond);
  const { codec, ext } = job.format;
  if (!(await mb.canEncodeVideo(codec, { width, height, quality }))) {
    throw new Error(`this browser cannot encode ${job.format.label} at ${width}×${height}`);
  }
  const useMp4 = ext === 'mp4';

  // Frame canvas and compositor at the target size.
  const layout = layoutFrame(cols, rows, job.meta.cellAspect, width, height);
  const font = { family: job.family, weight: job.weight, cellW: layout.cellW, cellH: layout.cellH };
  const ramp = measureRamp(job.rampChars, font);
  const atlas = getAtlas(font);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('renderOffline: no 2d context');
  ctx.fillStyle = job.theme.bg;
  ctx.fillRect(0, 0, width, height);
  const compositor = new Compositor(cols, rows, layout.cellW, layout.cellH);
  compositor.setColors(job.bg, job.ink);
  const image = new ImageData(compositor.pixels, compositor.width, compositor.height);

  // Fresh pipeline with the same chain and default seed: replays the live take.
  const pointer = createPointer();
  const pipeline = new Pipeline(job.source, job.meta, pointer);
  pipeline.setColor(job.color, job.ink);
  applyChain(pipeline, job.chain, job.lookup);

  const target = new mb.BufferTarget();
  const output = new mb.Output({
    format: useMp4 ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
    target,
  });
  const videoSource = new mb.CanvasSource(canvas, { codec, quality });
  output.addVideoTrack(videoSource, { frameRate: fps });
  await output.start();

  const polarity: Polarity = job.meta.polarity;
  const step = 1 / fps;
  const total = Math.max(1, Math.round(job.seconds * fps));
  try {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new DOMException('render cancelled', 'AbortError');
      const t = (i + 1) * step;
      if (job.track !== null) job.track.apply(t, t - step, pointer);
      const work = pipeline.frame(step);
      compositor.compose(work, ramp, polarity, job.useSourceChars, job.quantizeMode, atlas);
      if (compositor.dirtyBottom > compositor.dirtyTop) {
        ctx.putImageData(
          image,
          layout.offsetX,
          layout.offsetY,
          0,
          compositor.dirtyTop,
          compositor.width,
          compositor.dirtyBottom - compositor.dirtyTop,
        );
      }
      await videoSource.add(i * step, step);
      onProgress(i + 1, total);
    }
    await output.finalize();
  } catch (err) {
    await output.cancel();
    throw err;
  }

  const buffer = target.buffer;
  if (buffer === null) throw new Error('renderOffline: encoder produced no data');
  return { blob: new Blob([buffer], { type: useMp4 ? 'video/mp4' : 'video/webm' }), ext };
}
