import { RAMP_NAMES } from '../../core/ramp.ts';
import { fieldCell, OPS } from '../field/field.ts';
import { defineEffect } from '../types.ts';

/**
 * Bands (DECISIONS 029): stripes that run across the picture and flip the
 * cells under them whole — inverted by default, hard-edged, at any angle.
 */
export const bands = defineEffect({
  id: 'bands',
  name: 'Bands',
  kind: 'cell',
  params: {
    op: { type: 'select', options: OPS, default: 'invert', label: 'operation' },
    period: { type: 'number', min: 4, max: 200, step: 1, default: 28, label: 'period, cells', random: [14, 60] },
    thickness: { type: 'number', min: 0.5, max: 100, step: 0.5, default: 10, label: 'thickness, cells', random: [3, 20] },
    angle: { type: 'number', min: -360, max: 360, step: 1, default: 30, label: 'angle, deg', random: [-90, 90] },
    spin: { type: 'number', min: -180, max: 180, step: 1, default: 0, label: 'spin, deg/s', random: [-15, 15] },
    speed: { type: 'number', min: -60, max: 60, step: 0.5, default: 8, label: 'speed, cells/s', random: [-20, 20] },
    edge: { type: 'number', min: 0, max: 20, step: 0.5, default: 0, label: 'soft edge, cells' },
    level: { type: 'number', min: 0, max: 1, step: 0.01, default: 1, label: 'level (set, threshold)' },
    ramp: { type: 'select', options: RAMP_NAMES, default: 'blocks', label: 'ramp (ramp operation)' },
  },
  create(p) {
    return {
      kind: 'cell',
      apply: fieldCell((_ctx, f) => {
        f.shape = 'stripes';
        f.op = p.op;
        f.period = p.period;
        f.thickness = p.thickness;
        f.angle = p.angle;
        f.spin = p.spin;
        f.speed = p.speed;
        f.edge = p.edge;
        f.outside = false;
        f.level = p.level;
        f.ramp = RAMP_NAMES.indexOf(p.ramp) + 1;
      }),
    };
  },
});
