export interface TransportActions {
  /** `|<`: effects (and later the track) back to zero. */
  toStart(): void;
  /** `▶ / ⏸`. */
  togglePlay(): void;
  /** `>|`: one frame forward, while paused. */
  step(): void;
  /** `●`: start or stop recording. */
  toggleRecord(): void;
}

/** Scrub bar: where it may go, and what to do when released. */
export interface TransportSeek {
  /** Jump to `seconds` of transport time. */
  seek(seconds: number): void;
}

/** `m:ss.cc` for the transport counter. */
export function formatClock(seconds: number): string {
  const cs = Math.max(0, Math.floor(seconds * 100));
  const m = Math.floor(cs / 6000);
  const s = Math.floor(cs / 100) % 60;
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Keyboard shortcut for a key event, or null (SPEC 10.1). */
export function transportKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): keyof TransportActions | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 'Home':
      return 'toStart';
    case ' ':
      return 'togglePlay';
    case 'ArrowRight':
      return 'step';
    case 'r':
    case 'R':
      return 'toggleRecord';
    default:
      return null;
  }
}

/** Fields where keys type text or pick values; shortcuts stay out of them. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'button';
}

function iconButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', () => {
    onClick();
    // Keep Space for the transport, not for re-clicking this button.
    b.blur();
  });
  return b;
}

/**
 * Transport bar over the bottom of the stage (SPEC 10.1): start, play /
 * pause, frame step, record and the clock. An overlay: never in the frame.
 */
export class TransportBar {
  private readonly bar = document.createElement('div');
  private readonly play: HTMLButtonElement;
  private readonly stepButton: HTMLButtonElement;
  private readonly record: HTMLButtonElement;
  private readonly clock = document.createElement('output');
  private readonly scrub = document.createElement('input');
  private shownClock = '';
  private dragging = false;
  private length = 0;

  constructor(stage: HTMLElement, actions: TransportActions & TransportSeek) {
    this.bar.className = 'transport';
    this.play = iconButton('⏸', 'pause (Space)', () => actions.togglePlay());
    this.stepButton = iconButton('>|', 'next frame (→), while paused', () => actions.step());
    this.record = iconButton('●', 'record (R), settings on the export tab', () => actions.toggleRecord());
    this.record.classList.add('rec');
    this.scrub.type = 'range';
    this.scrub.min = '0';
    this.scrub.step = 'any';
    this.scrub.title = 'drag to seek';
    this.scrub.addEventListener('pointerdown', () => (this.dragging = true));
    this.scrub.addEventListener('input', () => {
      this.dragging = true;
      this.showClock(Number(this.scrub.value));
    });
    this.scrub.addEventListener('change', () => {
      this.dragging = false;
      actions.seek(Number(this.scrub.value));
      this.scrub.blur();
    });
    this.bar.append(
      iconButton('|<', 'to start (Home)', () => actions.toStart()),
      this.play,
      this.stepButton,
      this.record,
      this.scrub,
      this.clock,
    );
    this.bar.hidden = true;
    stage.append(this.bar);

    window.addEventListener('keydown', (e) => {
      if (this.bar.hidden || typing(e.target)) return;
      const action = transportKey(e);
      if (action === null) return;
      e.preventDefault();
      // A focused panel button would also fire on Space; drop its focus.
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      actions[action]();
    });
  }

  set visible(v: boolean) {
    this.bar.hidden = !v;
  }

  /**
   * Reflects the state; cheap to call every frame. `length` is the scrub
   * range (the track, or a default that grows with the clock).
   */
  update(playing: boolean, recording: boolean, seconds: number, length: number): void {
    const play = playing ? '⏸' : '▶';
    if (this.play.textContent !== play) {
      this.play.textContent = play;
      this.play.title = playing ? 'pause (Space)' : 'play (Space)';
    }
    this.stepButton.disabled = playing;
    this.record.classList.toggle('on', recording);
    this.scrub.disabled = recording;
    if (length !== this.length) {
      this.length = length;
      this.scrub.max = String(length);
    }
    if (this.dragging) return;
    this.scrub.value = String(Math.min(seconds, length));
    this.showClock(seconds);
  }

  private showClock(seconds: number): void {
    const text = formatClock(seconds);
    if (text !== this.shownClock) {
      this.clock.textContent = text;
      this.shownClock = text;
    }
  }
}
