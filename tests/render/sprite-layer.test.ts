import { describe, expect, it } from 'vitest';
import { createWorkBuffer } from '../../src/core/field.ts';
import { makeRamp } from '../../src/core/ramp.ts';
import type { MaskSource } from '../../src/render/compositor.ts';
import { SpriteLayer } from '../../src/render/sprite-layer.ts';

const ramp = makeRamp(' .@', [0, 0.5, 1]);
const FG = [250, 240, 230] as const;

/** 2x2 cells; '@' is solid. */
function masks(): MaskSource {
  return {
    cellW: 2,
    cellH: 2,
    data: new Uint8Array([255, 255, 255, 255]),
    slot: (code) => (code === 64 ? 0 : -1),
  };
}

function setup() {
  // 4x2 cells -> 8x4 pixels; cell 0 is '@'.
  const w = createWorkBuffer(4, 2);
  w.lum[0] = 1;
  w.alpha[0] = 1;
  const layer = new SpriteLayer(8, 4, 2, 2);
  layer.setInk(FG);
  return { w, layer };
}

function px(layer: SpriteLayer, x: number, y: number): number[] {
  const o = (y * layer.width + x) * 4;
  return [...layer.pixels.subarray(o, o + 4)];
}

describe('SpriteLayer', () => {
  it("draws a sprite with its source cell's glyph at a pixel position", () => {
    const { w, layer } = setup();
    const sp = w.sprites;
    sp.x[0] = 1.5; // 3 px
    sp.y[0] = 0.5; // 1 px
    sp.src[0] = 0;
    sp.alpha[0] = 1;
    sp.count = 1;
    layer.draw(w, ramp, 'light-on-dark', true, 'nearest-density', masks());
    expect(px(layer, 3, 1)).toEqual([...FG, 255]);
    expect(px(layer, 4, 2)).toEqual([...FG, 255]);
    expect(px(layer, 2, 1)).toEqual([0, 0, 0, 0]);
    expect([layer.dirtyX, layer.dirtyY, layer.dirtyW, layer.dirtyH]).toEqual([3, 1, 2, 2]);
  });

  it('clears last frame where nothing is drawn now, and uploads that region', () => {
    const { w, layer } = setup();
    const sp = w.sprites;
    sp.x[0] = 0;
    sp.y[0] = 0;
    sp.src[0] = 0;
    sp.alpha[0] = 1;
    sp.count = 1;
    layer.draw(w, ramp, 'light-on-dark', true, 'nearest-density', masks());
    sp.x[0] = 3;
    layer.draw(w, ramp, 'light-on-dark', true, 'nearest-density', masks());
    expect(px(layer, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(px(layer, 6, 0)).toEqual([...FG, 255]);
    expect([layer.dirtyX, layer.dirtyW]).toEqual([0, 8]);
    sp.count = 0;
    layer.draw(w, ramp, 'light-on-dark', true, 'nearest-density', masks());
    expect(px(layer, 6, 0)).toEqual([0, 0, 0, 0]);
    expect(layer.dirty).toBe(true);
    layer.draw(w, ramp, 'light-on-dark', true, 'nearest-density', masks());
    expect(layer.dirty).toBe(false);
  });

  it('blends overlapping sprites "over", clips at the edges', () => {
    const { w, layer } = setup();
    w.alpha[0] = 0.5;
    const sp = w.sprites;
    for (let s = 0; s < 2; s++) {
      sp.x[s] = 3.5; // half off the right edge
      sp.y[s] = 0;
      sp.src[s] = 0;
      sp.alpha[s] = 1;
    }
    sp.count = 2;
    layer.draw(w, ramp, 'light-on-dark', true, 'nearest-density', masks());
    // Two layers of alpha 0.5: 0.75.
    expect(px(layer, 7, 0)[3]).toBeGreaterThan(185);
    expect(px(layer, 7, 0)[3]).toBeLessThan(195);
  });

  it('fades instead of clearing when the work buffer asks for tails', () => {
    const { w, layer } = setup();
    const sp = w.sprites;
    sp.x[0] = 0;
    sp.y[0] = 0;
    sp.src[0] = 0;
    sp.alpha[0] = 1;
    sp.count = 1;
    layer.draw(w, ramp, 'light-on-dark', true, 'nearest-density', masks());
    sp.count = 0;
    w.spriteFade = 0.5;
    layer.draw(w, ramp, 'light-on-dark', true, 'nearest-density', masks());
    expect(px(layer, 0, 0)).toEqual([...FG, 127]);
    expect(layer.hasContent).toBe(true);
    for (let i = 0; i < 8; i++) layer.draw(w, ramp, 'light-on-dark', true, 'nearest-density', masks());
    expect(px(layer, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(layer.hasContent).toBe(false);
  });
});
