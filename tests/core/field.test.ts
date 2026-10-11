import { describe, expect, it } from 'vitest';
import { copyFieldToWork, createField, createWorkBuffer, idx } from '../../src/core/field.ts';

describe('field', () => {
  it('allocates requested optional buffers', () => {
    const field = createField(3, 2, { color: true, char: true, grad: true });

    expect(field.lum).toHaveLength(6);
    expect(field.alpha).toHaveLength(6);
    expect(field.color).toHaveLength(18);
    expect(field.char).toHaveLength(6);
    expect(field.gradX).toHaveLength(6);
    expect(field.gradY).toHaveLength(6);
    expect(idx(3, 2, 1)).toBe(5);
  });

  it('rejects invalid dimensions', () => {
    expect(() => createField(0, 2)).toThrow(/bad size/);
    expect(() => createWorkBuffer(2.5, 2)).toThrow(/bad size/);
  });

  it('copies source data and clears transient buffers', () => {
    const source = createField(2, 1, { color: true, char: true });
    source.lum.set([0.25, 0.75]);
    source.alpha.set([1, 0.5]);
    source.color?.set([1, 2, 3, 4, 5, 6]);
    source.char?.set([65, 66]);

    const work = createWorkBuffer(2, 1, { color: true });
    work.charOverride.set([88, 89]);
    copyFieldToWork(source, work);

    expect([...work.lum]).toEqual([0.25, 0.75]);
    expect([...work.alpha]).toEqual([1, 0.5]);
    expect([...(work.color ?? [])]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...work.char]).toEqual([65, 66]);
    expect([...work.charOverride]).toEqual([0, 0]);
  });

  it('rejects copy between different sizes', () => {
    expect(() => copyFieldToWork(createField(2, 2), createWorkBuffer(3, 2))).toThrow(
      /size mismatch/,
    );
  });
});
