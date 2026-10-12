import { describe, expect, it } from 'vitest';
import { createField } from '../../src/core/field.ts';
import { registerBuiltinEffects } from '../../src/effects/builtin.ts';
import { getEffect, listEffects } from '../../src/effects/registry.ts';
import { randomChain, randomRange } from '../../src/presets/random.ts';
import { applyChain, validatePreset } from '../../src/presets/preset.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

registerBuiltinEffects();
const effects = listEffects();

describe('randomRange', () => {
  it('uses the hint, clamped to the spec', () => {
    expect(randomRange({ type: 'number', min: 0, max: 10, default: 5, random: [-3, 4] })).toEqual([0, 4]);
  });

  it('falls back to a band around the default', () => {
    expect(randomRange({ type: 'number', min: 0, max: 10, default: 5 })).toEqual([3.5, 6.5]);
    expect(randomRange({ type: 'number', min: 0, max: 10, default: 0 })).toEqual([0, 1.5]);
  });
});

describe('randomChain', () => {
  it('places points at anchors and free spots, not only centre and pointer', () => {
    const points = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      for (const e of randomChain(effects, seed)) {
        const c = e.params.center;
        if (c !== undefined) points.add(JSON.stringify(c));
      }
    }
    expect(points.has('"pointer"')).toBe(true);
    expect([...points].filter((p) => p.startsWith('{')).length).toBeGreaterThan(9);
  });

  it('is deterministic per seed and varies between seeds', () => {
    expect(randomChain(effects, 7)).toEqual(randomChain(effects, 7));
    const ids = new Set(Array.from({ length: 20 }, (_, s) => randomChain(effects, s).map((e) => e.effect).join()));
    expect(ids.size).toBeGreaterThan(10);
  });

  it('respects size limits, puts displace first, never repeats an effect', () => {
    for (let seed = 0; seed < 300; seed++) {
      const chain = randomChain(effects, seed);
      expect(chain.length >= 2 && chain.length <= 4).toBe(true);
      const kinds = chain.map((e) => getEffect(e.effect)!.kind);
      expect(kinds.filter((k) => k === 'displace').length).toBeLessThanOrEqual(2);
      expect(kinds.join()).toBe([...kinds].sort((a, b) => (a === 'displace' ? 0 : 1) - (b === 'displace' ? 0 : 1)).join());
      expect(new Set(chain.map((e) => e.effect)).size).toBe(chain.length);
    }
  });

  it('always validates without warnings and runs in the pipeline', () => {
    const f = createField(16, 8);
    f.alpha.fill(1);
    for (let seed = 0; seed < 300; seed++) {
      const chain = randomChain(effects, seed);
      const { preset, warnings } = validatePreset({ version: 1, name: 'r', chain }, getEffect);
      expect(warnings).toEqual([]);
      expect(preset.chain).toEqual(chain);
      if (seed % 30 === 0) {
        const p = new Pipeline(f, { cellAspect: 0.55, polarity: 'light-on-dark' }, createPointer());
        applyChain(p, chain, getEffect);
        expect(() => p.frame(1 / 60)).not.toThrow();
      }
    }
  });
});
