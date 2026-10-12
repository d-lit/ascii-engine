import type { Field, FieldMeta } from '../core/field.ts';
import type { EffectLookup, PresetEffect } from '../presets/preset.ts';
import { applyChain } from '../presets/preset.ts';
import type { ColorSettings } from '../pipeline/colorize.ts';
import { createPointer, Pipeline } from '../pipeline/pipeline.ts';
import { layoutFrame, type FrameLayout } from '../render/canvas2d.ts';
import { createFramePainter, type FrameLook } from './frame-painter.ts';
import type { PointerTrack } from './pointer-track.ts';
import { EXPORT_SAMPLE_RATE, renderTrackSlice } from '../audio/slice.ts';
import type { TrackTiming } from '../audio/track.ts';

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
  /** Sound codec of this container: AAC in MP4, Opus in WebM. */
  readonly audioCodec: 'aac' | 'opus';
  readonly label: string;
  /** Keeps a transparent backdrop transparent (VP9 alpha in WebM). */
  readonly alpha: boolean;
}

/** MP4 first: the format social media accepts everywhere. */
export const OFFLINE_FORMATS: readonly OfflineFormat[] = [
  { ext: 'mp4', codec: 'avc', audioCodec: 'aac', label: 'MP4 · H.264', alpha: false },
  { ext: 'webm', codec: 'vp9', audioCodec: 'opus', label: 'WebM · VP9', alpha: true },
];

/**
 * Whether a format encodes here: `ok`; `size` — the browser has the encoder,
 * but not for this size / bitrate / fps; `none` — no encoder at all (e.g.
 * Chromium builds without proprietary codecs have no H.264).
 */
export type FormatSupport = 'ok' | 'size' | 'none';

/** Reference job every real encoder handles: tells `size` from `none`. */
const REFERENCE = { width: 1280, height: 720, bitsPerSecond: 4_000_000, fps: 30 };

/** Support of each offline format at this size, bitrate and fps. */
export async function probeOfflineFormats(
  width: number,
  height: number,
  bitsPerSecond: number,
  fps: number,
): Promise<FormatSupport[]> {
  const mb = await import('./mux.ts');
  const can = (codec: OfflineFormat['codec'], w: number, h: number, bps: number, frameRate: number): Promise<boolean> =>
    mb.canEncodeVideo(codec, { width: w, height: h, quality: new mb.Quality(bps), frameRate });
  return Promise.all(
    OFFLINE_FORMATS.map(async (f) => {
      if (await can(f.codec, width, height, bitsPerSecond, fps)) return 'ok';
      const r = REFERENCE;
      return (await can(f.codec, r.width, r.height, r.bitsPerSecond, r.fps)) ? 'size' : 'none';
    }),
  );
}

export { layoutFrame, type FrameLayout };

/** Bitrate of exported sound. */
export const AUDIO_BITS_PER_SECOND = 192_000;

/** Whether each offline format can carry sound in this browser (no substitution: SPEC 12.1). */
export async function probeOfflineAudio(): Promise<boolean[]> {
  const mb = await import('./mux.ts');
  const quality = new mb.Quality(AUDIO_BITS_PER_SECOND);
  return Promise.all(
    OFFLINE_FORMATS.map((f) =>
      mb.canEncodeAudio(f.audioCodec, { numberOfChannels: 2, sampleRate: EXPORT_SAMPLE_RATE, quality }),
    ),
  );
}

/** The look of the frame (`cols`/`rows`/`cellAspect`/`polarity` come from the source). */
export interface OfflineJob extends Omit<FrameLook, 'cols' | 'rows' | 'cellAspect' | 'polarity'> {
  source: Field;
  meta: FieldMeta;
  chain: readonly PresetEffect[];
  lookup: EffectLookup;
  color: ColorSettings;
  fps: number;
  seconds: number;
  bitsPerSecond: number;
  format: OfflineFormat;
  /** Pointer path to replay; null = no pointer (outside the picture). */
  track: PointerTrack | null;
  /** Sound to put under the video, from the transport's zero; null = silent. */
  audio: { buffer: AudioBuffer; timing: TrackTiming } | null;
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
  if (!(await mb.canEncodeVideo(codec, { width, height, quality, frameRate: fps }))) {
    throw new Error(`this browser cannot encode ${job.format.label} at ${width}×${height}`);
  }
  const useMp4 = ext === 'mp4';

  // Frame canvas and compositor at the target size.
  const painter = createFramePainter({
    ...job,
    cols,
    rows,
    cellAspect: job.meta.cellAspect,
    polarity: job.meta.polarity,
  });
  const canvas = painter.canvas;

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
  // Alpha only when there is transparency to keep and the format can carry it
  // (DECISIONS 020): VP9 writes it as side data in WebM.
  const keepAlpha = job.backdrop.kind === 'transparent' && job.format.alpha;
  const videoSource = new mb.CanvasSource(canvas, { codec, quality, alpha: keepAlpha ? 'keep' : 'discard' });
  output.addVideoTrack(videoSource, { frameRate: fps });
  let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null;
  let audioSlice: AudioBuffer | null = null;
  if (job.audio !== null) {
    audioSlice = await renderTrackSlice(job.audio.buffer, job.audio.timing, job.seconds);
    audioSource = new mb.AudioBufferSource({ codec: job.format.audioCodec, quality: new mb.Quality(AUDIO_BITS_PER_SECOND) });
    output.addAudioTrack(audioSource);
  }
  await output.start();
  // Sound goes in alongside the frames; awaited at the end (the muxer
  // interleaves, so waiting for it first could stall on the video track).
  const audioDone = audioSource !== null && audioSlice !== null ? audioSource.add(audioSlice) : Promise.resolve();
  audioDone.catch(() => undefined);

  const step = 1 / fps;
  const total = Math.max(1, Math.round(job.seconds * fps));
  try {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new DOMException('render cancelled', 'AbortError');
      const t = (i + 1) * step;
      if (job.track !== null) job.track.apply(t, t - step, pointer);
      painter.paint(pipeline.frame(step));
      await videoSource.add(i * step, step);
      onProgress(i + 1, total);
    }
    await audioDone;
    audioSource?.close();
    await output.finalize();
  } catch (err) {
    await output.cancel();
    throw err;
  }

  const buffer = target.buffer;
  if (buffer === null) throw new Error('renderOffline: encoder produced no data');
  return { blob: new Blob([buffer], { type: useMp4 ? 'video/mp4' : 'video/webm' }), ext };
}
