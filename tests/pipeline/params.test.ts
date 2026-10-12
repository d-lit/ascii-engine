import { describe, expect, it } from 'vitest';
import {
  createParamBag,
  resolveParams,
  type ParamFrame,
  type ParamSchema,
} from '../../src/pipeline/params.ts';

const schema = {
  speed: { type: 'number', min: 0, max: 10, default: 2 },
  on: { type: 'boolean', default: true },
  mode: { type: 'select', options: ['a', 'b'], default: 'a' },
  center: { type: 'point', default: 'center' },
} satisfies ParamSchema;
const keys = Object.keys(schema);
const frame: ParamFrame = { cols: 11, rows: 5, pointer: { x: 3.5, y: 1.25 } };

describe('resolveParams', () => {
  it('fills defaults and places points in cells', () => {
    const bag = createParamBag(schema);
    resolveParams(schema, keys, {}, frame, bag, 0);
    expect(bag).toEqual({ speed: 2, on: true, mode: 'a', center: { x: 5, y: 2 } });
  });

  it('clamps numbers and rejects wrong types and unknown options', () => {
    const bag = createParamBag(schema);
    resolveParams(schema, keys, { speed: 99, on: 'yes', mode: 'z' }, frame, bag, 0);
    expect(bag.speed).toBe(10);
    expect(bag.on).toBe(true);
    expect(bag.mode).toBe('a');
    resolveParams(schema, keys, { speed: Number.NaN }, frame, bag, 0);
    expect(bag.speed).toBe(2);
  });

  it('follows the pointer and maps normalized points to cell centres', () => {
    const bag = createParamBag(schema);
    resolveParams(schema, keys, { center: 'pointer' }, frame, bag, 0);
    expect(bag.center).toEqual({ x: 3.5, y: 1.25 });
    resolveParams(schema, keys, { center: { x: 1, y: 0 } }, frame, bag, 0);
    expect(bag.center).toEqual({ x: 10, y: 0 });
  });

  it('accepts positions off the picture and clamps beyond -0.5..1.5', () => {
    const bag = createParamBag(schema);
    resolveParams(schema, keys, { center: { x: -0.5, y: 1.5 } }, frame, bag, 0);
    expect(bag.center).toEqual({ x: -5, y: 6 });
    resolveParams(schema, keys, { center: { x: -3, y: 9 } }, frame, bag, 0);
    expect(bag.center).toEqual({ x: -5, y: 6 });
  });

  it('mutates point objects in place instead of allocating', () => {
    const bag = createParamBag(schema);
    const point = bag.center;
    resolveParams(schema, keys, { center: 'pointer' }, frame, bag, 0);
    expect(bag.center).toBe(point);
  });
});
