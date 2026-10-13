import { RAMP_NAMES } from '../../core/ramp.ts';
import { fieldCell, OPS, SHAPES } from '../field/field.ts';
import { defineEffect } from '../types.ts';

/**
 * The field constructor (DECISIONS 029): any shape with any operation, every
 * parameter at once. Labels say which shapes and operations use a parameter.
 */
export const field = defineEffect({
  id: 'field',
  name: 'Field',
  kind: 'cell',
  params: {
    shape: { type: 'select', options: SHAPES, default: 'circle' },
    op: { type: 'select', options: OPS, default: 'invert', label: 'operation' },
    center: { type: 'point', default: 'center', label: 'center (circle, ring, box, rings, line)' },
    size: { type: 'number', min: 0, max: 200, step: 1, default: 20, label: 'size, cells (circle, ring, box; plasma scale)', random: [8, 40] },
    thickness: { type: 'number', min: 0.5, max: 60, step: 0.5, default: 4, label: 'thickness, cells (ring, stripes, rings, line)', random: [2, 10] },
    period: { type: 'number', min: 2, max: 200, step: 1, default: 16, label: 'period, cells (stripes, rings)', random: [8, 40] },
    angle: { type: 'number', min: -360, max: 360, step: 1, default: 0, label: 'angle, deg (box, stripes, line)' },
    spin: { type: 'number', min: -360, max: 360, step: 1, default: 0, label: 'spin, deg/s', random: [-30, 30] },
    speed: { type: 'number', min: -60, max: 60, step: 0.5, default: 0, label: 'speed (stripes, rings: cells/s; plasma: flow)', random: [-10, 10] },
    edge: { type: 'number', min: 0, max: 20, step: 0.5, default: 0, label: 'soft edge, cells' },
    outside: { type: 'boolean', default: false, label: 'act outside' },
    level: { type: 'number', min: 0, max: 1, step: 0.01, default: 1, label: 'level (set, threshold)' },
    cover: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, label: 'cover (plasma)', random: [0.3, 0.6] },
    ramp: { type: 'select', options: RAMP_NAMES, default: 'blocks', label: 'ramp (ramp operation)' },
  },
  create(p) {
    return {
      kind: 'cell',
      apply: fieldCell((_ctx, f) => {
        f.shape = p.shape;
        f.op = p.op;
        f.cx = p.center.x;
        f.cy = p.center.y;
        f.size = p.size;
        f.thickness = p.thickness;
        f.period = p.period;
        f.angle = p.angle;
        f.spin = p.spin;
        f.speed = p.speed;
        f.edge = p.edge;
        f.outside = p.outside;
        f.level = p.level;
        f.cover = p.cover;
        f.ramp = RAMP_NAMES.indexOf(p.ramp) + 1;
      }),
    };
  },
});
