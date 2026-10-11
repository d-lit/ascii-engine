import './style.css';
import {
  copyFieldToWork,
  createWorkBuffer,
  type Field,
  type FieldMeta,
  type Polarity,
  type WorkBuffer,
} from './core/field.ts';
import { computeRows, importImage } from './core/import-image.ts';
import { importText, normalizeText } from './core/import-text.ts';
import {
  BUILTIN_RAMP_CHARS,
  createDensityMeasurer,
  measureRamp,
  type QuantizeMode,
  type RampName,
} from './core/ramp.ts';
import { Canvas2DRenderer } from './render/canvas2d.ts';

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
}

const settings: Settings = {
  cols: 120,
  ramp: 'classic',
  polarity: 'light-on-dark',
  quantizeMode: 'nearest-density',
  useSourceChars: true,
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
let work: WorkBuffer | null = null;

// ---- pipeline ----

function gridSize(src: Source): { cols: number; rows: number } {
  if (src.kind === 'image') {
    const { width, height } = src.bitmap;
    return { cols: settings.cols, rows: computeRows(width, height, settings.cols, CELL_ASPECT) };
  }
  const lines = normalizeText(src.text);
  return { cols: Math.max(1, lines[0]?.length ?? 0), rows: Math.max(1, lines.length) };
}

function redraw(): void {
  if (source === null) return;
  const t0 = performance.now();

  const meta: FieldMeta = { cellAspect: CELL_ASPECT, polarity: settings.polarity };
  const { cols, rows } = gridSize(source);

  // Cell size depends on the grid; ramp densities depend on the cell size.
  renderer.resize(cols, rows, CELL_ASPECT);
  const font = renderer.font;
  const ramp = measureRamp(BUILTIN_RAMP_CHARS[settings.ramp], font);

  let field: Field;
  if (source.kind === 'image') {
    if (imageField === null || imageFieldCols !== settings.cols) {
      imageField = importImage(source.bitmap, { cols: settings.cols, cellAspect: CELL_ASPECT });
      imageFieldCols = settings.cols;
    }
    field = imageField;
  } else {
    // Text luminance comes from the ramp and polarity, so it is re-imported.
    field = importText(source.text, ramp, meta, createDensityMeasurer(font)).field;
  }

  if (work === null || work.cols !== field.cols || work.rows !== field.rows) {
    work = createWorkBuffer(field.cols, field.rows);
  }
  copyFieldToWork(field, work);
  renderer.render(work, ramp, meta);

  const ms = performance.now() - t0;
  setStatus(
    `${source.name} · ${field.cols}×${field.rows} · cell ${font.cellW}×${font.cellH}px · ${ms.toFixed(1)} ms`,
  );
}

function safeRedraw(): void {
  try {
    redraw();
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
  stage.classList.add('has-source');
  colsRow.hidden = source.kind !== 'image';
  sourceCharsRow.hidden = source.kind !== 'text';
  safeRedraw();
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
  safeRedraw();
});
const colsRow = row('cols', colsInput);
colsRow.append(colsValue);

row(
  'ramp',
  select(Object.keys(BUILTIN_RAMP_CHARS) as RampName[], settings.ramp, (v) => {
    settings.ramp = v;
    safeRedraw();
  }),
);

row(
  'polarity',
  select(['light-on-dark', 'dark-on-light'] as const, settings.polarity, (v) => {
    settings.polarity = v;
    stage.dataset.polarity = v;
    safeRedraw();
  }),
);

row(
  'quantize',
  select(['nearest-density', 'uniform'] as const, settings.quantizeMode, (v) => {
    settings.quantizeMode = v;
    renderer.setOptions({ quantizeMode: v });
    safeRedraw();
  }),
);

const sourceChars = document.createElement('input');
sourceChars.type = 'checkbox';
sourceChars.checked = settings.useSourceChars;
sourceChars.addEventListener('change', () => {
  settings.useSourceChars = sourceChars.checked;
  renderer.setOptions({ useSourceChars: sourceChars.checked });
  safeRedraw();
});
const sourceCharsRow = row('source chars', sourceChars);
sourceCharsRow.hidden = true;

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
    safeRedraw();
  });
}).observe(stage);
