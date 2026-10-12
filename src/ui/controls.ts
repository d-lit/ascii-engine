import type { GradientStop } from '../pipeline/colorize.ts';
import type { MaskSpec } from '../pipeline/mask.ts';
import type {
  EnvValue,
  LfoShape,
  LfoValue,
  NumberSpec,
  ParamInput,
  ParamSchema,
  ParamSpec,
  PointValue,
} from '../pipeline/params.ts';
import { POINT_MAX, POINT_MIN } from '../pipeline/params.ts';

const ANCHORS = [0, 0.5, 1] as const;
const LFO_SHAPES: readonly LfoShape[] = ['sine', 'triangle', 'saw', 'square', 'noise'];
const NUMBER_MODES = ['const', 'lfo', 'env'] as const;
type NumberMode = (typeof NUMBER_MODES)[number];

// ---- building blocks ----

/**
 * A caption plus controls. A div, not a label: with several controls in a
 * row, clicking the caption must not activate the first of them.
 */
export function row(caption: string, ...controls: HTMLElement[]): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const span = document.createElement('span');
  span.textContent = caption;
  span.title = caption;
  wrap.append(span, ...controls);
  return wrap;
}

export function selectOf<T extends string>(
  options: readonly T[],
  value: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const node = document.createElement('select');
  for (const o of options) node.add(new Option(o, o, false, o === value));
  node.addEventListener('change', () => onChange(node.value as T));
  return node;
}

export function checkbox(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

export function button(text: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (title !== undefined) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function decimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Range input plus readout; `onInput` gets the number. */
export function slider(
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
): HTMLElement[] {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = document.createElement('output');
  const show = (): void => {
    out.textContent = Number(input.value).toFixed(decimals(step));
  };
  show();
  input.addEventListener('input', () => {
    show();
    onInput(Number(input.value));
  });
  return [input, out];
}

function specStep(spec: NumberSpec): number {
  return spec.step ?? (spec.max - spec.min) / 100;
}

// ---- number with modulation ----

function modeOf(v: ParamInput | undefined): NumberMode {
  if (typeof v === 'object' && v !== null) {
    if ('lfo' in v) return 'lfo';
    if ('env' in v) return 'env';
  }
  return 'const';
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** "0:0, 1:10, 3:4" <-> [[0, 0], [1, 10], [3, 4]]. */
export function formatEnv(points: ReadonlyArray<readonly [number, number]>): string {
  return points.map(([t, v]) => `${t}:${v}`).join(', ');
}

export function parseEnv(text: string): Array<[number, number]> | null {
  const parts = text.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0) return null;
  const out: Array<[number, number]> = [];
  let prev = -Infinity;
  for (const part of parts) {
    const m = /^(-?\d*\.?\d+)\s*:\s*(-?\d*\.?\d+)$/.exec(part);
    if (!m) return null;
    const t = Number(m[1]);
    const v = Number(m[2]);
    if (t < prev) return null;
    prev = t;
    out.push([t, v]);
  }
  return out;
}

/**
 * Number param editor with a const / lfo / env switch. Modulated values are
 * edited in place, so a running pipeline sees changes on the next frame.
 */
export function numberControl(
  caption: string,
  spec: NumberSpec,
  get: () => ParamInput | undefined,
  set: (v: ParamInput) => void,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'param';
  const step = specStep(spec);
  // Remembered so switching away and back to const restores the number.
  let lastConst = typeof get() === 'number' ? (get() as number) : spec.default;

  const render = (): void => {
    const value = get();
    const mode = modeOf(value);
    const modeSelect = selectOf(NUMBER_MODES, mode, (m) => {
      set(defaultFor(m));
      render();
    });
    modeSelect.className = 'mode';

    if (mode === 'const') {
      const v = typeof value === 'number' ? value : spec.default;
      box.replaceChildren(
        row(caption, ...slider(spec.min, spec.max, step, v, (n) => {
          lastConst = n;
          set(n);
        }), modeSelect),
      );
      return;
    }

    const head = row(caption, modeSelect);
    head.classList.add('mod-head');
    const body = document.createElement('div');
    body.className = 'mod-body';

    if (mode === 'lfo') {
      const lfo = value as LfoValue;
      body.append(
        row('shape', selectOf(LFO_SHAPES, lfo.lfo, (s) => {
          lfo.lfo = s;
        })),
        row('freq, Hz', ...slider(0.01, 5, 0.01, lfo.freq, (n) => {
          lfo.freq = n;
        })),
        row('min', ...slider(spec.min, spec.max, step, lfo.min, (n) => {
          lfo.min = n;
        })),
        row('max', ...slider(spec.min, spec.max, step, lfo.max, (n) => {
          lfo.max = n;
        })),
        row('phase', ...slider(0, 1, 0.01, lfo.phase ?? 0, (n) => {
          lfo.phase = n;
        })),
      );
    } else {
      const env = value as EnvValue;
      const text = document.createElement('input');
      text.type = 'text';
      text.value = formatEnv(env.env);
      text.title = 'seconds:value, comma separated, time ascending';
      text.addEventListener('input', () => {
        const parsed = parseEnv(text.value);
        text.classList.toggle('invalid', parsed === null);
        if (parsed !== null) env.env = parsed;
      });
      body.append(
        row('points', text),
        row('loop', checkbox(env.loop === true, (b) => {
          env.loop = b;
        })),
        row('ease', selectOf(['linear', 'smooth'] as const, env.ease ?? 'linear', (e) => {
          env.ease = e;
        })),
      );
    }
    box.replaceChildren(head, body);
  };

  const defaultFor = (mode: NumberMode): ParamInput => {
    if (mode === 'const') return lastConst;
    const lo = lerp(spec.min, spec.max, 0.25);
    const hi = lerp(spec.min, spec.max, 0.75);
    if (mode === 'lfo') return { lfo: 'sine', freq: 0.25, min: lo, max: hi };
    return { env: [[0, lo], [2, hi], [4, lo]], loop: true, ease: 'smooth' };
  };

  render();
  return box;
}

// ---- other param types ----

function paramControl(key: string, spec: ParamSpec, values: Record<string, ParamInput>): HTMLElement {
  const caption = spec.label ?? key;
  const current = values[key];

  switch (spec.type) {
    case 'number':
      return numberControl(caption, spec, () => values[key], (v) => {
        values[key] = v;
      });
    case 'boolean':
      return row(caption, checkbox(typeof current === 'boolean' ? current : spec.default, (b) => {
        values[key] = b;
      }));
    case 'select':
      return row(caption, selectOf(spec.options, typeof current === 'string' ? current : spec.default, (s) => {
        values[key] = s;
      }));
    case 'color': {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = typeof current === 'string' ? current : spec.default;
      input.addEventListener('input', () => {
        values[key] = input.value;
      });
      return row(caption, input);
    }
    case 'point':
      return pointControl(caption, () => values[key] ?? spec.default, (p) => {
        values[key] = p;
      });
  }
}

/** Normalized position of a point value; the pointer has none. */
function positionOf(v: unknown): { x: number; y: number } | null {
  if (v === 'center') return { x: 0.5, y: 0.5 };
  if (typeof v === 'object' && v !== null && 'x' in v && 'y' in v) {
    const { x, y } = v as { x: unknown; y: unknown };
    if (typeof x === 'number' && typeof y === 'number') return { x, y };
  }
  return null;
}

/**
 * Point editor (SPEC 7.1): a 3x3 anchor grid, a pointer button, and x / y
 * sliders for free placement, including off the picture (POINT_MIN..MAX).
 */
export function pointControl(
  caption: string,
  get: () => unknown,
  set: (p: PointValue) => void,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'point';

  const render = (): void => {
    const current = get();
    const pos = positionOf(current);
    const isPointer = current === 'pointer';

    const grid = document.createElement('div');
    grid.className = 'point-grid';
    for (const y of ANCHORS) {
      for (const x of ANCHORS) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'point-anchor';
        cell.title = `${x}, ${y}`;
        cell.classList.toggle('on', pos !== null && pos.x === x && pos.y === y);
        cell.addEventListener('click', () => {
          set({ x, y });
          render();
        });
        grid.append(cell);
      }
    }

    const pointer = button('cursor', () => {
      set('pointer');
      render();
    }, 'follow the pointer');
    pointer.classList.toggle('on', isPointer);

    const head = row(caption, grid, pointer);
    head.classList.add('point-head');
    if (pos === null) {
      box.replaceChildren(head);
      return;
    }

    // Free placement: sliders write a plain {x, y}; anchors stay highlighted when hit exactly.
    const free = { x: pos.x, y: pos.y };
    const update = (): void => {
      set({ x: free.x, y: free.y });
      for (const [k, el] of grid.querySelectorAll('.point-anchor').entries()) {
        const ax = ANCHORS[k % 3]!;
        const ay = ANCHORS[Math.floor(k / 3)]!;
        el.classList.toggle('on', free.x === ax && free.y === ay);
      }
    };
    const body = document.createElement('div');
    body.className = 'mod-body';
    body.append(
      row('x', ...slider(POINT_MIN, POINT_MAX, 0.01, pos.x, (n) => {
        free.x = n;
        update();
      })),
      row('y', ...slider(POINT_MIN, POINT_MAX, 0.01, pos.y, (n) => {
        free.y = n;
        update();
      })),
    );
    box.replaceChildren(head, body);
  };

  render();
  return box;
}

/**
 * Controls generated from a param schema (invariant 6). They write straight
 * into `values`; the pipeline re-resolves them on the next frame.
 */
export function buildParamControls(
  schema: ParamSchema,
  values: Record<string, ParamInput>,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'params';
  for (const key of Object.keys(schema)) box.append(paramControl(key, schema[key]!, values));
  return box;
}

// ---- mask ----

const MASK_CHOICES = ['none', 'alpha', 'lum', 'radial', 'rect'] as const;
type MaskChoice = (typeof MASK_CHOICES)[number];

function defaultMask(type: MaskChoice): MaskSpec | null {
  switch (type) {
    case 'none':
      return null;
    case 'alpha':
      return { type: 'alpha' };
    case 'lum':
      return { type: 'lum', min: 0.4, max: 1, soft: 0.1 };
    case 'radial':
      return { type: 'radial', center: 'pointer', radius: 20, soft: 6 };
    case 'rect':
      return { type: 'rect', x: 0.25, y: 0.25, w: 0.5, h: 0.5, soft: 4 };
  }
}

const RADIUS_SPEC: NumberSpec = { type: 'number', min: 0, max: 200, step: 1, default: 20 };

/**
 * Mask editor. Changing the type calls `set` with a new spec (the pipeline
 * re-allocates); field edits mutate the spec in place, read every frame.
 */
export function maskControl(get: () => MaskSpec | null, set: (m: MaskSpec | null) => void): HTMLElement {
  const box = document.createElement('div');
  box.className = 'mask';

  const render = (): void => {
    const mask = get();
    const typeSelect = selectOf(MASK_CHOICES, mask === null ? 'none' : mask.type, (t) => {
      set(defaultMask(t));
      render();
    });
    const head = row('mask', typeSelect);
    if (mask === null) {
      box.replaceChildren(head);
      return;
    }
    head.append(checkbox(mask.invert === true, (b) => {
      mask.invert = b;
    }));
    head.lastElementChild?.setAttribute('title', 'invert');

    const body = document.createElement('div');
    body.className = 'mod-body';
    switch (mask.type) {
      case 'alpha':
        break;
      case 'lum':
        body.append(
          row('min', ...slider(0, 1, 0.01, mask.min, (n) => {
            mask.min = n;
          })),
          row('max', ...slider(0, 1, 0.01, mask.max, (n) => {
            mask.max = n;
          })),
          row('soft', ...slider(0, 0.5, 0.01, mask.soft ?? 0, (n) => {
            mask.soft = n;
          })),
        );
        break;
      case 'radial':
        body.append(
          pointControl('center', () => mask.center, (p) => {
            mask.center = p;
          }),
          numberControl('radius', RADIUS_SPEC, () => mask.radius, (v) => {
            if (typeof v === 'number' || (typeof v === 'object' && !('x' in v))) mask.radius = v;
          }),
          row('soft', ...slider(0, 60, 1, mask.soft ?? 0, (n) => {
            mask.soft = n;
          })),
        );
        break;
      case 'rect':
        body.append(
          row('x', ...slider(0, 1, 0.01, mask.x, (n) => {
            mask.x = n;
          })),
          row('y', ...slider(0, 1, 0.01, mask.y, (n) => {
            mask.y = n;
          })),
          row('w', ...slider(0, 1, 0.01, mask.w, (n) => {
            mask.w = n;
          })),
          row('h', ...slider(0, 1, 0.01, mask.h, (n) => {
            mask.h = n;
          })),
          row('soft', ...slider(0, 30, 1, mask.soft ?? 0, (n) => {
            mask.soft = n;
          })),
        );
        break;
    }
    box.replaceChildren(head, body);
  };

  render();
  return box;
}

// ---- colour ----

/** CSS preview of a gradient, left = dark lum, right = bright lum. */
export function gradientCss(stops: readonly GradientStop[]): string {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  if (sorted.length === 1) return sorted[0]!.color;
  return `linear-gradient(to right, ${sorted.map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(', ')})`;
}

/**
 * Gradient stop editor. Stops are edited in place; `changed` fires after every
 * edit so the owner can rebuild its lookup table.
 */
export function gradientControl(
  stops: GradientStop[],
  palettes: Readonly<Record<string, readonly GradientStop[]>>,
  maxStops: number,
  changed: () => void,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'gradient';

  const render = (): void => {
    const preview = document.createElement('div');
    preview.className = 'gradient-preview';
    preview.style.background = gradientCss(stops);

    const paletteSelect = selectOf(['—', ...Object.keys(palettes)], '—', (name) => {
      const p = palettes[name];
      if (p === undefined) return;
      stops.splice(0, stops.length, ...p.map((s) => ({ ...s })));
      changed();
      render();
    });

    const rows = stops.map((stop, i) => {
      const color = document.createElement('input');
      color.type = 'color';
      color.value = stop.color.length === 4 ? stop.color.replace(/[0-9a-f]/gi, (c) => c + c) : stop.color;
      color.addEventListener('input', () => {
        stop.color = color.value;
        preview.style.background = gradientCss(stops);
        changed();
      });
      const [range, out] = slider(0, 1, 0.01, stop.pos, (n) => {
        stop.pos = n;
        preview.style.background = gradientCss(stops);
        changed();
      });
      const remove = button('✕', () => {
        stops.splice(i, 1);
        changed();
        render();
      }, 'remove stop');
      remove.disabled = stops.length <= 1;
      return row(`stop ${i + 1}`, color, range!, out!, remove);
    });

    const add = button('+ stop', () => {
      const sorted = [...stops].sort((a, b) => a.pos - b.pos);
      // New stop in the widest gap, coloured like its left neighbour.
      let at = 0.5;
      let base = sorted[0]?.color ?? '#ffffff';
      let gap = -1;
      for (let k = 1; k < sorted.length; k++) {
        const g = sorted[k]!.pos - sorted[k - 1]!.pos;
        if (g > gap) {
          gap = g;
          at = (sorted[k]!.pos + sorted[k - 1]!.pos) / 2;
          base = sorted[k - 1]!.color;
        }
      }
      stops.push({ pos: Number(at.toFixed(2)), color: base });
      changed();
      render();
    });
    add.disabled = stops.length >= maxStops;

    box.replaceChildren(preview, row('palette', paletteSelect, add), ...rows);
  };

  render();
  return box;
}
