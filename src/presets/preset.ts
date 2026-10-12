import type { Polarity } from '../core/field.ts';
import { BUILTIN_RAMP_CHARS, type RampName } from '../core/ramp.ts';
import type { AnyEffectDef } from '../effects/types.ts';
import { isHexColor } from '../core/color.ts';
import {
  COLOR_MODES,
  DEFAULT_STOPS,
  PLATE_MODES,
  type ColorSettings,
  type GradientStop,
} from '../pipeline/colorize.ts';
import { MASK_TYPES, type MaskSpec } from '../pipeline/mask.ts';
import { isMotionValue } from '../pipeline/points.ts';
import {
  BACKDROP_KINDS,
  BLUR_MAX,
  DEFAULT_IMAGE_BACKDROP,
  IMAGE_FITS,
  IMAGE_ORIGINS,
  type Backdrop,
} from '../render/backdrop.ts';
import { resolveMod } from '../pipeline/modulation.ts';
import {
  POINT_MAX,
  POINT_MIN,
  type ParamInput,
  type ParamSpec,
  type ParamValue,
  type PointValue,
} from '../pipeline/params.ts';
import type { ChainEntry, Pipeline } from '../pipeline/pipeline.ts';

export const PRESET_VERSION = 1;

export const MAX_STOPS = 8;

export interface PresetEffect {
  effect: string;
  params: Record<string, ParamInput>;
  enabled: boolean;
  mix: ParamValue;
  mask: MaskSpec | null;
}

export interface Preset {
  version: number;
  name: string;
  ramp: RampName;
  polarity: Polarity;
  color: ColorSettings;
  /** Settings only: an image backdrop is never stored (DECISIONS 020). */
  backdrop: Backdrop;
  chain: PresetEffect[];
}

export interface PresetLoad {
  preset: Preset;
  warnings: string[];
}

export type EffectLookup = (id: string) => AnyEffectDef | undefined;

const RAMPS = Object.keys(BUILTIN_RAMP_CHARS) as RampName[];
const POLARITIES: readonly Polarity[] = ['light-on-dark', 'dark-on-light'];

export const DEFAULT_PRESET: Preset = {
  version: PRESET_VERSION,
  name: 'Untitled',
  ramp: 'classic',
  polarity: 'light-on-dark',
  color: { mode: 'mono', stops: [...DEFAULT_STOPS] },
  backdrop: { kind: 'theme' },
  chain: [],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function oneOf<T extends string>(v: unknown, options: readonly T[]): v is T {
  return typeof v === 'string' && (options as readonly string[]).includes(v);
}

function show(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}...` : s;
  } catch {
    return String(v);
  }
}

/** A number or any object a registered modulation source accepts. */
export function isParamValue(v: unknown): v is ParamValue {
  if (finite(v)) return true;
  return isRecord(v) && resolveMod(v, 0) !== undefined;
}

export function isPointValue(v: unknown): v is PointValue {
  if (v === 'pointer' || v === 'center') return true;
  if (!isRecord(v)) return false;
  if ('x' in v || 'y' in v) {
    const inRange = (n: unknown): boolean => finite(n) && n >= POINT_MIN && n <= POINT_MAX;
    return inRange(v.x) && inRange(v.y);
  }
  // Moving points (SPEC 7.1): axes, paths, pointer follow.
  return isMotionValue(v, isParamValue);
}

function validParam(spec: ParamSpec, v: unknown): boolean {
  switch (spec.type) {
    case 'number':
      return isParamValue(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'select':
      return oneOf(v, spec.options);
    case 'color':
      return isHexColor(v);
    case 'point':
      return isPointValue(v);
  }
}

function validMask(v: unknown): v is MaskSpec {
  if (!isRecord(v) || !oneOf(v.type, MASK_TYPES)) return false;
  const softOk = v.soft === undefined || (finite(v.soft) && v.soft >= 0);
  const invertOk = v.invert === undefined || typeof v.invert === 'boolean';
  if (!softOk || !invertOk) return false;
  switch (v.type) {
    case 'alpha':
      return true;
    case 'lum':
      return finite(v.min) && finite(v.max);
    case 'radial':
      return isPointValue(v.center) && isParamValue(v.radius);
    case 'rect':
      return finite(v.x) && finite(v.y) && finite(v.w) && finite(v.h);
  }
}

function validateEffect(
  raw: unknown,
  index: number,
  lookup: EffectLookup,
  warn: (msg: string) => void,
): PresetEffect | null {
  if (!isRecord(raw) || typeof raw.effect !== 'string') {
    warn(`chain[${index}]: not an effect entry, skipped`);
    return null;
  }
  const def = lookup(raw.effect);
  if (def === undefined) {
    warn(`chain[${index}]: unknown effect "${raw.effect}", skipped`);
    return null;
  }
  const where = `chain[${index}] ${def.id}`;

  const params: Record<string, ParamInput> = {};
  if (raw.params !== undefined && !isRecord(raw.params)) {
    warn(`${where}: params is not an object, using defaults`);
  } else if (raw.params !== undefined) {
    for (const [key, value] of Object.entries(raw.params)) {
      const spec = def.params[key];
      if (spec === undefined) continue; // unknown param: ignored (SPEC 8)
      if (validParam(spec, value)) params[key] = value as ParamInput;
      else warn(`${where}: bad value for "${key}" ${show(value)}, using default`);
    }
  }

  let mix: ParamValue = 1;
  if (raw.mix !== undefined) {
    if (isParamValue(raw.mix)) mix = raw.mix;
    else warn(`${where}: bad mix ${show(raw.mix)}, using 1`);
  }

  let mask: MaskSpec | null = null;
  if (raw.mask !== undefined && raw.mask !== null) {
    if (validMask(raw.mask)) mask = raw.mask;
    else warn(`${where}: bad mask ${show(raw.mask)}, ignored`);
  }

  let enabled = true;
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled === 'boolean') enabled = raw.enabled;
    else warn(`${where}: bad enabled ${show(raw.enabled)}, using true`);
  }

  // Deep copy: the preset owns its values, the pipeline will own them next.
  return structuredClone({ effect: def.id, params, enabled, mix, mask });
}

function validStop(v: unknown): v is GradientStop {
  return isRecord(v) && finite(v.pos) && v.pos >= 0 && v.pos <= 1 && isHexColor(v.color);
}

/** Colour block (DECISIONS 015). Missing block or stops fall back to defaults. */
function validateColor(raw: unknown, warn: (msg: string) => void): ColorSettings {
  const color: ColorSettings = { mode: 'mono', stops: [...DEFAULT_STOPS] };
  if (raw === undefined) return color;
  if (!isRecord(raw)) {
    warn(`bad color ${show(raw)}, using mono`);
    return color;
  }
  if (oneOf(raw.mode, COLOR_MODES)) color.mode = raw.mode;
  else warn(`bad color mode ${show(raw.mode)}, using mono`);

  if (raw.stops !== undefined) {
    const ok =
      Array.isArray(raw.stops) &&
      raw.stops.length >= 1 &&
      raw.stops.length <= MAX_STOPS &&
      raw.stops.every(validStop);
    if (ok) color.stops = structuredClone(raw.stops as GradientStop[]);
    else warn(`bad gradient stops ${show(raw.stops)}, using default gradient`);
  }
  if (raw.plates !== undefined) {
    const p = raw.plates;
    if (isRecord(p) && oneOf(p.mode, PLATE_MODES) && finite(p.opacity) && p.opacity >= 0 && p.opacity <= 1) {
      if (p.mode !== 'none') color.plates = { mode: p.mode, opacity: p.opacity };
    } else {
      warn(`bad plates ${show(p)}, using none`);
    }
  }
  return color;
}

function validateBackdrop(raw: unknown, warn: (msg: string) => void): Backdrop {
  if (raw === undefined) return { kind: 'theme' };
  if (isRecord(raw) && oneOf(raw.kind, BACKDROP_KINDS)) {
    switch (raw.kind) {
      case 'theme':
      case 'transparent':
        return { kind: raw.kind };
      case 'color':
        if (isHexColor(raw.color)) return { kind: 'color', color: raw.color };
        break;
      case 'image': {
        // Settings only; the image comes from the session (DECISIONS 020).
        const d = DEFAULT_IMAGE_BACKDROP;
        const unit = (v: unknown, max: number, fallback: number): number =>
          finite(v) && v >= 0 && v <= max ? v : fallback;
        return {
          kind: 'image',
          origin: oneOf(raw.origin, IMAGE_ORIGINS) ? raw.origin : d.origin,
          fit: oneOf(raw.fit, IMAGE_FITS) ? raw.fit : d.fit,
          opacity: unit(raw.opacity, 1, d.opacity),
          dim: unit(raw.dim, 1, d.dim),
          blur: unit(raw.blur, BLUR_MAX, d.blur),
        };
      }
    }
  }
  warn(`bad backdrop ${show(raw)}, using theme`);
  return { kind: 'theme' };
}

/**
 * Validates untrusted preset data (SPEC 8). Never throws: anything unusable
 * falls back to a default and adds a warning.
 */
export function validatePreset(raw: unknown, lookup: EffectLookup): PresetLoad {
  const warnings: string[] = [];
  const warn = (msg: string): void => {
    warnings.push(msg);
  };

  if (!isRecord(raw)) {
    warn('preset is not an object, using an empty one');
    return { preset: structuredClone(DEFAULT_PRESET), warnings };
  }

  if (raw.version !== PRESET_VERSION) {
    warn(`unknown version ${show(raw.version)}, reading as version ${PRESET_VERSION}`);
  }
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : DEFAULT_PRESET.name;

  let ramp = DEFAULT_PRESET.ramp;
  if (raw.ramp !== undefined) {
    if (oneOf(raw.ramp, RAMPS)) ramp = raw.ramp;
    else warn(`unknown ramp ${show(raw.ramp)}, using ${ramp}`);
  }

  let polarity = DEFAULT_PRESET.polarity;
  if (raw.polarity !== undefined) {
    if (oneOf(raw.polarity, POLARITIES)) polarity = raw.polarity;
    else warn(`unknown polarity ${show(raw.polarity)}, using ${polarity}`);
  }

  const color = validateColor(raw.color, warn);
  const backdrop = validateBackdrop(raw.backdrop, warn);

  const chain: PresetEffect[] = [];
  if (raw.chain !== undefined && !Array.isArray(raw.chain)) {
    warn('chain is not an array, ignored');
  } else if (Array.isArray(raw.chain)) {
    raw.chain.forEach((item, i) => {
      const effect = validateEffect(item, i, lookup, warn);
      if (effect !== null) chain.push(effect);
    });
  }

  return {
    preset: { version: PRESET_VERSION, name, ramp, polarity, color, backdrop, chain },
    warnings,
  };
}

/** Parses JSON text and validates it; a syntax error becomes a warning too. */
export function parsePreset(text: string, lookup: EffectLookup): PresetLoad {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { preset: structuredClone(DEFAULT_PRESET), warnings: [`not valid JSON: ${msg}`] };
  }
  return validatePreset(raw, lookup);
}

/** Current chain as preset entries; values are deep-copied, defaults left implicit. */
export function chainToPreset(chain: readonly ChainEntry[]): PresetEffect[] {
  return chain.map((entry) =>
    structuredClone({
      effect: entry.def.id,
      params: entry.values,
      enabled: entry.enabled,
      mix: entry.mix,
      mask: entry.mask,
    }),
  );
}

/** Stops only for gradients (ink or plates), plates only when used. */
function serializeColor(c: ColorSettings): Record<string, unknown> {
  const plates = c.plates !== undefined && c.plates.mode !== 'none' ? c.plates : null;
  const out: Record<string, unknown> = { mode: c.mode };
  if (c.mode === 'gradient' || plates?.mode === 'gradient') out.stops = c.stops;
  if (plates !== null) out.plates = plates;
  return out;
}

/**
 * Serializes in the SPEC 8 shape. Optional fields with default values are
 * omitted so hand-edited presets stay short.
 */
export function serializePreset(preset: Preset): string {
  const chain = preset.chain.map((e) => {
    const out: Record<string, unknown> = { effect: e.effect };
    if (Object.keys(e.params).length > 0) out.params = e.params;
    if (!e.enabled) out.enabled = false;
    if (e.mix !== 1) out.mix = e.mix;
    if (e.mask !== null) out.mask = e.mask;
    return out;
  });
  return JSON.stringify(
    {
      version: PRESET_VERSION,
      name: preset.name,
      ramp: preset.ramp,
      polarity: preset.polarity,
      // Stops only matter for the gradient mode; keep files short otherwise.
      color: serializeColor(preset.color),
      // Theme backdrop is the default: omitted to keep files short.
      ...(preset.backdrop.kind === 'theme' ? {} : { backdrop: preset.backdrop }),
      chain,
    },
    null,
    2,
  );
}

/**
 * Replaces the pipeline's chain with the preset's. Values are copied, so the
 * returned entries own them (UI edits do not touch the preset object).
 */
export function applyChain(
  pipeline: Pipeline,
  chain: readonly PresetEffect[],
  lookup: EffectLookup,
): ChainEntry[] {
  for (const entry of [...pipeline.chain]) pipeline.remove(entry);
  const entries: ChainEntry[] = [];
  for (const e of chain) {
    const def = lookup(e.effect);
    if (def === undefined) continue;
    const copy = structuredClone(e);
    const entry = pipeline.add(def, copy.params, { mix: copy.mix, mask: copy.mask });
    if (!copy.enabled) pipeline.setEnabled(entry, false);
    entries.push(entry);
  }
  return entries;
}
