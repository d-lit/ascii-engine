import { AUDIO_BANDS, sampleBand, type BandTable } from '../audio/bands.ts';
import { trackPosition, type TrackTiming } from '../audio/track.ts';

/**
 * Live levels of the four bands at the transport time (DECISIONS 028): what
 * drives `audio` and `step` params right now, with marks to read thresholds
 * against. Cheap: four style writes per frame, only while shown.
 */
export class BandMeters {
  readonly el = document.createElement('div');
  private readonly bars: HTMLElement[] = [];
  private readonly values: HTMLElement[] = [];

  constructor() {
    this.el.className = 'band-meters';
    for (const band of AUDIO_BANDS) {
      const row = document.createElement('div');
      row.className = 'band-meter';
      const label = document.createElement('span');
      label.textContent = band;
      const track = document.createElement('div');
      track.className = 'band-track';
      const bar = document.createElement('div');
      bar.className = 'band-bar';
      track.append(bar);
      const value = document.createElement('output');
      row.append(label, track, value);
      this.el.append(row);
      this.bars.push(bar);
      this.values.push(value);
    }
  }

  /** Levels at transport time `time`; all zero without a track or past it. */
  update(bands: BandTable | null, timing: TrackTiming | null, time: number): void {
    if (this.el.offsetParent === null) return; // hidden tab or section
    const pos = bands === null || timing === null ? null : trackPosition(time, timing);
    for (let b = 0; b < AUDIO_BANDS.length; b++) {
      // Raw level, as `step` thresholds see it (no attack / release).
      const v = pos === null || bands === null ? 0 : sampleBand(bands, AUDIO_BANDS[b]!, pos, 0, 0);
      this.bars[b]!.style.width = `${(v * 100).toFixed(1)}%`;
      this.values[b]!.textContent = v.toFixed(2);
    }
  }
}
