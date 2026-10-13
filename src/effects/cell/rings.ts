import { RAMP_NAMES } from '../../core/ramp.ts';
import { fieldCell, OPS } from '../field/field.ts';
import { defineEffect } from '../types.ts';

/**
 * Rings (DECISIONS 029): concentric hard rings travel out from a point and
 * fill the cells they cross — solid by default. With `thickness` on `audio`
 * bass the rings swell on every kick.
 */
export const rings = defineEffect({
  id: 'rings',
  name: 'Rings',
  kind: 'cell',
  params: {
    op: { type: 'select', options: OPS, default: 'set', label: 'operation' },
    center: { type: 'point', default: 'center' },
    period: { type: 'number', min: 4, max: 200, step: 1, default: 22, label: 'spacing, cells', random: [12, 50] },
    thickness: { type: 'number', min: 0.5, max: 100, step: 0.5, default: 3, label: 'thickness, cells', random: [1.5, 10] },
    speed: { type: 'number', min: -60, max: 60, step: 0.5, default: 10, label: 'speed, cells/s', random: [4, 25] },
    edge: { type: 'number', min: 0, max: 20, step: 0.5, default: 0, label: 'soft edge, cells' },
    level: { type: 'number', min: 0, max: 1, step: 0.01, default: 1, label: 'level (set, threshold)' },
    ramp: { type: 'select', options: RAMP_NAMES, default: 'blocks', label: 'ramp (ramp operation)' },
  },
  create(p) {
    return {
      kind: 'cell',
      apply: fieldCell((_ctx, f) => {
        f.shape = 'rings';
        f.op = p.op;
        f.cx = p.center.x;
        f.cy = p.center.y;
        f.period = p.period;
        f.thickness = p.thickness;
        f.speed = p.speed;
        f.angle = 0;
        f.spin = 0;
        f.edge = p.edge;
        f.outside = false;
        f.level = p.level;
        f.ramp = RAMP_NAMES.indexOf(p.ramp) + 1;
      }),
    };
  },
});
