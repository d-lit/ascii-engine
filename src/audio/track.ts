/** How a track lines up with the transport clock (SPEC 7.2). */
export interface TrackTiming {
  /** Track length, seconds. */
  duration: number;
  /** Where in the track the transport's zero sits, seconds. */
  offset: number;
  /** Repeat `[offset, duration]` instead of going silent at the end. */
  loop: boolean;
}

/** One pass of the track from `offset`, seconds. */
export function trackSpan(t: TrackTiming): number {
  return Math.max(0, t.duration - Math.max(0, t.offset));
}

/** Track position for transport clock `clock`, or null while the track is silent. */
export function trackPosition(clock: number, t: TrackTiming): number | null {
  const span = trackSpan(t);
  if (clock < 0 || span <= 0) return null;
  const offset = Math.max(0, t.offset);
  if (t.loop) return offset + (clock % span);
  return clock < span ? offset + clock : null;
}
