import { trackPosition, trackSpan, type TrackTiming } from './track.ts';

// Playback further than this from the transport clock is re-seeked.
const RESYNC = 0.08;

/**
 * The session's audio track (SPEC 7.2, 10.1): decoding, playback in step
 * with the transport, a muteable monitor and a separate feed for recording.
 * Never stored in presets.
 */
export class AudioPlayer {
  name = '';
  offset = 0;
  loop = false;
  private buffer_: AudioBuffer | null = null;
  private ctx: AudioContext | null = null;
  private monitor: GainNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private node: AudioBufferSourceNode | null = null;
  // Transport clock and context time at which the node starts sounding.
  private startClock = 0;
  private startCtx = 0;
  private muted_ = false;

  get buffer(): AudioBuffer | null {
    return this.buffer_;
  }

  get timing(): TrackTiming | null {
    const b = this.buffer_;
    return b === null ? null : { duration: b.duration, offset: this.offset, loop: this.loop };
  }

  /** One pass from `offset`, seconds; 0 without a track. */
  get span(): number {
    const t = this.timing;
    return t === null ? 0 : trackSpan(t);
  }

  get muted(): boolean {
    return this.muted_;
  }

  set muted(on: boolean) {
    this.muted_ = on;
    if (this.monitor !== null) this.monitor.gain.value = on ? 0 : 1;
  }

  /** Decodes a file; call from a user gesture (the audio context starts there). */
  async load(file: File): Promise<void> {
    const ctx = this.context();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    this.stop();
    this.buffer_ = buffer;
    this.name = file.name;
    this.offset = 0;
  }

  clear(): void {
    this.stop();
    this.buffer_ = null;
    this.name = '';
    this.offset = 0;
  }

  /** Browsers start audio only after a user gesture; call from one. */
  wake(): void {
    if (this.ctx !== null && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Silences now; the next `sync` resumes in step (hidden tab: frames stop). */
  halt(): void {
    this.stop();
  }

  /** Offset or loop changed: the next `sync` starts playback afresh. */
  invalidate(): void {
    this.stop();
  }

  /**
   * Keeps playback matching the transport; once per frame, before the
   * pipeline advances. `clock` is the transport time of the last frame.
   */
  sync(playing: boolean, clock: number): void {
    const timing = this.timing;
    const ctx = this.ctx;
    if (!playing || timing === null || ctx === null) {
      this.stop();
      return;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    const pos = trackPosition(clock, timing);
    if (pos === null) {
      this.stop();
      return;
    }
    if (this.node !== null && Math.abs(this.heardClock() - clock) <= RESYNC) return;
    this.start(pos, clock);
  }

  /**
   * Transport time the listener hears now, or -1 when the track is not
   * playing. Frames advance to it, so the picture follows the sound.
   */
  clockNow(): number {
    return this.node === null ? -1 : this.heardClock();
  }

  /** Audio for recording: the track before the mute. */
  recordTrack(): MediaStreamTrack | null {
    if (this.buffer_ === null) return null;
    const ctx = this.context();
    if (this.recordDest === null) {
      this.recordDest = ctx.createMediaStreamDestination();
      // Already playing: feed the recording from now on.
      this.node?.connect(this.recordDest);
    }
    return this.recordDest.stream.getAudioTracks()[0] ?? null;
  }

  private context(): AudioContext {
    if (this.ctx === null) {
      this.ctx = new AudioContext();
      this.monitor = this.ctx.createGain();
      this.monitor.gain.value = this.muted_ ? 0 : 1;
      this.monitor.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private heardClock(): number {
    const ctx = this.ctx;
    if (ctx === null) return -1;
    // What is audible right now, between audio callbacks: smooth, latency included.
    const ts = ctx.getOutputTimestamp();
    const heard =
      ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0
        ? ts.contextTime + (performance.now() - ts.performanceTime) / 1000
        : ctx.currentTime;
    return this.startClock + (heard - this.startCtx);
  }

  private start(pos: number, clock: number): void {
    const ctx = this.ctx;
    const buffer = this.buffer_;
    if (ctx === null || buffer === null || this.monitor === null) return;
    this.stop();
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = this.loop;
    node.loopStart = Math.max(0, this.offset);
    node.loopEnd = buffer.duration;
    node.connect(this.monitor);
    if (this.recordDest !== null) node.connect(this.recordDest);
    node.start(0, pos);
    this.node = node;
    this.startClock = clock;
    this.startCtx = ctx.currentTime;
  }

  private stop(): void {
    const node = this.node;
    if (node === null) return;
    this.node = null;
    try {
      node.stop();
    } catch {
      // Already stopped.
    }
    node.disconnect();
  }
}
