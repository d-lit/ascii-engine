import './style.css';
import { createField, type Field, type FieldMeta, type Polarity, type WorkBuffer } from './core/field.ts';
import { createLoop } from './core/loop.ts';
import { PointerInput } from './core/pointer.ts';
import { computeRows, importPixels, placeInGrid, readPixels, type Pixels } from './core/import-image.ts';
import {
  DEFAULT_CROP,
  DEFAULT_PLACEMENT,
  PLACE_FITS,
  ZOOM_MAX,
  ZOOM_MIN,
  type Crop,
  type Placement,
} from './core/placement.ts';
import { importText, normalizeText } from './core/import-text.ts';
import {
  BUILTIN_RAMP_CHARS,
  createDensityMeasurer,
  measureRamp,
  type QuantizeMode,
  type Ramp,
  type RampName,
} from './core/ramp.ts';
import { registerBuiltinEffects } from './effects/builtin.ts';
import { getEffect, listEffects } from './effects/registry.ts';
import {
  COLOR_MODES,
  DEFAULT_PLATES,
  DEFAULT_STOPS,
  PLATE_MODES,
  GRADIENT_PALETTES,
  type ColorSettings,
} from './pipeline/colorize.ts';
import { MAX_DT, Pipeline } from './pipeline/pipeline.ts';
import { PointerTrack } from './export/pointer-track.ts';
import { createFramePainter, type FrameLook } from './export/frame-painter.ts';
import {
  FRAME_SIZES,
  OFFLINE_FORMATS,
  probeOfflineFormats,
  renderOffline,
  type FrameSizeName,
} from './export/offline-render.ts';
import { chainToPreset } from './presets/preset.ts';
import { MAX_STOPS } from './presets/preset.ts';
import { parseHex } from './core/color.ts';
import { Canvas2DRenderer } from './render/canvas2d.ts';
import { positionEditor } from './ui/point-control.ts';
import { exportText } from './render/export-text.ts';
import {
  BACKDROP_KINDS,
  BLUR_MAX,
  DEFAULT_IMAGE_BACKDROP,
  IMAGE_FITS,
  IMAGE_ORIGINS,
  type Backdrop,
  type BackdropImage,
  type ImageBackdrop,
} from './render/backdrop.ts';
import {
  bitrateFor,
  CanvasRecorder,
  supportedFormats,
  videoFileName,
  type VideoQuality,
} from './export/video-recorder.ts';
import { button, checkbox, gradientControl, row, selectOf, slider } from './ui/controls.ts';
import { CentersOverlay } from './ui/centers-overlay.ts';
import { createPanelTabs } from './ui/panel-tabs.ts';
import { TransportBar } from './ui/transport.ts';
import { DebugOverlay } from './ui/debug-overlay.ts';
import { ChainPanel, type ViewSettings } from './ui/panel.ts';
import { makePanelResizable } from './ui/panel-resize.ts';

const CELL_ASPECT = 0.55;
const FONT_FAMILY = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const COLS_MIN = 20;
const COLS_MAX = 300;
// Canvas (task 015): `auto` follows the source, the rest are pixel frames.
const CANVAS_SIZES = ['auto', '1080×1080', '1080×1350', '1080×1920', '1920×1080', 'custom'] as const;
type CanvasSize = (typeof CANVAS_SIZES)[number];
const CANVAS_MIN = 64;
const CANVAS_MAX = 4096;
// Longest side of the pixels kept for re-importing the source on crop changes.
const IMPORT_MAX_SIDE = 2048;

type Source =
  | { kind: 'image'; bitmap: ImageBitmap; name: string }
  | { kind: 'text'; text: string; name: string };

interface Settings {
  cols: number;
  ramp: RampName;
  polarity: Polarity;
  quantizeMode: QuantizeMode;
  useSourceChars: boolean;
  trimRight: boolean;
  color: ColorSettings;
  backdrop: Backdrop;
  /** Session settings, never in presets: the canvas and the source crop. */
  canvas: { size: CanvasSize; width: number; height: number };
  place: Placement;
}

const settings: Settings = {
  cols: 120,
  ramp: 'classic',
  polarity: 'light-on-dark',
  quantizeMode: 'nearest-density',
  useSourceChars: true,
  trimRight: true,
  color: { mode: 'mono', stops: [...DEFAULT_STOPS] },
  backdrop: { kind: 'theme' },
  canvas: { size: 'auto', width: 1080, height: 1080 },
  place: { ...DEFAULT_PLACEMENT },
};

/** Fixed canvas in pixels, or null for `auto` (the source's own aspect). */
function canvasFrame(): { width: number; height: number } | null {
  const c = settings.canvas;
  if (c.size === 'auto') return null;
  if (c.size === 'custom') return { width: c.width, height: c.height };
  const [w, h] = c.size.split('×').map(Number);
  return { width: w ?? 1080, height: h ?? 1080 };
}

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`${selector} not found`);
  return node;
}

const canvas = el<HTMLCanvasElement>('#view');
const stage = el<HTMLElement>('#stage');
const panel = el<HTMLElement>('#panel');
makePanelResizable(el<HTMLElement>('#app'), panel, 380);

const THEMES = {
  'light-on-dark': { bg: '#0b0b0d', fg: '#e8e6e3' },
  'dark-on-light': { bg: '#f4f1ea', fg: '#16151a' },
} as const;

const renderer = new Canvas2DRenderer(canvas, {
  family: FONT_FAMILY,
  weight: 400,
  themes: THEMES,
  useSourceChars: settings.useSourceChars,
  quantizeMode: settings.quantizeMode,
});

let source: Source | null = null;
// Source pixels, read once per file (scaled down); imports reuse them.
let sourcePixels: Pixels | null = null;
// Image import is the expensive step; reuse it until the grid or the crop change.
let imageField: Field | null = null;
let imageFieldKey = '';
// Text luminance depends on ramp and polarity; reuse while those hold.
let textField: Field | null = null;
let textFieldRamp: Ramp | null = null;
let textFieldPolarity: Polarity | null = null;

let field: Field | null = null;
let ramp: Ramp | null = null;
let meta: FieldMeta = { cellAspect: CELL_ASPECT, polarity: settings.polarity };
// Last rendered frame, for export.
let lastWork: WorkBuffer | null = null;

const input = new PointerInput(canvas, () => {
  const g = renderer.gridRect;
  const w = canvas.width || 1;
  const h = canvas.height || 1;
  return { cols: field?.cols ?? 1, rows: field?.rows ?? 1, area: { x: g.x / w, y: g.y / h, w: g.w / w, h: g.h / h } };
});

// The pipeline exists from the start (on an empty 1x1 field), so the chain and
// presets can be edited before any picture is loaded.
registerBuiltinEffects();
const pipeline = new Pipeline(createField(1, 1), meta, input.pointer);
const overlay = new DebugOverlay(stage, ['params', 'sample', 'cell', 'post', 'render', 'total']);
const stageMs = new Float64Array(6);
overlay.visible = false;
const centers = new CentersOverlay(stage, canvas);
centers.visible = false;

// ---- rebuild: file, settings or container size changed ----

function gridSize(src: Source): { cols: number; rows: number } {
  if (src.kind === 'image') {
    // The canvas sets the grid's aspect; `auto` takes the picture's.
    const { width, height } = canvasFrame() ?? src.bitmap;
    return { cols: settings.cols, rows: computeRows(width, height, settings.cols, CELL_ASPECT) };
  }
  const lines = normalizeText(src.text);
  return { cols: Math.max(1, lines[0]?.length ?? 0), rows: Math.max(1, lines.length) };
}

const FULL_GRID = { x: 0, y: 0, w: 1, h: 1 };

function rebuild(): void {
  if (source === null) return;

  meta = { cellAspect: CELL_ASPECT, polarity: settings.polarity };
  applyColor();
  const { cols, rows } = gridSize(source);

  // Cell size depends on the grid; ramp densities depend on the cell size.
  renderer.resize(cols, rows, CELL_ASPECT, canvasFrame());
  const font = renderer.font;
  ramp = measureRamp(BUILTIN_RAMP_CHARS[settings.ramp], font);

  let next: Field;
  if (source.kind === 'image') {
    sourcePixels ??= readPixels(source.bitmap, IMPORT_MAX_SIDE);
    const place = settings.place;
    const key = `${cols}×${rows} ${place.fit} ${place.x} ${place.y} ${place.zoom}`;
    if (imageField === null || imageFieldKey !== key) {
      // Colour is always imported; the pipeline copies it only when a colour mode needs it.
      imageField = importPixels(sourcePixels, { cols, rows, cellAspect: CELL_ASPECT, color: true, place });
      imageFieldKey = key;
    }
    next = imageField;
    renderer.setPicture(placeInGrid(sourcePixels.width, sourcePixels.height, cols, rows, CELL_ASPECT, place));
  } else {
    if (textField === null || textFieldRamp !== ramp || textFieldPolarity !== settings.polarity) {
      textField = importText(source.text, ramp, meta, createDensityMeasurer(font)).field;
      textFieldRamp = ramp;
      textFieldPolarity = settings.polarity;
    }
    next = textField;
    renderer.setPicture(FULL_GRID);
  }

  // Effects restart only when the picture itself changes (DECISIONS 012).
  if (next !== field) pipeline.setSource(next, meta);
  field = next;

  // Offline formats at screen size depend on the canvas, which may just have changed.
  if (offline.size === 'screen') void refreshOfflineFormats();
  overlay.setInfo(`${next.cols}×${next.rows} · cell ${font.cellW}×${font.cellH}`);
  setStatus(`${source.name} · ${next.cols}×${next.rows}`);
  loop.start();
}

// ---- frame ----

// Transport (SPEC 10.1): paused = the clock stands and the pointer is
// frozen; frames still run with dt = 0 so panel edits show. A step runs one
// frame of exactly 1/fps, as the offline render does.
let playing = true;
let pendingStep = 0;

function frame(rawDt: number): void {
  if (source === null || ramp === null) return;
  const live = playing;
  const dt = live ? rawDt : pendingStep;
  pendingStep = 0;
  transport.update(playing, recorder.recording, pipeline.ctx.time);
  if (live) input.tick(dt);
  if (live && recorder.recording) {
    // Pointer as this frame will see it, against the time the frame will have.
    takeTrack.push(pipeline.ctx.time + Math.min(Math.max(dt, 0), MAX_DT) - takeStart, input.pointer);
  }
  const work = pipeline.frame(dt);
  lastWork = work;

  const t0 = performance.now();
  renderer.render(work, ramp, meta);
  if (capturing) copyToCapture();
  const renderMs = performance.now() - t0;

  const tm = pipeline.timings;
  stageMs[0] = tm.params;
  stageMs[1] = tm.sample;
  stageMs[2] = tm.cell;
  stageMs[3] = tm.post;
  stageMs[4] = renderMs;
  stageMs[5] = tm.total + renderMs;
  if (live) overlay.sample(dt, stageMs);
  if (debugToggle.checked) {
    // Debug only: gridRect allocates, so not on the normal frame path.
    const dpr = window.devicePixelRatio || 1;
    const g = renderer.gridRect;
    const cols = field?.cols ?? 1;
    const rows = field?.rows ?? 1;
    centers.draw(pipeline, g.w / cols / dpr, g.h / rows / dpr, g.x / dpr, g.y / dpr);
  }
}

const loop = createLoop((dt) => {
  try {
    frame(dt);
  } catch (err) {
    loop.stop();
    console.error(err);
    setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

const transport = new TransportBar(stage, {
  toStart: () => pipeline.restart(),
  togglePlay: () => setPlaying(!playing),
  step: () => {
    // Recording keeps the take continuous: no steps while it runs.
    if (!playing && !recorder.recording) pendingStep = 1 / video.fps;
  },
  toggleRecord: () => {
    if (source !== null && rendering === null) void toggleRecording();
  },
});

function setPlaying(on: boolean): void {
  playing = on;
  if (on) recorder.resume();
  else recorder.pause();
}

function safeRebuild(): void {
  try {
    rebuild();
  } catch (err) {
    console.error(err);
    setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---- loading ----

function isText(file: File): boolean {
  return file.type.startsWith('text/') || /\.(txt|asc|nfo)$/i.test(file.name);
}

async function load(file: File): Promise<void> {
  try {
    if (isText(file)) {
      source = { kind: 'text', text: await file.text(), name: file.name };
    } else {
      if (source?.kind === 'image') source.bitmap.close();
      source = { kind: 'image', bitmap: await createImageBitmap(file), name: file.name };
    }
  } catch (err) {
    console.error(err);
    setStatus(`cannot load ${file.name}`);
    return;
  }
  imageField = null;
  sourcePixels = null;
  textField = null;
  applyBackdrop(); // a `picture` backdrop follows the new source
  stage.classList.add('has-source');
  transport.visible = true;
  overlay.visible = debugToggle.checked;
  centers.visible = debugToggle.checked;
  copyButton.disabled = false;
  pngButton.disabled = false;
  saveButton.disabled = false;
  recordButton.disabled = false;
  renderButton.disabled = false;
  colsRow.hidden = source.kind !== 'image';
  pictureBox.hidden = source.kind !== 'image';
  sourceCharsRow.hidden = source.kind !== 'text';
  safeRebuild();
}

stage.addEventListener('dragover', (e) => {
  e.preventDefault();
  stage.classList.add('drag-over');
});
stage.addEventListener('dragleave', () => stage.classList.remove('drag-over'));
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('drag-over');
  const file = e.dataTransfer?.files[0];
  if (file) void load(file);
});

// ---- panel: view ----

// Three tabs keep the panel short: what is shown, how it moves, how it leaves.
const tabs = createPanelTabs(panel, ['source', 'effects', 'export'] as const);
type Tab = 'source' | 'effects' | 'export';

function section(title: string, tab: Tab): HTMLElement {
  const box = document.createElement('section');
  const h = document.createElement('h3');
  h.textContent = title;
  box.append(h);
  tabs.page(tab).append(box);
  return box;
}

const view = section('view', 'source');

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = 'image/*,.txt,.asc,.nfo,text/plain';
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void load(file);
});

const colsInput = document.createElement('input');
colsInput.type = 'range';
colsInput.min = String(COLS_MIN);
colsInput.max = String(COLS_MAX);
colsInput.value = String(settings.cols);
const colsValue = document.createElement('output');
colsValue.textContent = String(settings.cols);
colsInput.addEventListener('input', () => {
  settings.cols = Number(colsInput.value);
  colsValue.textContent = colsInput.value;
  safeRebuild();
});
const colsRow = row('cols', colsInput, colsValue);

const rampSelect = selectOf(Object.keys(BUILTIN_RAMP_CHARS) as RampName[], settings.ramp, (v) => {
  settings.ramp = v;
  safeRebuild();
});

const polaritySelect = selectOf(['light-on-dark', 'dark-on-light'] as const, settings.polarity, (v) => {
  settings.polarity = v;
  stage.dataset.polarity = v;
  safeRebuild();
});

const quantizeSelect = selectOf(['nearest-density', 'uniform'] as const, settings.quantizeMode, (v) => {
  settings.quantizeMode = v;
  // Render-only setting: the running loop picks it up next frame.
  renderer.setOptions({ quantizeMode: v });
});

const sourceCharsRow = row('source chars', checkbox(settings.useSourceChars, (on) => {
  settings.useSourceChars = on;
  renderer.setOptions({ useSourceChars: on });
}));
sourceCharsRow.hidden = true;

const debugToggle = checkbox(true, (on) => {
  overlay.visible = on && source !== null;
  centers.visible = on && source !== null;
});

view.append(
  row('source', fileInput),
  colsRow,
  row('ramp', rampSelect),
  row('polarity', polaritySelect),
  row('quantize', quantizeSelect),
  sourceCharsRow,
  row('debug', debugToggle),
);

// ---- panel: canvas (task 015) ----

const canvasBox = section('canvas', 'source');

/** Pixel input for a custom canvas side; even, within limits. */
function sideInput(get: () => number, set: (n: number) => void): HTMLInputElement {
  const inputEl = document.createElement('input');
  inputEl.type = 'number';
  inputEl.min = String(CANVAS_MIN);
  inputEl.max = String(CANVAS_MAX);
  inputEl.step = '2';
  inputEl.value = String(get());
  inputEl.addEventListener('change', () => {
    const n = Math.round(Number(inputEl.value) / 2) * 2;
    const v = Number.isFinite(n) ? Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, n)) : get();
    inputEl.value = String(v);
    set(v);
  });
  return inputEl;
}

function canvasChanged(): void {
  customRow.hidden = settings.canvas.size !== 'custom';
  offlineSizeRow.hidden = canvasFrame() !== null;
  safeRebuild();
  void refreshOfflineFormats();
}

const customRow = row(
  'pixels',
  sideInput(() => settings.canvas.width, (n) => {
    settings.canvas.width = n;
    canvasChanged();
  }),
  Object.assign(document.createElement('span'), { textContent: '×' }),
  sideInput(() => settings.canvas.height, (n) => {
    settings.canvas.height = n;
    canvasChanged();
  }),
);
customRow.classList.add('canvas-pixels');
customRow.hidden = true;

// How the source picture sits in the grid: fit, which part shows, zoom.
const pictureBox = document.createElement('div');
pictureBox.hidden = true;
const place = settings.place;
pictureBox.append(
  subhead('source picture'),
  row('fit', selectOf(PLACE_FITS, place.fit, (f) => {
    place.fit = f;
    safeRebuild();
  })),
  ...positionEditor('crop', place, () => safeRebuild(), 0, 1),
  row('zoom', ...slider(ZOOM_MIN, ZOOM_MAX, 0.01, place.zoom, (n) => {
    place.zoom = n;
    safeRebuild();
  })),
);

canvasBox.append(
  row('size', selectOf(CANVAS_SIZES, settings.canvas.size, (v) => {
    settings.canvas.size = v;
    canvasChanged();
  })),
  customRow,
  pictureBox,
);

// ---- panel: colour ----

/** Pushes the colour mode and the theme ink to the pipeline (DECISIONS 015). */
function applyColor(): void {
  pipeline.setColor(settings.color, parseHex(THEMES[settings.polarity].fg));
}

const colorBox = section('color', 'source');
const gradientBox = document.createElement('div');
const colorModeSelect = selectOf(COLOR_MODES, settings.color.mode, (m) => {
  settings.color.mode = m;
  renderGradient();
  applyColor();
});

// Plates: cell backgrounds (DECISIONS 021). `gradient` plates share the stops.
const platesBox = document.createElement('div');

function renderPlates(): void {
  const plates = settings.color.plates ?? { ...DEFAULT_PLATES };
  const modeSelect = selectOf(PLATE_MODES, plates.mode, (m) => {
    settings.color.plates = { ...plates, mode: m };
    renderPlates();
    renderGradient();
    applyColor();
  });
  platesBox.replaceChildren(row('plates', modeSelect));
  if (plates.mode === 'none') return;
  platesBox.append(
    row('plate opacity', ...slider(0, 1, 0.01, plates.opacity, (n) => {
      plates.opacity = n;
      settings.color.plates = plates;
      applyColor();
    })),
  );
}

function renderGradient(): void {
  gradientBox.replaceChildren();
  const used = settings.color.mode === 'gradient' || settings.color.plates?.mode === 'gradient';
  if (!used) return;
  gradientBox.append(gradientControl(settings.color.stops, GRADIENT_PALETTES, MAX_STOPS, applyColor));
}

colorBox.append(row('mode', colorModeSelect), platesBox, gradientBox);
renderPlates();
renderGradient();

// ---- panel: background (DECISIONS 020) ----

// Custom colour kept across mode switches; green is the usual chroma key.
let backdropColor = '#00b140';
// Image backdrop settings kept across mode switches, and the custom image
// itself (session state: never stored in presets).
let imageBackdrop: ImageBackdrop = { ...DEFAULT_IMAGE_BACKDROP };
let customBackdrop: ImageBitmap | null = null;
// Which part of an image backdrop shows (cover / contain / stretch); session only.
const backdropCrop: Crop = { ...DEFAULT_CROP };

const backgroundBox = section('background', 'source');
const backdropColorInput = document.createElement('input');
backdropColorInput.type = 'color';
backdropColorInput.value = backdropColor;
const backdropColorRow = row('colour', backdropColorInput);
const imageBox = document.createElement('div');

/** The picture an image backdrop shows right now, if any. */
function resolveBackdropImage(): BackdropImage | null {
  const b = settings.backdrop;
  if (b.kind !== 'image') return null;
  if (b.origin === 'picture') {
    return source?.kind === 'image' ? { source: source.bitmap, width: source.bitmap.width, height: source.bitmap.height } : null;
  }
  return customBackdrop === null ? null : { source: customBackdrop, width: customBackdrop.width, height: customBackdrop.height };
}

function applyBackdrop(): void {
  renderer.setBackdrop(settings.backdrop, resolveBackdropImage(), backdropCrop);
  backdropColorRow.hidden = settings.backdrop.kind !== 'color';
  renderImageControls();
  // Sections created later (video formats) listen for this.
  panel.dispatchEvent(new Event('backdropchange'));
}

const backdropFile = document.createElement('input');
backdropFile.type = 'file';
backdropFile.accept = 'image/*';
backdropFile.hidden = true;
backdropFile.addEventListener('change', () => {
  const file = backdropFile.files?.[0];
  backdropFile.value = '';
  if (!file) return;
  createImageBitmap(file).then(
    (bitmap) => {
      customBackdrop?.close();
      customBackdrop = bitmap;
      imageBackdrop = { ...imageBackdrop, origin: 'custom' };
      settings.backdrop = imageBackdrop;
      applyBackdrop();
      setStatus(`backdrop: ${file.name}`);
    },
    (err: unknown) => {
      console.error(err);
      setStatus(`cannot load backdrop ${file.name}`);
    },
  );
});

/** Image settings; edits mutate the live backdrop object and re-prepare it. */
function renderImageControls(): void {
  const b = settings.backdrop;
  if (b.kind !== 'image') {
    imageBox.replaceChildren();
    return;
  }
  const refresh = (): void => renderer.setBackdrop(b, resolveBackdropImage(), backdropCrop);
  const missing =
    resolveBackdropImage() !== null
      ? null
      : b.origin === 'custom'
        ? 'No image yet: load one.'
        : 'The source is not a picture: load an image or switch to custom.';
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = missing ?? '';
  note.hidden = missing === null;
  // `grid` follows the source picture; the other fits have their own crop.
  const cropBox = document.createElement('div');
  cropBox.hidden = b.fit === 'grid';
  cropBox.append(
    ...positionEditor('crop', backdropCrop, refresh, 0, 1),
    row('zoom', ...slider(ZOOM_MIN, ZOOM_MAX, 0.01, backdropCrop.zoom, (n) => {
      backdropCrop.zoom = n;
      refresh();
    })),
  );

  imageBox.replaceChildren(
    row(
      'image',
      selectOf(IMAGE_ORIGINS, b.origin, (o) => {
        b.origin = o;
        applyBackdrop();
      }),
      button('load…', () => backdropFile.click(), 'separate backdrop image'),
    ),
    note,
    row('fit', selectOf(IMAGE_FITS, b.fit, (f) => {
      b.fit = f;
      cropBox.hidden = f === 'grid';
      refresh();
    })),
    cropBox,
    row('opacity', ...slider(0, 1, 0.01, b.opacity, (n) => {
      b.opacity = n;
      refresh();
    })),
    row('dim', ...slider(0, 1, 0.01, b.dim, (n) => {
      b.dim = n;
      refresh();
    })),
    row('blur', ...slider(0, BLUR_MAX, 0.001, b.blur, (n) => {
      b.blur = n;
      refresh();
    })),
  );
}

const backdropSelect = selectOf(BACKDROP_KINDS, settings.backdrop.kind, (k) => {
  if (k === 'color') settings.backdrop = { kind: 'color', color: backdropColor };
  else if (k === 'image') settings.backdrop = imageBackdrop;
  else settings.backdrop = { kind: k };
  applyBackdrop();
});
backdropColorInput.addEventListener('input', () => {
  backdropColor = backdropColorInput.value;
  settings.backdrop = { kind: 'color', color: backdropColor };
  applyBackdrop();
});
backgroundBox.append(row('mode', backdropSelect), backdropColorRow, imageBox, backdropFile);
applyBackdrop();

function setView(next: ViewSettings): void {
  settings.ramp = next.ramp;
  settings.polarity = next.polarity;
  settings.color = next.color;
  settings.backdrop = next.backdrop;
  backdropSelect.value = next.backdrop.kind;
  if (next.backdrop.kind === 'color') {
    backdropColor = next.backdrop.color;
    backdropColorInput.value = next.backdrop.color;
  }
  if (next.backdrop.kind === 'image') imageBackdrop = next.backdrop;
  applyBackdrop();
  rampSelect.value = next.ramp;
  polaritySelect.value = next.polarity;
  colorModeSelect.value = next.color.mode;
  renderPlates();
  stage.dataset.polarity = next.polarity;
  renderGradient();
  applyColor();
  safeRebuild();
}

// ---- panel: presets and chain ----

const chainRoot = document.createElement('div');
tabs.page('effects').append(chainRoot);
const chainPanel = new ChainPanel(chainRoot, {
  pipeline,
  effects: listEffects(),
  lookup: getEffect,
  getView: () => ({
    ramp: settings.ramp,
    polarity: settings.polarity,
    color: settings.color,
    backdrop: settings.backdrop,
  }),
  setView,
  status: (m) => setStatus(m),
});

// ---- export ----

function currentText(): string | null {
  if (source === null || lastWork === null || ramp === null) return null;
  return exportText(lastWork, ramp, settings.polarity, {
    useSourceChars: settings.useSourceChars,
    quantizeMode: settings.quantizeMode,
    trimRight: settings.trimRight,
  });
}

function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

const exportBox = section('export', 'export');

// Current frame as PNG: backdrop included, transparent where the backdrop is.
/** How exports look at `width x height`: the current view settings, cell size fitted to the frame. */
function exportLook(width: number, height: number): Omit<FrameLook, 'cols' | 'rows' | 'cellAspect' | 'polarity'> {
  const theme = THEMES[settings.polarity];
  return {
    theme,
    ink: parseHex(theme.fg),
    backdrop: settings.backdrop,
    backdropImage: resolveBackdropImage(),
    picture: renderer.picture,
    backdropCrop: { ...backdropCrop },
    rampChars: BUILTIN_RAMP_CHARS[settings.ramp],
    family: FONT_FAMILY,
    weight: 400,
    useSourceChars: settings.useSourceChars,
    quantizeMode: settings.quantizeMode,
    width,
    height,
    // A fixed canvas has the grid's aspect: fill it. `auto` letterboxes into the chosen size.
    fill: canvasFrame() !== null,
  };
}

const pngButton = button('save PNG', () => {
  if (source === null) return;
  const name = videoFileName(source.name, chainPanel.presetName, 'png');
  // A fixed canvas: the last frame drawn again at the canvas size, glyphs
  // at that size (not scaled from the screen). `auto`: the view itself.
  const frame = canvasFrame();
  let out = canvas;
  if (frame !== null && lastWork !== null) {
    const painter = createFramePainter({
      ...exportLook(frame.width, frame.height),
      cols: lastWork.cols,
      rows: lastWork.rows,
      cellAspect: meta.cellAspect,
      polarity: meta.polarity,
    });
    painter.paint(lastWork);
    out = painter.canvas;
  }
  out.toBlob((blob) => {
    if (blob === null) {
      setStatus('PNG export failed');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus(`saved ${name} · ${out.width}×${out.height}`);
  }, 'image/png');
});
pngButton.disabled = true;

const copyButton = document.createElement('button');
copyButton.type = 'button';
copyButton.textContent = 'copy';
copyButton.disabled = true;
copyButton.addEventListener('click', () => {
  const text = currentText();
  if (text === null) return;
  navigator.clipboard.writeText(text).then(
    () => setStatus(`copied ${text.split('\n').length - 1} lines`),
    (err: unknown) => {
      console.error(err);
      setStatus(`copy failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  );
});

const saveButton = document.createElement('button');
saveButton.type = 'button';
saveButton.textContent = 'save .txt';
saveButton.disabled = true;
saveButton.addEventListener('click', () => {
  const text = currentText();
  if (text === null || source === null) return;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName(source.name)}.txt`;
  link.click();
  URL.revokeObjectURL(url);
});

exportBox.append(
  row('trim', checkbox(settings.trimRight, (on) => {
    settings.trimRight = on;
  })),
  row('text', copyButton, saveButton),
  row('frame', pngButton),
);

// ---- export: video (real time) ----

const VIDEO_FPS = ['60', '30'] as const;
const VIDEO_QUALITY: readonly VideoQuality[] = ['high', 'medium', 'low'];
const VIDEO_LENGTH = ['manual', '5 s', '10 s', '15 s', '30 s'] as const;
const RENDER_LENGTH = ['take', '5 s', '10 s', '15 s', '30 s'] as const;
/** Render length when there is no take to measure. */
const RENDER_FALLBACK_SECONDS = 10;

const formats = typeof MediaRecorder === 'undefined' ? [] : supportedFormats((m) => MediaRecorder.isTypeSupported(m));
const video = {
  format: 0,
  fps: 60,
  quality: 'high' as VideoQuality,
  seconds: 0,
  fromStart: true,
};
const recorder = new CanvasRecorder();
const captureCanvas = document.createElement('canvas');
const captureCtx = captureCanvas.getContext('2d', { alpha: true });
let capturing = false;

/** Copies the view into the recording canvas at the canvas size. */
function copyToCapture(): void {
  if (captureCtx === null) return;
  captureCtx.imageSmoothingQuality = 'high';
  captureCtx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
  captureCtx.drawImage(canvas, 0, 0, captureCanvas.width, captureCanvas.height);
}
// Pointer path of the latest take, for replaying it offline.
const takeTrack = new PointerTrack();
let takeStart = 0;

const formatSelect = document.createElement('select');
formats.forEach((f, i) => formatSelect.add(new Option(f.label, String(i))));

const recordAlphaHint = hint(
  'Transparent background: WebM keeps it, MP4 records it black.',
);

/** Marks formats that lose a transparent background (DECISIONS 020). */
function labelRecordFormats(): void {
  const transparent = settings.backdrop.kind === 'transparent';
  formats.forEach((f, i) => {
    const option = formatSelect.options[i];
    if (option !== undefined) option.textContent = transparent && f.ext === 'mp4' ? `${f.label} — no transparency` : f.label;
  });
  recordAlphaHint.hidden = !transparent;
}
formatSelect.addEventListener('change', () => {
  video.format = Number(formatSelect.value);
});

const recordButton = button('● record', () => void toggleRecording());
recordButton.disabled = true;

async function toggleRecording(): Promise<void> {
  if (recorder.recording) {
    await finishRecording();
    return;
  }
  const format = formats[video.format];
  if (format === undefined || source === null) return;
  // Recording always runs: from a paused transport it starts playing.
  setPlaying(true);
  if (video.fromStart) pipeline.restart();
  takeTrack.clear();
  takeStart = pipeline.ctx.time;
  // A fixed canvas records at its exact size: the screen frame is copied
  // (scaled) into an offscreen canvas each frame. `auto` records the view.
  const frame = canvasFrame();
  let target = canvas;
  if (frame !== null) {
    captureCanvas.width = frame.width;
    captureCanvas.height = frame.height;
    capturing = true;
    copyToCapture();
    target = captureCanvas;
  }
  recorder.start(target, {
    format,
    fps: video.fps,
    bitsPerSecond: bitrateFor(target.width, target.height, video.fps, video.quality),
  });
  stage.classList.add('recording');
  tickRecording();
}

async function finishRecording(): Promise<void> {
  const format = formats[video.format];
  capturing = false;
  stage.classList.remove('recording');
  recordButton.textContent = '● record';
  refreshLengthHint();
  try {
    const blob = await recorder.stop();
    const name = videoFileName(source?.name ?? 'ascii', chainPanel.presetName, format?.ext ?? 'webm');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    // Revoke later: the download may still be reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus(`saved ${name} · ${(blob.size / 1e6).toFixed(1)} MB`);
  } catch (err) {
    console.error(err);
    setStatus(`recording failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Updates the button timer; stops on its own when a length is set. */
function tickRecording(): void {
  if (!recorder.recording) return;
  const t = recorder.elapsed;
  if (video.seconds > 0 && t >= video.seconds) {
    void finishRecording();
    return;
  }
  const s = Math.floor(t);
  recordButton.textContent = `■ stop · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  requestAnimationFrame(tickRecording);
}

// Video section: shared settings, then live recording, then offline render,
// each with its own format list (they use different encoders).
const videoBox = section('video', 'export');

function subhead(text: string): HTMLElement {
  const h = document.createElement('h4');
  h.textContent = text;
  return h;
}

function hint(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  return p;
}

videoBox.append(
  row('fps', selectOf(VIDEO_FPS, '60', (v) => {
    video.fps = Number(v);
    void refreshOfflineFormats();
  })),
  row('quality', selectOf(VIDEO_QUALITY, video.quality, (v) => {
    video.quality = v;
    void refreshOfflineFormats();
  })),
  subhead('record · live, with cursor'),
);
if (formats.length === 0) {
  videoBox.append(hint('This browser cannot record canvas video.'));
} else {
  videoBox.append(
    row('format', formatSelect),
    recordAlphaHint,
    row('length', selectOf(VIDEO_LENGTH, 'manual', (v) => {
      video.seconds = v === 'manual' ? 0 : parseInt(v, 10);
    })),
    row('from start', checkbox(video.fromStart, (on) => {
      video.fromStart = on;
    })),
    row('record', recordButton),
  );
}

// ---- export: video (offline, frame by frame) ----

const offline = { size: 'screen' as FrameSizeName, replay: true, format: 0, length: 'take' as (typeof RENDER_LENGTH)[number] };

// Offline format list, re-probed when size, fps or quality change: whether
// H.264 encodes depends on all three. Unsupported entries stay visible.
const offlineFormatSelect = document.createElement('select');
OFFLINE_FORMATS.forEach((f, i) => offlineFormatSelect.add(new Option(f.label, String(i))));
offlineFormatSelect.addEventListener('change', () => {
  offline.format = Number(offlineFormatSelect.value);
});
let probeId = 0;

function offlineSize(): [number, number] {
  // A fixed canvas is the frame; `auto` picks from the list.
  const frame = canvasFrame();
  if (frame !== null) return [frame.width, frame.height];
  const size = FRAME_SIZES[offline.size];
  return size === null ? [canvas.width, canvas.height] : [size[0], size[1]];
}

async function refreshOfflineFormats(): Promise<void> {
  if (typeof VideoEncoder === 'undefined') return;
  const id = ++probeId;
  const [w, h] = offlineSize();
  const support = await probeOfflineFormats(w, h, bitrateFor(w, h, video.fps, video.quality), video.fps);
  if (id !== probeId) return; // a newer probe superseded this one
  const why: string[] = [];
  OFFLINE_FORMATS.forEach((f, i) => {
    const option = offlineFormatSelect.options[i];
    if (option === undefined) return;
    const s = support[i];
    option.disabled = s !== 'ok';
    const lossy = settings.backdrop.kind === 'transparent' && !f.alpha;
    option.textContent =
      s === 'none' ? `${f.label} — not in this browser`
      : s === 'size' ? `${f.label} — too large here`
      : lossy ? `${f.label} — no transparency`
      : f.label;
    if (s === 'none') why.push(`${f.label}: this browser has no encoder for it.`);
    if (s === 'size') {
      why.push(`${f.label}: cannot encode ${w}×${h} at ${video.fps} fps, ${video.quality} quality — try a smaller size, 30 fps or lower quality.`);
    }
  });
  formatHint.textContent = why.join(' ');
  formatHint.hidden = why.length === 0;
  // Keep the choice if it still works, otherwise move to the first that does.
  if (support[offline.format] !== 'ok') {
    const first = support.indexOf('ok');
    if (first >= 0) {
      offline.format = first;
      offlineFormatSelect.value = String(first);
    }
  }
}
const formatHint = hint('');
formatHint.hidden = true;

/** Render length in seconds and where it comes from. */
function renderSeconds(): { seconds: number; replay: boolean } {
  const replay = offline.replay && takeTrack.length > 1;
  if (offline.length !== 'take') return { seconds: parseInt(offline.length, 10), replay };
  return { seconds: takeTrack.length > 1 ? takeTrack.duration : RENDER_FALLBACK_SECONDS, replay };
}

const lengthHint = hint('');
/** Shows what `take` means right now. */
function refreshLengthHint(): void {
  const take = takeTrack.length > 1 ? `last take: ${takeTrack.duration.toFixed(1)} s` : 'no take recorded yet';
  const { seconds } = renderSeconds();
  lengthHint.textContent = `${take} · render: ${seconds.toFixed(1)} s`;
}

// Size list only for an `auto` canvas; a fixed canvas is the frame.
const offlineSizeRow = row('size', selectOf(Object.keys(FRAME_SIZES) as FrameSizeName[], offline.size, (v) => {
  offline.size = v;
  void refreshOfflineFormats();
}));

let rendering: AbortController | null = null;

const renderButton = button('render', () => void toggleRender(), 'exact fps, any size; replays the last take');
renderButton.disabled = true;
const replayToggle = checkbox(offline.replay, (on) => {
  offline.replay = on;
});

async function toggleRender(): Promise<void> {
  if (rendering !== null) {
    rendering.abort();
    return;
  }
  if (source === null || field === null || recorder.recording) return;

  const [width, height] = offlineSize();
  const format = OFFLINE_FORMATS[offline.format];
  if (format === undefined) return;
  const { seconds, replay } = renderSeconds();

  rendering = new AbortController();
  renderButton.textContent = 'cancel · 0%';
  try {
    const { blob, ext } = await renderOffline(
      {
        ...exportLook(width, height),
        source: field,
        meta,
        chain: chainToPreset(pipeline.chain),
        lookup: getEffect,
        color: structuredClone(settings.color),
        fps: video.fps,
        seconds,
        bitsPerSecond: bitrateFor(width, height, video.fps, video.quality),
        format,
        track: replay ? takeTrack : null,
      },
      (done, total) => {
        renderButton.textContent = `cancel · ${Math.floor((done / total) * 100)}%`;
      },
      rendering.signal,
    );
    const name = videoFileName(source.name, chainPanel.presetName, ext);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus(`rendered ${name} · ${width}×${height} · ${seconds.toFixed(1)} s · ${(blob.size / 1e6).toFixed(1)} MB`);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') setStatus('render cancelled');
    else {
      console.error(err);
      setStatus(`render failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    rendering = null;
    renderButton.textContent = 'render';
  }
}

videoBox.append(subhead('render · offline, exact fps'));
if (typeof VideoEncoder === 'undefined') {
  videoBox.append(hint('This browser has no WebCodecs: offline render is unavailable.'));
} else {
  videoBox.append(
    row('format', offlineFormatSelect),
    formatHint,
    offlineSizeRow,
    row('length', selectOf(RENDER_LENGTH, offline.length, (v) => {
      offline.length = v;
      refreshLengthHint();
    })),
    row('replay take', replayToggle),
    lengthHint,
    row('render', renderButton),
  );
  refreshLengthHint();
  void refreshOfflineFormats();
}

panel.addEventListener('backdropchange', () => {
  labelRecordFormats();
  void refreshOfflineFormats();
});
labelRecordFormats();

const status = document.createElement('p');
status.className = 'status';
panel.append(status);

function setStatus(text: string): void {
  status.textContent = text;
}

// Refit on container resize; rAF-coalesced so a drag-resize redraws once per frame.
let pending = false;
new ResizeObserver(() => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    safeRebuild();
  });
}).observe(stage);

// Start with the first built-in preset: effects run as soon as a picture lands.
chainPanel.selectBuiltin(0);
