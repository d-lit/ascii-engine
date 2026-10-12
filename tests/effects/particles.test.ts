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

describe('particles, chunk 2', () => {
  function make(values: Record<string, unknown>) {
    const f = createField(40, 20);
    f.lum.fill(1);
    f.alpha.fill(1);
    const pointer = createPointer();
    const p = new Pipeline(f, { cellAspect: 0.5, polarity: 'light-on-dark' }, pointer);
    p.add(particles, values as Record<string, number>);
    return { p, pointer };
  }

  it('the cursor pushes cells aside: a hole around it, filled again when it leaves', () => {
    const { p, pointer } = make({ push: 400, pushRadius: 5 });
    pointer.x = 20;
    pointer.y = 10;
    pointer.inside = true;
    let w = p.frame(0);
    for (let i = 0; i < 60; i++) w = p.frame(1 / 60);
    const under = 10 * 40 + 20;
    expect(w.hidden[under]).toBe(1);
    // The cell under the cursor sits outside it now.
    const s = [...w.sprites.src.subarray(0, w.sprites.count)].indexOf(under);
    const dx = w.sprites.x[s]! - 20;
    const dy = (w.sprites.y[s]! - 10) / 0.5;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(1.5);
    pointer.inside = false;
    for (let i = 0; i < 60 * 8; i++) w = p.frame(1 / 60);
    expect(w.sprites.count).toBe(0);
  });

  it('intro: starts scattered, assembles into the picture', () => {
    const { p } = make({ intro: 'scatter' });
    let w = p.frame(0);
    expect(w.sprites.count).toBe(800);
    for (let i = 0; i < 60 * 10; i++) w = p.frame(1 / 60);
    expect(w.sprites.count).toBe(0);
  });

  it('intro rain: the bottom row is let go before the top row', () => {
    const { p } = make({ intro: 'rain' });
    let w = p.frame(0);
    for (let i = 0; i < 30; i++) w = p.frame(1 / 60);
    const ys = (src: number): number => w.sprites.y[[...w.sprites.src.subarray(0, w.sprites.count)].indexOf(src)]!;
    // After 0.5 s the bottom row is falling, the top row still waits above.
    expect(ys(19 * 40 + 5)).toBeGreaterThan(0);
    expect(ys(0 * 40 + 5)).toBeLessThan(0);
  });

  it('is the same after a restart: intro replays', () => {
    const { p } = make({ intro: 'implode' });
    p.frame(0);
    for (let i = 0; i < 20; i++) p.frame(1 / 60);
    const a = Float32Array.from(p.frame(1 / 60).sprites.x.subarray(0, 50));
    p.restart();
    p.frame(0);
    for (let i = 0; i < 20; i++) p.frame(1 / 60);
    const b = Float32Array.from(p.frame(1 / 60).sprites.x.subarray(0, 50));
    expect([...b]).toEqual([...a]);
  });
});

describe('particles on beats', () => {
  it('blasts around its centre on every beat of the track', async () => {
    const { analyseBands } = await import('../../src/audio/bands.ts');
    const RATE = 22050;
    const s = new Float32Array(RATE * 3);
    for (let i = 0; i < s.length; i++) {
      const t = i / RATE;
      s[i] = 0.6 * Math.exp(-(t % 1) / 0.08) * Math.sin(2 * Math.PI * 70 * t);
    }
    const f = createField(40, 20);
    f.lum.fill(1);
    f.alpha.fill(1);
    const p = new Pipeline(f, { cellAspect: 0.5, polarity: 'light-on-dark' }, createPointer());
    p.add(particles, { beat: 80, radius: 10, explode: 0, stiffness: 40, damping: 14 });
    p.setAudio({ bands: analyseBands(s, RATE), timing: { duration: 3, offset: 0, loop: false } });
    let w = p.frame(0);
    for (let i = 0; i < 5; i++) w = p.frame(1 / 60);
    expect(w.sprites.count).toBeGreaterThan(50); // the beat at 0 s
    for (let i = 0; i < 50; i++) w = p.frame(1 / 60); // ~0.9 s: settling, next beat not yet
    const settling = w.sprites.count;
    for (let i = 0; i < 10; i++) w = p.frame(1 / 60); // past the beat at 1 s
    expect(w.sprites.count).toBeGreaterThan(settling);
  });
});
