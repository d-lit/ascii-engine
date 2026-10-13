import type { Vec2 } from '../core/math.ts';
import type { NumberSpec, ParamInput, PointValue } from '../pipeline/params.ts';
import { asParamValue } from '../pipeline/params.ts';
import {
  DEFAULT_STEP_AREA,
  POINT_MAX,
  POINT_MIN,
  POINT_STEP_MODES,
  type MotionValue,
  type PathKind,
  type PathSpec,
  type PointStep,
} from '../pipeline/points.ts';
import { AUDIO_BANDS } from '../audio/bands.ts';
import { checkbox, numberControl, row, selectOf, slider } from './controls.ts';

const ANCHORS = [0, 0.5, 1] as const;
const MODES = ['position', 'cursor', 'axes', 'audio step', 'orbit', 'lissajous', 'wander', 'sweep', 'bounce', 'path'] as const;
type Mode = (typeof MODES)[number];
const IDLE = ['stay', 'position', 'orbit', 'lissajous', 'wander', 'sweep', 'bounce', 'path'] as const;
type Idle = (typeof IDLE)[number];
const AXIS_SPEC: NumberSpec = { type: 'number', min: POINT_MIN, max: POINT_MAX, step: 0.01, default: 0.5 };

function modeOf(v: unknown): Mode {
  if (v === 'pointer') return 'cursor';
  if (v === 'center' || typeof v !== 'object' || v === null) return 'position';
  if ('follow' in v) return 'cursor';
  if ('axes' in v) return 'axes';
  if ('step' in v) return 'audio step';
  if ('path' in v) return (v as { path: PathSpec }).path.kind;
  return 'position';
}

function positionOf(v: unknown): Vec2 {
  if (typeof v === 'object' && v !== null && 'x' in v && 'y' in v) {
    const { x, y } = v as { x: unknown; y: unknown };
    if (typeof x === 'number' && typeof y === 'number') return { x, y };
  }
  return { x: 0.5, y: 0.5 };
}

/** A fresh path of a kind, centred on `at`; speeds kept slow and readable. */
export function defaultPath(kind: PathKind, at: Vec2): PathSpec {
  const c = { x: at.x, y: at.y };
  switch (kind) {
    case 'orbit':
      return { kind, center: c, radius: 0.2, speed: 0.1 };
    case 'lissajous':
      return { kind, center: c, rx: 0.3, ry: 0.2, fx: 0.1, fy: 0.2 };
    case 'wander':
      return { kind, center: c, radius: 0.25, speed: 0.3 };
    case 'sweep':
      return { kind, from: { x: 0.1, y: c.y }, to: { x: 0.9, y: c.y }, period: 4, pingpong: true, ease: 'smooth' };
    case 'bounce':
      return { kind, start: c, speed: 0.15, angle: 35 };
    case 'path':
      return {
        kind,
        points: [[0, 0.2, 0.2], [3, 0.8, 0.3], [6, 0.5, 0.8], [9, 0.2, 0.2]],
        loop: true,
        ease: 'smooth',
      };
  }
}

/** "t:x:y, ..." <-> keyframes; null for malformed text or time going back. */
export function formatPathPoints(points: ReadonlyArray<readonly [number, number, number]>): string {
  return points.map(([t, x, y]) => `${t}:${x}:${y}`).join(', ');
}

export function parsePathPoints(text: string): Array<[number, number, number]> | null {
  const parts = text.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0) return null;
  const out: Array<[number, number, number]> = [];
  let prev = -Infinity;
  for (const part of parts) {
    const m = /^(-?\d*\.?\d+)\s*:\s*(-?\d*\.?\d+)\s*:\s*(-?\d*\.?\d+)$/.exec(part);
    if (!m) return null;
    const t = Number(m[1]);
    const x = Number(m[2]);
    const y = Number(m[3]);
    if (t < prev || x < POINT_MIN || x > POINT_MAX || y < POINT_MIN || y > POINT_MAX) return null;
    prev = t;
    out.push([t, x, y]);
  }
  return out;
}

/** 3x3 anchors plus x / y sliders (`min`..`max`), editing `pos` in place. */
export function positionEditor(
  caption: string,
  pos: Vec2,
  changed: () => void,
  min: number = POINT_MIN,
  max: number = POINT_MAX,
): HTMLElement[] {
  const grid = document.createElement('div');
  grid.className = 'point-grid';
  const cells: HTMLButtonElement[] = [];
  const mark = (): void => {
    cells.forEach((el, k) => el.classList.toggle('on', pos.x === ANCHORS[k % 3] && pos.y === ANCHORS[Math.floor(k / 3)]));
  };
  const [xs, xo] = slider(min, max, 0.01, pos.x, (n) => {
    pos.x = n;
    mark();
    changed();
  });
  const [ys, yo] = slider(min, max, 0.01, pos.y, (n) => {
    pos.y = n;
    mark();
    changed();
  });
  for (const y of ANCHORS) {
    for (const x of ANCHORS) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'point-anchor';
      cell.title = `${x}, ${y}`;
      cell.addEventListener('click', () => {
        pos.x = x;
        pos.y = y;
        (xs as HTMLInputElement).value = String(x);
        (ys as HTMLInputElement).value = String(y);
        xs!.dispatchEvent(new Event('input'));
        ys!.dispatchEvent(new Event('input'));
      });
      cells.push(cell);
      grid.append(cell);
    }
  }
  mark();
  const head = row(caption, grid);
  head.classList.add('point-head');
  return [head, row('x', xs!, xo!), row('y', ys!, yo!)];
}

function num(caption: string, min: number, max: number, step: number, get: number, set: (n: number) => void): HTMLElement {
  return row(caption, ...slider(min, max, step, get, set));
}

/** Fields of one path, edited in place. */
function pathEditor(path: PathSpec): HTMLElement[] {
  switch (path.kind) {
    case 'orbit':
      return [
        ...positionEditor('center', path.center, () => undefined),
        num('radius', 0, 0.8, 0.01, path.radius, (n) => (path.radius = n)),
        num('speed, turns/s', -2, 2, 0.01, path.speed, (n) => (path.speed = n)),
        num('phase', 0, 1, 0.01, path.phase ?? 0, (n) => (path.phase = n)),
      ];
    case 'lissajous':
      return [
        ...positionEditor('center', path.center, () => undefined),
        num('width', 0, 0.8, 0.01, path.rx, (n) => (path.rx = n)),
        num('height', 0, 0.8, 0.01, path.ry, (n) => (path.ry = n)),
        num('x freq, Hz', 0, 3, 0.01, path.fx, (n) => (path.fx = n)),
        num('y freq, Hz', 0, 3, 0.01, path.fy, (n) => (path.fy = n)),
        num('phase', 0, 1, 0.01, path.phase ?? 0, (n) => (path.phase = n)),
      ];
    case 'wander':
      return [
        ...positionEditor('center', path.center, () => undefined),
        num('radius', 0, 0.8, 0.01, path.radius, (n) => (path.radius = n)),
        num('speed', 0, 3, 0.01, path.speed, (n) => (path.speed = n)),
        num('seed', 0, 99, 1, path.seed ?? 0, (n) => (path.seed = n)),
      ];
    case 'sweep':
      return [
        ...positionEditor('from', path.from, () => undefined),
        ...positionEditor('to', path.to, () => undefined),
        num('period, s', 0.5, 30, 0.1, path.period, (n) => (path.period = n)),
        row('back and forth', checkbox(path.pingpong === true, (b) => (path.pingpong = b))),
        row('ease', selectOf(['linear', 'smooth'] as const, path.ease ?? 'linear', (e) => (path.ease = e))),
      ];
    case 'bounce':
      return [
        ...positionEditor('start', path.start, () => undefined),
        num('speed', 0, 2, 0.01, path.speed, (n) => (path.speed = n)),
        num('angle, deg', 0, 360, 1, path.angle, (n) => (path.angle = n)),
      ];
    case 'path': {
      const text = document.createElement('input');
      text.type = 'text';
      text.value = formatPathPoints(path.points);
      text.title = 'seconds:x:y, comma separated, time ascending; x, y from -0.5 to 1.5';
      text.addEventListener('input', () => {
        const parsed = parsePathPoints(text.value);
        text.classList.toggle('invalid', parsed === null);
        if (parsed !== null) path.points = parsed;
      });
      return [
        row('points', text),
        row('loop', checkbox(path.loop === true, (b) => (path.loop = b))),
        row('ease', selectOf(['linear', 'smooth'] as const, path.ease ?? 'linear', (e) => (path.ease = e))),
      ];
    }
  }
}

/**
 * Point editor (SPEC 7.1): a fixed position, the cursor (optionally moving
 * along a path while the cursor is away), axes driven by LFO / envelope, or
 * a trajectory. Fields edit the value in place; mode switches call `set`.
 */
export function pointControl(caption: string, get: () => unknown, set: (p: PointValue) => void): HTMLElement {
  const box = document.createElement('div');
  box.className = 'point';

  const render = (): void => {
    const value = get();
    const mode = modeOf(value);
    const modeSelect = selectOf(MODES, mode, (m) => {
      const here = positionOf(value);
      if (m === 'position') set({ x: here.x, y: here.y });
      else if (m === 'cursor') set('pointer');
      else if (m === 'axes') set({ axes: { x: here.x, y: here.y } });
      else if (m === 'audio step') set({ step: 'bass', threshold: 0.6, mode: 'random', area: { ...DEFAULT_STEP_AREA }, glide: 0.15 });
      else set({ path: defaultPath(m, here) });
      render();
    });
    modeSelect.className = 'mode';
    const head = row(caption, modeSelect);
    const body = document.createElement('div');
    body.className = 'mod-body';

    if (mode === 'position') {
      // 'center' becomes an explicit position on first edit.
      const pos = positionOf(value);
      body.append(...positionEditor('at', pos, () => set({ x: pos.x, y: pos.y })));
    } else if (mode === 'axes') {
      const v = value as { axes: { x: ParamInput; y: ParamInput } };
      const axis = (k: 'x' | 'y'): HTMLElement =>
        numberControl(k, AXIS_SPEC, () => v.axes[k], (n) => {
          const pv = asParamValue(n);
          if (pv !== null) v.axes[k] = pv;
        });
      body.append(axis('x'), axis('y'));
    } else if (mode === 'cursor') {
      body.append(...cursorEditor(value, set, render));
    } else if (mode === 'audio step') {
      body.append(...stepEditor(value as PointStep));
    } else {
      body.append(...pathEditor((value as { path: PathSpec }).path));
    }
    box.replaceChildren(head, body);
  };

  render();
  return box;
}

/** "x:y, x:y" <-> positions; null for malformed text or a position out of range. */
export function parsePositions(text: string): Array<{ x: number; y: number }> | null {
  const parts = text.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0) return null;
  const out: Array<{ x: number; y: number }> = [];
  for (const part of parts) {
    const m = /^(-?\d*\.?\d+)\s*:\s*(-?\d*\.?\d+)$/.exec(part);
    if (!m) return null;
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (x < POINT_MIN || x > POINT_MAX || y < POINT_MIN || y > POINT_MAX) return null;
    out.push({ x, y });
  }
  return out;
}

/**
 * Audio step (SPEC 7.3): the point jumps each time a band of the track
 * rises through the threshold. Edited in place.
 */
function stepEditor(st: PointStep): HTMLElement[] {
  const extra = document.createElement('div');
  const renderExtra = (): void => {
    extra.replaceChildren();
    if (st.mode === 'random') {
      const a = (st.area ??= { ...DEFAULT_STEP_AREA });
      extra.append(
        num('area x', 0, 1, 0.01, a.x, (n) => (a.x = n)),
        num('area y', 0, 1, 0.01, a.y, (n) => (a.y = n)),
        num('area width', 0, 1, 0.01, a.w, (n) => (a.w = n)),
        num('area height', 0, 1, 0.01, a.h, (n) => (a.h = n)),
        num('seed', 0, 99, 1, st.seed ?? 0, (n) => (st.seed = n)),
      );
    } else if (st.mode === 'list') {
      st.points ??= [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }];
      const text = document.createElement('input');
      text.type = 'text';
      text.value = st.points.map((p) => `${p.x}:${p.y}`).join(', ');
      text.title = 'x:y, comma separated; x, y from -0.5 to 1.5';
      text.addEventListener('input', () => {
        const parsed = parsePositions(text.value);
        text.classList.toggle('invalid', parsed === null);
        if (parsed !== null) st.points = parsed;
      });
      extra.append(row('points', text));
    }
  };
  renderExtra();
  return [
    row('band', selectOf(AUDIO_BANDS, st.step, (b) => (st.step = b))),
    num('threshold', 0.05, 0.95, 0.01, st.threshold, (n) => (st.threshold = n)),
    row('jump to', selectOf(POINT_STEP_MODES, st.mode, (m) => {
      st.mode = m;
      renderExtra();
    })),
    extra,
    num('glide, s', 0, 2, 0.01, st.glide ?? 0, (n) => (st.glide = n)),
  ];
}

/** Cursor mode: what the point does while the cursor is away, and how fast it hands over. */
function cursorEditor(value: unknown, set: (p: PointValue) => void, rerender: () => void): HTMLElement[] {
  const follow: Extract<MotionValue, { follow: 'pointer' }> =
    typeof value === 'object' && value !== null && 'follow' in value
      ? (value as Extract<MotionValue, { follow: 'pointer' }>)
      : { follow: 'pointer' };
  const idle = follow.idle;
  const idleMode: Idle = idle === undefined ? 'stay' : 'kind' in idle ? idle.kind : 'position';

  const select = selectOf(IDLE, idleMode, (m) => {
    if (m === 'stay') set('pointer');
    else {
      const next: Extract<MotionValue, { follow: 'pointer' }> = { follow: 'pointer', ease: follow.ease ?? 0.4 };
      next.idle = m === 'position' ? { x: 0.5, y: 0.5 } : defaultPath(m, { x: 0.5, y: 0.5 });
      set(next);
    }
    rerender();
  });
  const out: HTMLElement[] = [row('when away', select)];
  if (idle === undefined) return out;
  out.push(num('handover, s', 0, 3, 0.05, follow.ease ?? 0.4, (n) => (follow.ease = n)));
  if ('kind' in idle) out.push(...pathEditor(idle));
  else out.push(...positionEditor('at', idle, () => undefined));
  return out;
}

