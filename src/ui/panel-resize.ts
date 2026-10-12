const STORAGE_KEY = 'ascii-engine.panel-width';
const MIN_WIDTH = 280;
// The stage keeps at least this much room.
const MIN_STAGE = 320;

function maxWidth(): number {
  return Math.max(MIN_WIDTH, Math.min(900, window.innerWidth - MIN_STAGE));
}

function clampWidth(w: number): number {
  return Math.round(Math.min(Math.max(w, MIN_WIDTH), maxWidth()));
}

function readStored(): number | null {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function store(w: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(w));
  } catch {
    // Storage may be blocked; the width just won't persist.
  }
}

/**
 * Drag handle on the panel's left edge. Width lives in the `--panel-w` CSS
 * variable on `root` and is remembered per browser; double-click resets it.
 * The stage refits through its ResizeObserver.
 */
export function makePanelResizable(root: HTMLElement, panel: HTMLElement, defaultWidth: number): void {
  const apply = (w: number): void => {
    root.style.setProperty('--panel-w', `${clampWidth(w)}px`);
  };
  apply(readStored() ?? defaultWidth);

  const handle = document.createElement('div');
  handle.className = 'panel-handle';
  handle.title = 'drag to resize, double-click to reset';
  panel.before(handle);

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    root.classList.add('resizing');
    const startX = e.clientX;
    const startW = panel.getBoundingClientRect().width;
    const move = (ev: PointerEvent): void => apply(startW + (startX - ev.clientX));
    const up = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      root.classList.remove('resizing');
      store(Math.round(panel.getBoundingClientRect().width));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });

  handle.addEventListener('dblclick', () => {
    apply(defaultWidth);
    store(defaultWidth);
  });

  // Keep the stage usable when the window shrinks.
  window.addEventListener('resize', () => apply(panel.getBoundingClientRect().width));
}
