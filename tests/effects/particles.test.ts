import { describe, expect, it } from 'vitest';
import { createField } from '../../src/core/field.ts';
import { particles } from '../../src/effects/system/particles.ts';
import { createPointer, Pipeline } from '../../src/pipeline/pipeline.ts';

function setup() {
  const f = createField(40, 20);
  f.lum.fill(1);
  f.alpha.fill(1);
  const pointer = createPointer();
  const p = new Pipeline(f, { cellAspect: 0.5, polarity: 'light-on-dark' }, pointer);
  p.add(particles, { explode: 80, radius: 10 });
  p.frame(0);
  return { p, pointer };
}

function click(pointer: ReturnType<typeof createPointer>, x: number, y: number): void {
  pointer.x = x;
  pointer.y = y;
  pointer.inside = true;
  pointer.clicked = true;
}

describe('particles', () => {
  it('is a grid at rest: no sprites, nothing hidden', () => {
    const { p } = setup();
    for (let i = 0; i < 10; i++) p.frame(1 / 60);
    const w = p.frame(1 / 60);
    expect(w.sprites.count).toBe(0);
    expect(w.hidden.every((h) => h === 0)).toBe(true);
  });

  it('a click blows nearby cells out as sprites; they spread outward', () => {
    const { p, pointer } = setup();
    click(pointer, 20, 10);
    let w = p.frame(1 / 60);
    for (let i = 0; i < 5; i++) w = p.frame(1 / 60);
    expect(w.sprites.count).toBeGreaterThan(50);
    // Every sprite's cell is hidden in the grid; cells far away are not.
    for (let s = 0; s < w.sprites.count; s++) expect(w.hidden[w.sprites.src[s]!]).toBe(1);
    expect(w.hidden[0]).toBe(0);
    // A cell to the right of the click moved right.
    const right = 10 * 40 + 23;
    const s = [...w.sprites.src.subarray(0, w.sprites.count)].indexOf(right);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(w.sprites.x[s]!).toBeGreaterThan(23);
  });

  it('springs everything home: back to a plain grid', () => {
    const { p, pointer } = setup();
    click(pointer, 20, 10);
    let w = p.frame(1 / 60);
    for (let i = 0; i < 60 * 8; i++) w = p.frame(1 / 60);
    expect(w.sprites.count).toBe(0);
    expect(w.hidden.every((h) => h === 0)).toBe(true);
  });

  it('moves the same whatever the frame rate (fixed steps)', () => {
    const a = setup();
    const b = setup();
    click(a.pointer, 20, 10);
    click(b.pointer, 20, 10);
    let wa = a.p.frame(1 / 60);
    let wb = b.p.frame(1 / 60);
    for (let i = 0; i < 30; i++) wa = a.p.frame(1 / 60);
    for (let i = 0; i < 10; i++) wb = b.p.frame(1 / 20);
    expect(wa.sprites.count).toBe(wb.sprites.count);
    for (let s = 0; s < wa.sprites.count; s++) {
      expect(wa.sprites.x[s]).toBeCloseTo(wb.sprites.x[s]!, 4);
      expect(wa.sprites.y[s]).toBeCloseTo(wb.sprites.y[s]!, 4);
    }
  });

  it('acts only inside its mask; mix 0 switches it off', () => {
    const { p, pointer } = setup();
    p.setMask(p.chain[0]!, { type: 'rect', x: 0, y: 0, w: 0.5, h: 1, soft: 0 });
    click(pointer, 20, 10);
    let w = p.frame(1 / 60);
    for (let i = 0; i < 5; i++) w = p.frame(1 / 60);
    for (let s = 0; s < w.sprites.count; s++) expect(w.sprites.src[s]! % 40).toBeLessThan(21);

    const off = setup();
    off.p.chain[0]!.mix = 0;
    click(off.pointer, 20, 10);
    expect(off.p.frame(1 / 60).sprites.count).toBe(0);
  });
});
