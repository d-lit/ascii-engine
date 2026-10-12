import { describe, expect, it } from 'vitest';
import { bitrateFor, supportedFormats, videoFileName } from '../../src/export/video-recorder.ts';

describe('supportedFormats', () => {
  it('keeps the best format per container, MP4 first', () => {
    const chrome = (m: string) => m !== 'video/mp4;codecs=avc1.640033';
    expect(supportedFormats(chrome).map((f) => f.mimeType)).toEqual(['video/mp4;codecs=avc1', 'video/webm;codecs=vp9']);
  });

  it('finds the audio variant: AAC first in MP4, Opus in WebM, none when missing', () => {
    const noAac = (m: string) => !m.includes('mp4a') && m !== 'video/webm;codecs=vp9,opus';
    const [mp4, webm] = supportedFormats(noAac);
    expect(mp4?.audioMimeType).toBe('video/mp4;codecs=avc1.640033,opus');
    expect(webm?.audioMimeType).toBeNull();
    const [all] = supportedFormats(() => true);
    expect(all?.audioMimeType).toBe('video/mp4;codecs=avc1.640033,mp4a.40.2');
  });

  it('falls back to WebM only, or nothing', () => {
    expect(supportedFormats((m) => m.startsWith('video/webm')).map((f) => f.ext)).toEqual(['webm']);
    expect(supportedFormats(() => false)).toEqual([]);
  });
});

describe('bitrateFor', () => {
  it('scales with pixels, fps and quality', () => {
    const med = bitrateFor(1200, 1200, 60, 'medium');
    expect(med).toBe(Math.round(1200 * 1200 * 60 * 0.15));
    expect(bitrateFor(1200, 1200, 30, 'medium')).toBe(med / 2);
    expect(bitrateFor(1200, 1200, 60, 'high')).toBe(med * 2);
  });
});

describe('videoFileName', () => {
  it('combines source and preset as slugs', () => {
    expect(videoFileName('My Photo.JPG', 'Neon tide', 'mp4')).toBe('my-photo-neon-tide.mp4');
    expect(videoFileName('портрет.png', 'Random 123', 'webm')).toBe('портрет-random-123.webm');
    expect(videoFileName('', '', 'mp4')).toBe('ascii.mp4');
  });
});
