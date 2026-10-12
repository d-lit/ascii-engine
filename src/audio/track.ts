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

/**
 * Track stretches heard between two transport times, for beat lookups:
 * calls `visit(from, to)` with half-open `(from, to]` ranges (two when a
 * loop wraps). Nothing when the clock does not advance.
 */
export function forEachHeard(prev: number, clock: number, t: TrackTiming, visit: (from: number, to: number) => void): void {
  if (clock <= prev) return;
  const span = trackSpan(t);
  if (span <= 0 || clock < 0) return;
  const offset = Math.max(0, t.offset);
  const end = offset + span;
  // From the transport's zero the very first instant of the track counts too.
  const a = prev <= 0 ? offset - 1e-9 : (trackPosition(prev, t) ?? end);
  const b = trackPosition(clock, t);
  if (b === null) {
    if (a < end) visit(a, end);
  } else if (b >= a) {
    visit(a, b);
  } else {
    // A loop wrapped within the frame.
    visit(a, end);
    visit(offset - 1e-9, b);
  }
}

/** Track position for transport clock `clock`, or null while the track is silent. */
export function trackPosition(clock: number, t: TrackTiming): number | null {
  const span = trackSpan(t);
  if (clock < 0 || span <= 0) return null;
  const offset = Math.max(0, t.offset);
  if (t.loop) return offset + (clock % span);
  return clock < span ? offset + clock : null;
}
