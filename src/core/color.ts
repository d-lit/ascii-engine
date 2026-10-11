export type Rgb = readonly [r: number, g: number, b: number];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v);
}

/** `#rgb` or `#rrggbb` to bytes. */
export function parseHex(hex: string): Rgb {
  const m = HEX.exec(hex);
  if (!m) throw new Error(`parseHex: expected #rgb or #rrggbb, got ${hex}`);
  const h = m[1]!;
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  const byte = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}
