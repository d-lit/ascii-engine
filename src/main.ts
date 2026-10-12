import './style.css';
import { createField, type Field, type FieldMeta, type Polarity, type WorkBuffer } from './core/field.ts';
import { createLoop } from './core/loop.ts';
import { PointerInput } from './core/pointer.ts';
import { computeRows, importImage } from './core/import-image.ts';
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
  DEFAULT_STOPS,
  GRADIENT_PALETTES,
  type ColorSettings,
} from './pipeline/colorize.ts';
import { MAX_DT, Pipeline } from './pipeline/pipeline.ts';
import { PointerTrack } from './export/pointer-track.ts';
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
import { exportText } from './render/export-text.ts';
import { BACKDROP_KINDS, type Backdrop } from './render/backdrop.ts';
import {
  bitrateFor,
  CanvasRecorder,
  supportedFormats,
  videoFileName,
  type VideoQuality,
} from './export/video-recorder.ts';
import { button, checkbox, gradientControl, row, selectOf } from './ui/controls.ts';
import { DebugOverlay } from './ui/debug-overlay.ts';
import { ChainPanel, type ViewSettings } from './ui/panel.ts';
import { makePanelResizable } from './ui/panel-resize.ts';

const CELL_ASPECT = 0.55;
const FONT_FAMILY = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const COLS_MIN = 20;
const COLS_MAX = 300;

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
};

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
// Image import is the expensive step; reuse it until the file or cols change.
let imageField: Field | null = null;
let imageFieldCols = 0;
// Text luminance depends on ramp and polarity; reuse while those hold.
let textField: Field | null = null;
let textFieldRamp: Ramp | null = null;
let textFieldPolarity: Polarity | null = null;

let field: Field | null = null;
let ramp: Ramp | null = null;
let meta: FieldMeta = { cellAspect: CELL_ASPECT, polarity: settings.polarity };
// Last rendered frame, for export.
let lastWork: WorkBuffer | null = null;

const input = new PointerInput(canvas, () => ({ cols: field?.cols ?? 1, rows: field?.rows ?? 1 }));

// The pipeline exists from the start (on an empty 1x1 field), so the chain and
// presets can be edited before any picture is loaded.
registerBuiltinEffects();
const pipeline = new Pipeline(createField(1, 1), meta, input.pointer);
const overlay = new DebugOverlay(stage, ['params', 'sample', 'cell', 'post', 'render', 'total']);
const stageMs = new Float64Array(6);
overlay.visible = false;

// ---- rebuild: file, settings or container size changed ----

function gridSize(src: Source): { cols: number; rows: number } {
  if (src.kind === 'image') {
    const { width, height } = src.bitmap;
    return { cols: settings.cols, rows: computeRows(width, height, settings.cols, CELL_ASPECT) };
  }
  const lines = normalizeText(src.text);
  return { cols: Math.max(1, lines[0]?.length ?? 0), rows: Math.max(1, lines.length) };
}

function rebuild(): void {
  if (source === null) return;

  meta = { cellAspect: CELL_ASPECT, polarity: settings.polarity };
  applyColor();
  const { cols, rows } = gridSize(source);

  // Cell size depends on the grid; ramp densities depend on the cell size.
  renderer.resize(cols, rows, CELL_ASPECT);
  const font = renderer.font;
  ramp = measureRamp(BUILTIN_RAMP_CHARS[settings.ramp], font);

  let next: Field;
  if (source.kind === 'image') {
    if (imageField === null || imageFieldCols !== settings.cols) {
      // Colour is always imported; the pipeline copies it only when a colour mode needs it.
      imageField = importImage(source.bitmap, { cols: settings.cols, cellAspect: CELL_ASPECT, color: true });
      imageFieldCols = settings.cols;
    }
    next = imageField;
  } else {
    if (textField === null || textFieldRamp !== ramp || textFieldPolarity !== settings.polarity) {
      textField = importText(source.text, ramp, meta, createDensityMeasurer(font)).field;
      textFieldRamp = ramp;
      textFieldPolarity = settings.polarity;
    }
    next = textField;
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

function frame(dt: number): void {
  if (source === null || ramp === null) return;
  input.tick(dt);
  if (recorder.recording) {
    // Pointer as this frame will see it, against the time the frame will have.
    takeTrack.push(pipeline.ctx.time + Math.min(Math.max(dt, 0), MAX_DT) - takeStart, input.pointer);
  }
  const work = pipeline.frame(dt);
  lastWork = work;

  const t0 = performance.now();
  renderer.render(work, ramp, meta);
  const renderMs = performance.now() - t0;

  const tm = pipeline.timings;
  stageMs[0] = tm.params;
  stageMs[1] = tm.sample;
  stageMs[2] = tm.cell;
  stageMs[3] = tm.post;
  stageMs[4] = renderMs;
  stageMs[5] = tm.total + renderMs;
  overlay.sample(dt, stageMs);
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
  textField = null;
  stage.classList.add('has-source');
  overlay.visible = debugToggle.checked;
  copyButton.disabled = false;
  pngButton.disabled = false;
  saveButton.disabled = false;
  recordButton.disabled = false;
  renderButton.disabled = false;
  colsRow.hidden = source.kind !== 'image';
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

function section(title: string): HTMLElement {
  const box = document.createElement('section');
  const h = document.createElement('h3');
  h.textContent = title;
  box.append(h);
  panel.append(box);
  return box;
}

const view = section('view');

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
});

view.append(
  row('source', fileInput),
  colsRow,
  row('ramp', rampSelect),
  row('polarity', polaritySelect),
  row('quantize', quantizeSelect),
  sourceCharsRow,
  row('debug', debugToggle),
  row('time', button('restart', () => pipeline.restart())),
);

// ---- panel: colour ----

/** Pushes the colour mode and the theme ink to the pipeline (DECISIONS 015). */
function applyColor(): void {
  pipeline.setColor(settings.color, parseHex(THEMES[settings.polarity].fg));
}

const colorBox = section('color');
const gradientBox = document.createElement('div');
const colorModeSelect = selectOf(COLOR_MODES, settings.color.mode, (m) => {
  settings.color.mode = m;
  renderGradient();
  applyColor();
});

function renderGradient(): void {
  gradientBox.replaceChildren();
  if (settings.color.mode !== 'gradient') return;
  gradientBox.append(gradientControl(settings.color.stops, GRADIENT_PALETTES, MAX_STOPS, applyColor));
}

colorBox.append(row('mode', colorModeSelect), gradientBox);
renderGradient();

// ---- panel: background (DECISIONS 020) ----

// Custom colour kept across mode switches; green is the usual chroma key.
let backdropColor = '#00b140';
const backgroundBox = section('background');
const backdropColorInput = document.createElement('input');
backdropColorInput.type = 'color';
backdropColorInput.value = backdropColor;
const backdropColorRow = row('colour', backdropColorInput);

function applyBackdrop(): void {
  renderer.setBackdrop(settings.backdrop);
  backdropColorRow.hidden = settings.backdrop.kind !== 'color';
}

const backdropSelect = selectOf(BACKDROP_KINDS, settings.backdrop.kind, (k) => {
  settings.backdrop = k === 'color' ? { kind: 'color', color: backdropColor } : { kind: k };
  applyBackdrop();
});
backdropColorInput.addEventListener('input', () => {
  backdropColor = backdropColorInput.value;
  settings.backdrop = { kind: 'color', color: backdropColor };
  applyBackdrop();
});
backgroundBox.append(row('mode', backdropSelect), backdropColorRow);
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
  applyBackdrop();
  rampSelect.value = next.ramp;
  polaritySelect.value = next.polarity;
  colorModeSelect.value = next.color.mode;
  stage.dataset.polarity = next.polarity;
  renderGradient();
  applyColor();
  safeRebuild();
}

// ---- panel: presets and chain ----

const chainRoot = document.createElement('div');
panel.append(chainRoot);
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

const exportBox = section('export');

// Current frame as PNG: backdrop included, transparent where the backdrop is.
const pngButton = button('save PNG', () => {
  if (source === null) return;
  const name = videoFileName(source.name, chainPanel.presetName, 'png');
  canvas.toBlob((blob) => {
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
    setStatus(`saved ${name} · ${canvas.width}×${canvas.height}`);
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

const formats = typeof MediaRecorder === 'undefined' ? [] : supportedFormats((m) => MediaRecorder.isTypeSupported(m));
const video = {
  format: 0,
  fps: 60,
  quality: 'high' as VideoQuality,
  seconds: 0,
  fromStart: true,
};
const recorder = new CanvasRecorder();
// Pointer path of the latest take, for replaying it offline.
const takeTrack = new PointerTrack();
let takeStart = 0;

const formatSelect = document.createElement('select');
formats.forEach((f, i) => formatSelect.add(new Option(f.label, String(i))));
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
  if (video.fromStart) pipeline.restart();
  takeTrack.clear();
  takeStart = pipeline.ctx.time;
  recorder.start(canvas, {
    format,
    fps: video.fps,
    bitsPerSecond: bitrateFor(canvas.width, canvas.height, video.fps, video.quality),
  });
  stage.classList.add('recording');
  tickRecording();
}

async function finishRecording(): Promise<void> {
  const format = formats[video.format];
  stage.classList.remove('recording');
  recordButton.textContent = '● record';
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
const videoBox = section('video');

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
  row('length', selectOf(VIDEO_LENGTH, 'manual', (v) => {
    video.seconds = v === 'manual' ? 0 : parseInt(v, 10);
  })),
  subhead('record · live, with cursor'),
);
if (formats.length === 0) {
  videoBox.append(hint('This browser cannot record canvas video.'));
} else {
  videoBox.append(
    row('format', formatSelect),
    row('from start', checkbox(video.fromStart, (on) => {
      video.fromStart = on;
    })),
    row('record', recordButton),
  );
}

// ---- export: video (offline, frame by frame) ----

const offline = { size: 'screen' as FrameSizeName, replay: true, format: 0 };

// Offline format list, re-probed when size, fps or quality change: whether
// H.264 encodes depends on all three. Unsupported entries stay visible.
const offlineFormatSelect = document.createElement('select');
OFFLINE_FORMATS.forEach((f, i) => offlineFormatSelect.add(new Option(f.label, String(i))));
offlineFormatSelect.addEventListener('change', () => {
  offline.format = Number(offlineFormatSelect.value);
});
let probeId = 0;

function offlineSize(): [number, number] {
  const size = FRAME_SIZES[offline.size];
  return size === null ? [canvas.width, canvas.height] : [size[0], size[1]];
}

async function refreshOfflineFormats(): Promise<void> {
  if (typeof VideoEncoder === 'undefined') return;
  const id = ++probeId;
  const [w, h] = offlineSize();
  const ok = await probeOfflineFormats(w, h, bitrateFor(w, h, video.fps, video.quality));
  if (id !== probeId) return; // a newer probe superseded this one
  OFFLINE_FORMATS.forEach((f, i) => {
    const option = offlineFormatSelect.options[i];
    if (option === undefined) return;
    option.disabled = ok[i] !== true;
    option.textContent = ok[i] === true ? f.label : `${f.label} — not supported here`;
  });
  // Keep the choice if it still works, otherwise move to the first that does.
  if (ok[offline.format] !== true) {
    const first = ok.indexOf(true);
    if (first >= 0) {
      offline.format = first;
      offlineFormatSelect.value = String(first);
    }
  }
}
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
  const replay = offline.replay && takeTrack.length > 1;
  const seconds = replay ? takeTrack.duration : video.seconds > 0 ? video.seconds : 10;
  const theme = THEMES[settings.polarity];

  rendering = new AbortController();
  renderButton.textContent = 'cancel · 0%';
  try {
    const { blob, ext } = await renderOffline(
      {
        source: field,
        meta,
        chain: chainToPreset(pipeline.chain),
        lookup: getEffect,
        color: structuredClone(settings.color),
        theme,
        ink: parseHex(theme.fg),
        backdrop: settings.backdrop,
        rampChars: BUILTIN_RAMP_CHARS[settings.ramp],
        family: FONT_FAMILY,
        weight: 400,
        useSourceChars: settings.useSourceChars,
        quantizeMode: settings.quantizeMode,
        width,
        height,
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

async function runAlphaProbe(): Promise<void> {
  setStatus('alpha test: encoding…');
  try {
    const { renderAlphaProbe } = await import('./export/alpha-probe.ts');
    const blob = await renderAlphaProbe();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'alpha-test.webm';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus(`alpha test saved · ${(blob.size / 1e3).toFixed(0)} KB`);
  } catch (err) {
    console.error(err);
    setStatus(`alpha test failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

videoBox.append(subhead('render · offline, exact fps'));
if (typeof VideoEncoder === 'undefined') {
  videoBox.append(hint('This browser has no WebCodecs: offline render is unavailable.'));
} else {
  videoBox.append(
    row('format', offlineFormatSelect),
    row('size', selectOf(Object.keys(FRAME_SIZES) as FrameSizeName[], offline.size, (v) => {
      offline.size = v;
      void refreshOfflineFormats();
    })),
    row('replay take', replayToggle),
    row('render', renderButton),
    // Temporary (phase 4.7 step 0): transparency probe for the editor check.
    row('alpha test', button('WebM with alpha', () => void runAlphaProbe())),
  );
  void refreshOfflineFormats();
}

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
