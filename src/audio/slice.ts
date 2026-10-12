import type { TrackTiming } from './track.ts';

/** Sample rate of exported audio: Opus needs 48 kHz, AAC takes it too. */
export const EXPORT_SAMPLE_RATE = 48_000;

/**
 * The stretch of the track a video of `seconds` hears: from `offset`,
 * repeated when looping, silent past the end; resampled to 48 kHz, at most
 * two channels. Rendered by the browser (OfflineAudioContext).
 */
export async function renderTrackSlice(buffer: AudioBuffer, timing: TrackTiming, seconds: number): Promise<AudioBuffer> {
  const channels = Math.min(2, buffer.numberOfChannels);
  const length = Math.max(1, Math.round(seconds * EXPORT_SAMPLE_RATE));
  const ctx = new OfflineAudioContext(channels, length, EXPORT_SAMPLE_RATE);
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.loop = timing.loop;
  node.loopStart = Math.max(0, timing.offset);
  node.loopEnd = buffer.duration;
  node.connect(ctx.destination);
  node.start(0, Math.min(Math.max(0, timing.offset), buffer.duration));
  return ctx.startRendering();
}
