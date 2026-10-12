import { describe, expect, it } from 'vitest';
import { formatClock, transportKey } from '../../src/ui/transport.ts';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('formatClock', () => {
  it('formats minutes, seconds and hundredths', () => {
    expect(formatClock(0)).toBe('0:00.00');
    expect(formatClock(4.271)).toBe('0:04.27');
    expect(formatClock(75.5)).toBe('1:15.50');
    expect(formatClock(-1)).toBe('0:00.00');
  });
});

describe('transportKey', () => {
  it('maps the shortcuts', () => {
    expect(transportKey(key('Home'))).toBe('toStart');
    expect(transportKey(key(' '))).toBe('togglePlay');
    expect(transportKey(key('ArrowRight'))).toBe('step');
    expect(transportKey(key('r'))).toBe('toggleRecord');
    expect(transportKey(key('x'))).toBeNull();
  });

  it('leaves modified keys to the browser (Ctrl+R reloads)', () => {
    expect(transportKey(key('r', { ctrlKey: true }))).toBeNull();
    expect(transportKey(key(' ', { metaKey: true }))).toBeNull();
  });
});
