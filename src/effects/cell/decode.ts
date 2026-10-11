import { HASH_UNIT, hashInt2, hashInt3 } from '../../core/prng.ts';
import { defineEffect } from '../types.ts';

const SETS = {
  ascii: '!#$%&*+-/0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_{|}~',
  binary: '01',
  hex: '0123456789ABCDEF',
  blocks: '░▒▓█',
} as const;

type SetName = keyof typeof SETS;
const SET_NAMES = Object.keys(SETS) as SetName[];

const CODES: Record<SetName, Uint16Array> = {
  ascii: toCodes(SETS.ascii),
  binary: toCodes(SETS.binary),
  hex: toCodes(SETS.hex),
  blocks: toCodes(SETS.blocks),
};

function toCodes(chars: string): Uint16Array {
  return Uint16Array.from(chars, (c) => c.charCodeAt(0));
}

// Separate hash streams so delay and glyph choice are uncorrelated.
const SEED_DELAY = 0x0dec0de;
const SEED_GLYPH = 0x5c4a3b1e;

/**
 * Decode reveal: a front spreads from `center`; each cell is hidden before the
 * front reaches it, flickers through random glyphs for `scramble` seconds,
 * then settles on its real glyph (charOverride back to 0). Time counts from
 * the first frame the instance runs, so enabling it or loading a new picture
 * replays the reveal (DECISIONS 012).
 */
export const decode = defineEffect({
  id: 'decode',
  name: 'Decode',
  kind: 'cell',
  params: {
    center: { type: 'point', default: 'center' },
    speed: { type: 'number', min: 1, max: 400, step: 1, default: 60, label: 'front, cells/s' },
    scramble: { type: 'number', min: 0, max: 3, step: 0.05, default: 0.6, label: 'scramble, s' },
    jitter: { type: 'number', min: 0, max: 2, step: 0.05, default: 0.4, label: 'jitter, s' },
    rate: { type: 'number', min: 1, max: 60, step: 1, default: 20, label: 'flicker, 1/s' },
    set: { type: 'select', options: SET_NAMES, default: 'ascii', label: 'glyphs' },
    hideBefore: { type: 'boolean', default: true, label: 'hide before front' },
  },
  create(p) {
    let start = -1;

    return {
      kind: 'cell',
      apply(cell, x, y, ctx) {
        if (cell.alpha <= 0) return;
        if (start < 0) start = ctx.time;

        const t = ctx.time - start;
        const dx = x - p.center.x;
        const dy = (y - p.center.y) / ctx.cellAspect;
        const delay = hashInt2(x, y, SEED_DELAY) * HASH_UNIT * p.jitter;
        const arrive = Math.sqrt(dx * dx + dy * dy) / p.speed + delay;

        if (t < arrive) {
          if (p.hideBefore) cell.alpha = 0;
          return;
        }
        if (t >= arrive + p.scramble) return;

        const codes = CODES[p.set];
        // `| 0` keeps the tick an integer: hashes take integers only (DECISIONS 013).
        const tick = Math.floor(t * p.rate) | 0;
        cell.char = codes[Math.floor(hashInt3(x, y, tick, SEED_GLYPH) * HASH_UNIT * codes.length)]!;
      },
    };
  },
});
