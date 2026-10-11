import './style.css';
import type { Field, FieldMeta, Polarity, WorkBuffer } from './core/field.ts';
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
import { listEffects } from './effects/registry.ts';
import type { AnyEffectDef } from './effects/types.ts';
import type { ParamInput } from './pipeline/params.ts';
import { Pipeline, type ChainEntry } from './pipeline/pipeline.ts';
import { Canvas2DRenderer } from './render/canvas2d.ts';
import { exportText } from './render/export-text.ts';
import { buildParamControls } from './ui/controls.ts';
import { DebugOverlay } from './ui/debug-overlay.ts';

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
}

const settings: Settings = {
  cols: 120,
  ramp: 'classic',
  polarity: 'light-on-dark',
  quantizeMode: 'nearest-density',
  useSourceChars: true,
  trimRight: true,
};

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`${selector} not found`);
  return node;
}

const canvas = el<HTMLCanvasElement>('#view');
const stage = el<HTMLElement>('#stage');
const panel = el<HTMLElement>('#panel');

const renderer = new Canvas2DRenderer(canvas, {
  family: FONT_FAMILY,
  weight: 400,
  themes: {
    'light-on-dark': { bg: '#0b0b0d', fg: '#e8e6e3' },
    'dark-on-light': { bg: '#f4f1ea', fg: '#16151a' },
  },
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
let pipeline: Pipeline | null = null;
// Last rendered frame, for export.
let lastWork: WorkBuffer | null = null;

const input = new PointerInput(canvas, () => ({ cols: field?.cols ?? 1, rows: field?.rows ?? 1 }));
const overlay = new DebugOverlay(stage, ['params', 'copy', 'cell', 'render', 'total']);
const stageMs = new Float64Array(5);
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
  const { cols, rows } = gridSize(source);

  // Cell size depends on the grid; ramp densities depend on the cell size.
  renderer.resize(cols, rows, CELL_ASPECT);
  const font = renderer.font;
  ramp = measureRamp(BUILTIN_RAMP_CHARS[settings.ramp], font);

  let next: Field;
  if (source.kind === 'image') {
    if (imageField === null || imageFieldCols !== settings.cols) {
      imageField = importImage(source.bitmap, { cols: settings.cols, cellAspect: CELL_ASPECT });
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
  if (pipeline === null) {
    pipeline = new Pipeline(next, meta, input.pointer);
    for (const slot of effectSlots) {
      slot.entry = pipeline.add(slot.def, slot.values);
      pipeline.setEnabled(slot.entry, slot.enabled);
    }
  } else if (next !== field) {
    pipeline.setSource(next, meta);
  }
  field = next;

  overlay.setInfo(`${next.cols}×${next.rows} · cell ${font.cellW}×${font.cellH}`);
  setStatus(`${source.name} · ${next.cols}×${next.rows}`);
  loop.start();
}

// ---- frame ----

function frame(dt: number): void {
  if (pipeline === null || ramp === null) return;
  input.tick(dt);
  const work = pipeline.frame(dt);
  lastWork = work;

  const t0 = performance.now();
  renderer.render(work, ramp, meta);
  const renderMs = performance.now() - t0;

  const tm = pipeline.timings;
  stageMs[0] = tm.params;
  stageMs[1] = tm.copy;
  stageMs[2] = tm.cell;
  stageMs[3] = renderMs;
  stageMs[4] = tm.total + renderMs;
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
  saveButton.disabled = false;
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

// ---- panel ----

function row(label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'row';
  const caption = document.createElement('span');
  caption.textContent = label;
  wrap.append(caption, control);
  panel.append(wrap);
  return wrap;
}

function select<T extends string>(options: readonly T[], value: T, onChange: (v: T) => void) {
  const node = document.createElement('select');
  for (const option of options) node.add(new Option(option, option, false, option === value));
  node.addEventListener('change', () => onChange(node.value as T));
  return node;
}

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = 'image/*,.txt,.asc,.nfo,text/plain';
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void load(file);
});
row('source', fileInput);

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
const colsRow = row('cols', colsInput);
colsRow.append(colsValue);

row(
  'ramp',
  select(Object.keys(BUILTIN_RAMP_CHARS) as RampName[], settings.ramp, (v) => {
    settings.ramp = v;
    safeRebuild();
  }),
);

row(
  'polarity',
  select(['light-on-dark', 'dark-on-light'] as const, settings.polarity, (v) => {
    settings.polarity = v;
    stage.dataset.polarity = v;
    safeRebuild();
  }),
);

row(
  'quantize',
  select(['nearest-density', 'uniform'] as const, settings.quantizeMode, (v) => {
    settings.quantizeMode = v;
    // Render-only setting: the running loop picks it up next frame.
    renderer.setOptions({ quantizeMode: v });
  }),
);

const sourceChars = document.createElement('input');
sourceChars.type = 'checkbox';
sourceChars.checked = settings.useSourceChars;
sourceChars.addEventListener('change', () => {
  settings.useSourceChars = sourceChars.checked;
  renderer.setOptions({ useSourceChars: sourceChars.checked });
});
const sourceCharsRow = row('source chars', sourceChars);
sourceCharsRow.hidden = true;

const debugToggle = document.createElement('input');
debugToggle.type = 'checkbox';
debugToggle.checked = true;
debugToggle.addEventListener('change', () => {
  overlay.visible = debugToggle.checked && source !== null;
});
row('debug', debugToggle);

// ---- effects (temporary list; the chain editor arrives in phase 4) ----

interface EffectSlot {
  readonly def: AnyEffectDef;
  readonly values: Record<string, ParamInput>;
  enabled: boolean;
  entry: ChainEntry | null;
}

registerBuiltinEffects();
const effectSlots: EffectSlot[] = listEffects().map((def) => ({
  def,
  values: {},
  enabled: false,
  entry: null,
}));

const effectsTitle = document.createElement('h3');
effectsTitle.textContent = 'effects';
panel.append(effectsTitle);

for (const slot of effectSlots) {
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  const params = buildParamControls(slot.def.params, slot.values);
  params.hidden = true;
  toggle.addEventListener('change', () => {
    slot.enabled = toggle.checked;
    params.hidden = !toggle.checked;
    if (pipeline !== null && slot.entry !== null) pipeline.setEnabled(slot.entry, slot.enabled);
  });
  const head = row(slot.def.name, toggle);
  head.classList.add('effect');
  panel.append(params);
}

const restartButton = document.createElement('button');
restartButton.type = 'button';
restartButton.textContent = 'restart';
restartButton.addEventListener('click', () => pipeline?.restart());
row('time', restartButton);

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

const trimToggle = document.createElement('input');
trimToggle.type = 'checkbox';
trimToggle.checked = settings.trimRight;
trimToggle.addEventListener('change', () => {
  settings.trimRight = trimToggle.checked;
});
row('trim', trimToggle);

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

// A div, not a label: clicking the caption must not press a button.
const exportRow = document.createElement('div');
exportRow.className = 'row';
const exportCaption = document.createElement('span');
exportCaption.textContent = 'export';
exportRow.append(exportCaption, copyButton, saveButton);
panel.append(exportRow);

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
