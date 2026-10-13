import type { Vec2 } from '../core/math.ts';
import { smoothstep } from '../core/math.ts';
import { AUDIO_BANDS, type AudioBand } from '../audio/bands.ts';
import { HASH_UNIT, hashInt2 } from '../core/prng.ts';
import { currentModEnv, glideAt, lfoUnit, resolveMod, stepState, type StepState } from './modulation.ts';
import type { ParamValue } from './params.ts';

/** Normalized coordinates: 0 and 1 are the centres of the edge cells. */
export const POINT_MIN = -0.5;
export const POINT_MAX = 1.5;

/**
 * Trajectories (SPEC 7.1, DECISIONS 018). Positions are normalized like
 * plain points; sizes (`radius`, `rx`, `ry`) and bounce `speed` are shares of
 * the picture width, isotropic: vertical extents are converted through
 * cellAspect, so an orbit is a circle on screen at any `cols`.
 * Speeds in turns or cycles per second; time is the effect's clock.
 */
export type PathSpec =
  | { kind: 'orbit'; center: Vec2; radius: number; speed: number; phase?: number }
  | { kind: 'lissajous'; center: Vec2; rx: number; ry: number; fx: number; fy: number; phase?: number }
  | { kind: 'wander'; center: Vec2; radius: number; speed: number; seed?: number }
  | { kind: 'sweep'; from: Vec2; to: Vec2; period: number; pingpong?: boolean; ease?: 'linear' | 'smooth' }
  | { kind: 'bounce'; start: Vec2; speed: number; angle: number }
  | { kind: 'path'; points: Array<[t: number, x: number, y: number]>; loop?: boolean; ease?: 'linear' | 'smooth' };

export type PathKind = PathSpec['kind'];
export const PATH_KINDS: readonly PathKind[] = ['orbit', 'lissajous', 'wander', 'sweep', 'bounce', 'path'];

/** Moving point values on top of 'center' | 'pointer' | {x, y}. */
/**
 * Step on audio for a point (SPEC 7.3, DECISIONS 028): a new position each
 * time `step` rises through `threshold` — random in `area`, the next of the
 * 3×3 grid, or the next of `points`.
 */
export interface PointStep {
  step: AudioBand;
  threshold: number;
  mode: 'random' | 'grid' | 'list';
  /** `random`: where the point may land, shares of the picture. */
  area?: { x: number; y: number; w: number; h: number };
  /** `list`: positions in turn. */
  points?: Vec2[];
  glide?: number;
  seed?: number;
}

export const POINT_STEP_MODES = ['random', 'grid', 'list'] as const;
export const DEFAULT_STEP_AREA = { x: 0.15, y: 0.15, w: 0.7, h: 0.7 };

export type MotionValue =
  | { axes: { x: ParamValue; y: ParamValue } }
  | { path: PathSpec }
  | { follow: 'pointer'; idle?: PathSpec | Vec2; ease?: number }
  | PointStep;

/** Pointer facts a point needs; FrameContext's Pointer satisfies it. */
export interface PointerLike {
  x: number;
  y: number;
  inside: boolean;
}

/** Grid facts needed to place points in cells. */
export interface PointFrame {
  cols: number;
  rows: number;
  cellAspect: number;
  pointer: PointerLike;
}

/**
 * The live point handed to an effect: `x, y` in cells. `w` and `lt` are the
 * pointer-follow blend state (weight of the pointer, last clock time); they
 * live here so resolution never allocates.
 */
export interface PointState extends Vec2 {
  w: number;
  lt: number;
}

export function createPointState(): PointState {
  return { x: 0, y: 0, w: -1, lt: 0 };
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const DEFAULT_EASE = 0.4;
// Offsets that make the two wander axes independent noise streams.
const WANDER_Y = 917.37;

function clampN(v: number): number {
  return Math.min(Math.max(v, POINT_MIN), POINT_MAX);
}

/** Smooth 1D noise in -1..1: two octaves of the LFO value noise. */
function wanderNoise(u: number): number {
  return ((lfoUnit('noise', u) - 0.5) * 2 + (lfoUnit('noise', u * 2.1 + 31.7) - 0.5)) / 1.5;
}

/** Triangle fold of `v` into 0..span (bounce off both walls). */
function fold(v: number, span: number): number {
  if (span <= 0) return 0;
  const p = span * 2;
  const m = ((v % p) + p) % p;
  return m > span ? p - m : m;
}

/** Writes the path position at clock `t` into `out` (cells). Stateless. */
export function evalPath(path: PathSpec, t: number, frame: PointFrame, out: Vec2): void {
  const W = frame.cols - 1;
  const H = frame.rows - 1;
  const A = frame.cellAspect;
  switch (path.kind) {
    case 'orbit': {
      const a = TAU * (path.speed * t + (path.phase ?? 0));
      out.x = clampN(path.center.x) * W + path.radius * W * Math.cos(a);
      out.y = clampN(path.center.y) * H + path.radius * W * A * Math.sin(a);
      return;
    }
    case 'lissajous': {
      const p = path.phase ?? 0;
      out.x = clampN(path.center.x) * W + path.rx * W * Math.sin(TAU * (path.fx * t + p));
      out.y = clampN(path.center.y) * H + path.ry * W * A * Math.sin(TAU * path.fy * t);
      return;
    }
    case 'wander': {
      const u = path.speed * t + (path.seed ?? 0) * 101.3;
      out.x = clampN(path.center.x) * W + path.radius * W * wanderNoise(u);
      out.y = clampN(path.center.y) * H + path.radius * W * A * wanderNoise(u + WANDER_Y);
      return;
    }
    case 'sweep': {
      const period = path.period > 0 ? path.period : 1;
      const raw = t / period;
      let f = path.pingpong === true ? 1 - Math.abs(((raw % 2) + 2) % 2 - 1) : raw - Math.floor(raw);
      if (path.ease === 'smooth') f = smoothstep(0, 1, f);
      out.x = (clampN(path.from.x) + (clampN(path.to.x) - clampN(path.from.x)) * f) * W;
      out.y = (clampN(path.from.y) + (clampN(path.to.y) - clampN(path.from.y)) * f) * H;
      return;
    }
    case 'bounce': {
      // Velocity in cell widths per second, isotropic; folded into the picture.
      const a = path.angle * DEG;
      const vx = path.speed * W * Math.cos(a);
      const vy = path.speed * W * A * Math.sin(a);
      out.x = fold(clampN(path.start.x) * W + vx * t, W);
      out.y = fold(clampN(path.start.y) * H + vy * t, H);
      return;
    }
    case 'path': {
      const pts = path.points;
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (first === undefined || last === undefined) {
        out.x = W / 2;
        out.y = H / 2;
        return;
      }
      let time = t;
      if (path.loop === true && last[0] > first[0] && time > last[0]) {
        time = first[0] + ((time - first[0]) % (last[0] - first[0]));
      }
      let x = last[1];
      let y = last[2];
      if (time <= first[0]) {
        x = first[1];
        y = first[2];
      } else {
        for (let i = 1; i < pts.length; i++) {
          const b = pts[i]!;
          if (time > b[0]) continue;
          const a = pts[i - 1]!;
          const span = b[0] - a[0];
          let k = span > 0 ? (time - a[0]) / span : 1;
          if (path.ease === 'smooth') k = smoothstep(0, 1, k);
          x = a[1] + (b[1] - a[1]) * k;
          y = a[2] + (b[2] - a[2]) * k;
          break;
        }
      }
      out.x = clampN(x) * W;
      out.y = clampN(y) * H;
      return;
    }
  }
}

const AXIS_DEFAULT = 0.5;

function axis(value: ParamValue, t: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? clampN(value) : AXIS_DEFAULT;
  const v = resolveMod(value, t);
  return v === undefined || !Number.isFinite(v) ? AXIS_DEFAULT : clampN(v);
}

/**
 * Resolves a moving point at clock `t` into `out` (cells). Only `follow`
 * keeps state (the pointer weight in `out.w`); a clock that went backwards
 * (restart) snaps the weight instead of easing.
 */
// Grid order for `grid` steps: centre, corners, edge middles — far jumps first.
const GRID_ORDER = [4, 0, 8, 2, 6, 1, 7, 3, 5] as const;
const POINT_STEP_SEED = 0x9e17;
const pointStep: StepState = { k: 0, since: -1 };

/** Normalized position of step `k` into `out` (shares of the picture). */
function stepPosition(v: PointStep, k: number, out: Vec2): void {
  switch (v.mode) {
    case 'random': {
      const a = v.area ?? DEFAULT_STEP_AREA;
      out.x = a.x + a.w * hashInt2(k, 2 * (v.seed ?? 0), POINT_STEP_SEED) * HASH_UNIT;
      out.y = a.y + a.h * hashInt2(k, 2 * (v.seed ?? 0) + 1, POINT_STEP_SEED) * HASH_UNIT;
      return;
    }
    case 'grid': {
      const cell = GRID_ORDER[k % GRID_ORDER.length]!;
      out.x = (cell % 3) / 2;
      out.y = Math.floor(cell / 3) / 2;
      return;
    }
    case 'list': {
      const list = v.points ?? [];
      const p = list.length === 0 ? null : list[k % list.length]!;
      out.x = p === null ? 0.5 : p.x;
      out.y = p === null ? 0.5 : p.y;
      return;
    }
  }
}

const stepA: Vec2 = { x: 0, y: 0 };
const stepB: Vec2 = { x: 0, y: 0 };

export function resolveMotion(value: MotionValue, frame: PointFrame, t: number, out: PointState): void {
  if ('step' in value) {
    stepState(currentModEnv(), value.step, value.threshold, pointStep);
    const k = pointStep.k;
    stepPosition(value, k, stepB);
    const g = k === 0 ? 1 : glideAt(pointStep.since, value.glide ?? 0);
    if (g < 1) {
      stepPosition(value, k - 1, stepA);
      stepB.x = stepA.x + (stepB.x - stepA.x) * g;
      stepB.y = stepA.y + (stepB.y - stepA.y) * g;
    }
    out.x = clampN(stepB.x) * (frame.cols - 1);
    out.y = clampN(stepB.y) * (frame.rows - 1);
    return;
  }
  if ('axes' in value) {
    out.x = axis(value.axes.x, t) * (frame.cols - 1);
    out.y = axis(value.axes.y, t) * (frame.rows - 1);
    return;
  }
  if ('path' in value) {
    evalPath(value.path, t, frame, out);
    return;
  }

  // follow: blend between the idle position and the pointer.
  const ptr = frame.pointer;
  const idle = value.idle;
  if (idle === undefined) {
    out.x = ptr.x;
    out.y = ptr.y;
    return;
  }
  if ('kind' in idle) evalPath(idle, t, frame, out);
  else {
    out.x = clampN(idle.x) * (frame.cols - 1);
    out.y = clampN(idle.y) * (frame.rows - 1);
  }
  const target = ptr.inside ? 1 : 0;
  const ease = value.ease ?? DEFAULT_EASE;
  const dt = t - out.lt;
  if (out.w < 0 || dt < 0 || ease <= 0) out.w = target;
  else out.w += (target - out.w) * (1 - Math.exp(-dt / ease));
  out.lt = t;
  out.x += (ptr.x - out.x) * out.w;
  out.y += (ptr.y - out.y) * out.w;
}

// ---- validation (presets) ----

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPos(v: unknown): boolean {
  return isRecord(v) && finite(v.x) && finite(v.y) && v.x >= POINT_MIN && v.x <= POINT_MAX && v.y >= POINT_MIN && v.y <= POINT_MAX;
}

function optFinite(v: unknown): boolean {
  return v === undefined || finite(v);
}

function optEase(v: unknown): boolean {
  return v === undefined || v === 'linear' || v === 'smooth';
}

export function isPathSpec(v: unknown): v is PathSpec {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'orbit':
      return isPos(v.center) && finite(v.radius) && v.radius >= 0 && finite(v.speed) && optFinite(v.phase);
    case 'lissajous':
      return isPos(v.center) && finite(v.rx) && finite(v.ry) && finite(v.fx) && finite(v.fy) && optFinite(v.phase);
    case 'wander':
      return isPos(v.center) && finite(v.radius) && v.radius >= 0 && finite(v.speed) && v.speed >= 0 && optFinite(v.seed);
    case 'sweep':
      return (
        isPos(v.from) &&
        isPos(v.to) &&
        finite(v.period) &&
        v.period > 0 &&
        (v.pingpong === undefined || typeof v.pingpong === 'boolean') &&
        optEase(v.ease)
      );
    case 'bounce':
      return isPos(v.start) && finite(v.speed) && v.speed >= 0 && finite(v.angle);
    case 'path': {
      if (!Array.isArray(v.points) || v.points.length === 0) return false;
      let prev = -Infinity;
      for (const p of v.points as unknown[]) {
        if (!Array.isArray(p) || p.length !== 3) return false;
        const [t, x, y] = p as unknown[];
        if (!finite(t) || t < prev || !isPos({ x, y })) return false;
        prev = t;
      }
      return (v.loop === undefined || typeof v.loop === 'boolean') && optEase(v.ease);
    }
    default:
      return false;
  }
}

/** Structural check of a motion value; `isParam` validates axis values. */
export function isMotionValue(v: unknown, isParam: (p: unknown) => boolean): v is MotionValue {
  if (!isRecord(v)) return false;
  if ('axes' in v) return isRecord(v.axes) && isParam(v.axes.x) && isParam(v.axes.y);
  if ('path' in v) return isPathSpec(v.path);
  if ('step' in v) {
    const areaOk =
      v.area === undefined ||
      (isRecord(v.area) && finite(v.area.x) && finite(v.area.y) && finite(v.area.w) && finite(v.area.h));
    const pointsOk = v.points === undefined || (Array.isArray(v.points) && v.points.every(isPos));
    return (
      typeof v.step === 'string' &&
      (AUDIO_BANDS as readonly string[]).includes(v.step) &&
      finite(v.threshold) &&
      typeof v.mode === 'string' &&
      (POINT_STEP_MODES as readonly string[]).includes(v.mode) &&
      areaOk &&
      pointsOk &&
      optFinite(v.glide) &&
      optFinite(v.seed)
    );
  }
  if ('follow' in v) {
    if (v.follow !== 'pointer') return false;
    const idleOk = v.idle === undefined || isPos(v.idle) || isPathSpec(v.idle);
    const easeOk = v.ease === undefined || (finite(v.ease) && v.ease >= 0);
    return idleOk && easeOk;
  }
  return false;
}
