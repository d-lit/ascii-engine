export interface VideoFormat {
  readonly mimeType: string;
  readonly ext: 'mp4' | 'webm';
  readonly label: string;
  /** Same format with a sound track; null when this browser cannot record it with audio. */
  readonly audioMimeType?: string | null;
}

/** Audio codecs to try per container, preferred first (AAC is what social media expects in MP4). */
const AUDIO_CODECS = { mp4: ['mp4a.40.2', 'opus'], webm: ['opus'] } as const;

/** `video/mp4;codecs=avc1` + `opus` -> `video/mp4;codecs=avc1,opus`; a bare type keeps the browser's default. */
export function withAudioCodec(mimeType: string, audio: string): string {
  return mimeType.includes('codecs=') ? `${mimeType},${audio}` : mimeType;
}

/**
 * Preferred first. MP4/H.264 plays everywhere social media goes; WebM is the
 * fallback for browsers whose MediaRecorder has no MP4 (Firefox, older Chrome).
 */
export const FORMAT_CANDIDATES: readonly VideoFormat[] = [
  { mimeType: 'video/mp4;codecs=avc1.640033', ext: 'mp4', label: 'MP4 · H.264 high' },
  { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4', label: 'MP4 · H.264' },
  { mimeType: 'video/mp4', ext: 'mp4', label: 'MP4' },
  { mimeType: 'video/webm;codecs=vp9', ext: 'webm', label: 'WebM · VP9' },
  { mimeType: 'video/webm;codecs=vp8', ext: 'webm', label: 'WebM · VP8' },
  { mimeType: 'video/webm', ext: 'webm', label: 'WebM' },
];

/** Supported formats in preference order; at most one per container. */
export function supportedFormats(isSupported: (mime: string) => boolean): VideoFormat[] {
  const out: VideoFormat[] = [];
  for (const f of FORMAT_CANDIDATES) {
    if (out.some((o) => o.ext === f.ext)) continue;
    if (!isSupported(f.mimeType)) continue;
    const audio = AUDIO_CODECS[f.ext].map((a) => withAudioCodec(f.mimeType, a)).find((m) => isSupported(m));
    out.push({ ...f, audioMimeType: audio ?? null });
  }
  return out;
}

/** Bits per second for a frame size and fps; text needs far more than film. */
export function bitrateFor(width: number, height: number, fps: number, quality: VideoQuality): number {
  const bitsPerPixel = quality === 'high' ? 0.3 : quality === 'medium' ? 0.15 : 0.08;
  return Math.round(width * height * fps * bitsPerPixel);
}

export type VideoQuality = 'low' | 'medium' | 'high';

/** `photo-neon-tide.mp4`: source name without extension, preset slug. */
export function videoFileName(source: string, preset: string, ext: string): string {
  const dot = source.lastIndexOf('.');
  const base = dot > 0 ? source.slice(0, dot) : source;
  const slug = (s: string): string =>
    s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  const parts = [slug(base), slug(preset)].filter((p) => p !== '');
  return `${parts.join('-') || 'ascii'}.${ext}`;
}

export interface RecorderOptions {
  format: VideoFormat;
  fps: number;
  bitsPerSecond: number;
  /** Sound to record along; needs `format.audioMimeType`. */
  audio?: MediaStreamTrack | null;
}

/**
 * Real-time capture of a canvas (MediaRecorder + captureStream). Records what
 * is drawn, including pointer interaction; frames follow the render loop, so
 * a dropped frame on screen is a dropped frame in the file.
 */
export class CanvasRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  // Paused time is left out of `elapsed`: pausedAt >= 0 while paused.
  private pausedAt = -1;
  private pausedFor = 0;

  get recording(): boolean {
    return this.recorder !== null;
  }

  /** Seconds since start, 0 when idle. */
  get elapsed(): number {
    if (this.recorder === null) return 0;
    const now = this.pausedAt >= 0 ? this.pausedAt : performance.now();
    return (now - this.startedAt - this.pausedFor) / 1000;
  }

  start(canvas: HTMLCanvasElement, opts: RecorderOptions): void {
    if (this.recorder !== null) throw new Error('CanvasRecorder: already recording');
    const stream = canvas.captureStream(opts.fps);
    const audio = opts.audio ?? null;
    const audioMime = opts.format.audioMimeType ?? null;
    const withAudio = audio !== null && audioMime !== null;
    if (withAudio) stream.addTrack(audio);
    const recorder = new MediaRecorder(stream, {
      mimeType: withAudio ? audioMime : opts.format.mimeType,
      videoBitsPerSecond: opts.bitsPerSecond,
    });
    this.chunks = [];
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    });
    // Timeslice: data arrives in pieces, so a long take does not sit in one buffer.
    recorder.start(1000);
    this.recorder = recorder;
    this.startedAt = performance.now();
    this.pausedAt = -1;
    this.pausedFor = 0;
  }

  get paused(): boolean {
    return this.pausedAt >= 0;
  }

  /** Pauses with the transport: the file simply has no paused stretch. */
  pause(): void {
    if (this.recorder === null || this.pausedAt >= 0) return;
    this.recorder.pause();
    this.pausedAt = performance.now();
  }

  resume(): void {
    if (this.recorder === null || this.pausedAt < 0) return;
    this.recorder.resume();
    this.pausedFor += performance.now() - this.pausedAt;
    this.pausedAt = -1;
  }

  /** Stops and resolves with the finished file. */
  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (recorder === null) return Promise.reject(new Error('CanvasRecorder: not recording'));
    this.recorder = null;
    return new Promise((resolve, reject) => {
      recorder.addEventListener('stop', () => {
        // The audio track belongs to the player and lives on.
        for (const track of recorder.stream.getVideoTracks()) track.stop();
        resolve(new Blob(this.chunks, { type: recorder.mimeType }));
      });
      recorder.addEventListener('error', () => reject(new Error('MediaRecorder failed')));
      recorder.stop();
    });
  }
}
