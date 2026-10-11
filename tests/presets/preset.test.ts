import { describe, expect, it } from 'vitest';
import { createField, type FieldMeta } from '../../src/core/field.ts';
import { createRand } from '../../src/core/prng.ts';
import { registerBuiltinEffects } from '../../src/effects/builtin.ts';
import { getEffect } from '../../src/effects/registry.ts';
import { BUILTIN_PRESETS } from '../../src/presets/builtin.ts';
import {
  applyChain,
  chainToPreset,
  parsePreset,
  serializePreset,
  validatePreset,
  type Preset,
} from '../../src/presets/preset.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

registerBuiltinEffects();
const lookup = getEffect;
const meta: FieldMeta = { cellAspect: 0.55, polarity: 'light-on-dark' };

function source() {
  const f = createField(24, 12);
  for (let i = 0; i < f.lum.length; i++) {
    f.lum[i] = ((i * 7) % 24) / 24;
    f.alpha[i] = i % 11 === 0 ? 0 : 1;
  }
  return f;
}

function run(p: Pipeline, frames: number): number[] {
  let out: number[] = [];
  for (let i = 0; i < frames; i++) {
    const w = p.frame(1 / 30);
    out = [...w.lum, ...w.alpha, ...w.charOverride];
  }
  return out;
}

describe('built-in presets', () => {
  it.each(BUILTIN_PRESETS.map((p) => [(p as { name: string }).name, p]))(
    '%s validates without warnings',
    (_name, raw) => {
      const { preset, warnings } = validatePreset(raw, lookup);
      expect(warnings).toEqual([]);
      expect(preset.chain.length).toBeGreaterThan(0);
    },
  );
});

describe('validatePreset', () => {
  it('fills defaults and warns about each broken field', () => {
    const { preset, warnings } = validatePreset(
      {
        version: 9,
        ramp: 'neon',
        polarity: 'sideways',
        color: { mode: 'gradient' },
        chain: [
          { effect: 'nope' },
          42,
          {
            effect: 'wave',
            params: { speed: 'fast', amplitude: 0.5, bogus: 1, direction: { lfo: 'sine', freq: 1, min: 0, max: 90 } },
            mix: 'half',
            mask: { type: 'radial', center: 'center' },
            enabled: 'yes',
          },
        ],
      },
      lookup,
    );

    expect(preset.name).toBe('Untitled');
    expect(preset.ramp).toBe('classic');
    expect(preset.polarity).toBe('light-on-dark');
    expect(preset.color.mode).toBe('gradient');
    expect(preset.chain).toHaveLength(1);
    expect(preset.chain[0]).toEqual({
      effect: 'wave',
      params: { amplitude: 0.5, direction: { lfo: 'sine', freq: 1, min: 0, max: 90 } },
      enabled: true,
      mix: 1,
      mask: null,
    });
    for (const fragment of ['version', 'ramp', 'polarity', 'not rendered', 'unknown effect', 'not an effect', '"speed"', 'mix', 'mask', 'enabled']) {
      expect(warnings.some((w) => w.includes(fragment))).toBe(true);
    }
    expect(warnings.some((w) => w.includes('bogus'))).toBe(false); // unknown params are ignored silently
  });

  it('never throws, whatever it is fed', () => {
    const rand = createRand(5);
    const junk = (depth: number): unknown => {
      const r = rand();
      if (depth > 3 || r < 0.2) return [null, 1, 'x', true, Number.NaN, undefined][Math.floor(rand() * 6)];
      if (r < 0.5) return Array.from({ length: 3 }, () => junk(depth + 1));
      const keys = ['version', 'name', 'ramp', 'chain', 'effect', 'params', 'mask', 'mix', 'type', 'env', 'lfo', 'center'];
      return Object.fromEntries(keys.filter(() => rand() < 0.4).map((k) => [k, junk(depth + 1)]));
    };
    for (let i = 0; i < 500; i++) expect(() => validatePreset(junk(0), lookup)).not.toThrow();
    expect(parsePreset('{ broken', lookup).warnings[0]).toMatch(/JSON/);
  });
});

describe('save -> load', () => {
  it.each(BUILTIN_PRESETS.map((p) => [(p as { name: string }).name, p]))(
    '%s reproduces the same frames',
    (_name, raw) => {
      const { preset } = validatePreset(raw, lookup);
      const a = new Pipeline(source(), meta, createPointer());
      applyChain(a, preset.chain, lookup);

      const saved: Preset = { ...preset, chain: chainToPreset(a.chain) };
      const loaded = parsePreset(serializePreset(saved), lookup);
      expect(loaded.warnings).toEqual([]);
      const b = new Pipeline(source(), meta, createPointer());
      applyChain(b, loaded.preset.chain, lookup);

      expect(run(b, 20)).toEqual(run(a, 20));
    },
  );

  it('keeps disabled entries and omits default fields', () => {
    const p = new Pipeline(source(), meta, createPointer());
    const [entry] = applyChain(p, [{ effect: 'wave', params: {}, enabled: true, mix: 1, mask: null }], lookup);
    p.setEnabled(entry!, false);
    const json = serializePreset({ ...validatePreset({}, lookup).preset, chain: chainToPreset(p.chain) });
    expect(JSON.parse(json).chain).toEqual([{ effect: 'wave', enabled: false }]);
    const back = parsePreset(json, lookup).preset.chain[0]!;
    expect(back.enabled).toBe(false);
  });

  it('copies values, so editing the pipeline does not change the preset', () => {
    const { preset } = validatePreset(BUILTIN_PRESETS[0], lookup);
    const before = JSON.stringify(preset);
    const p = new Pipeline(source(), meta, createPointer());
    const entries = applyChain(p, preset.chain, lookup);
    entries[0]!.values.amplitude = 9;
    expect(JSON.stringify(preset)).toBe(before);
  });
});
