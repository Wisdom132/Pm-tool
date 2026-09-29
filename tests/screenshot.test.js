import { describe, it, expect } from 'vitest';
import {
  MAX_BYTES,
  MAX_WIDTH,
  QUALITIES,
  decodedSize,
  targetSize,
} from '../inline-edit-tool/extension/src/screenshot.js';

describe('targetSize', () => {
  it('leaves an image that is already small enough alone', () => {
    expect(targetSize(1200, 800)).toEqual({ width: 1200, height: 800 });
  });

  it('scales a retina capture down, keeping the aspect ratio', () => {
    // A 1440-CSS-pixel display captures 2880 device pixels. Storing both is
    // paying twice for the same picture.
    const { width, height } = targetSize(2880, 1800);
    expect(width).toBe(MAX_WIDTH);
    expect(height / width).toBeCloseTo(1800 / 2880, 2);
  });

  it('returns whole pixels', () => {
    // A canvas with a fractional height floors it and shifts the image.
    const { width, height } = targetSize(2881, 1801);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });

  it('never rounds a very wide, very short image down to nothing', () => {
    // Zero would produce a canvas that cannot be drawn to.
    expect(targetSize(10000, 3).height).toBeGreaterThanOrEqual(1);
  });

  it('handles a zero-sized image rather than dividing by it', () => {
    expect(targetSize(0, 0)).toEqual({ width: 0, height: 0 });
    expect(targetSize(100, 0)).toEqual({ width: 0, height: 0 });
  });

  it('respects an explicit maximum', () => {
    expect(targetSize(1000, 500, 400)).toEqual({ width: 400, height: 200 });
  });

  it('does not upscale a small image to the maximum', () => {
    expect(targetSize(320, 200)).toEqual({ width: 320, height: 200 });
  });
});

describe('decodedSize', () => {
  it('measures what the bytes will weigh, not the string', () => {
    // Base64 is a third larger than what it encodes. Checking the string
    // length would reject images that fit and accept ones that do not.
    const bytes = Buffer.alloc(3000, 1);
    const url = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    expect(decodedSize(url)).toBe(3000);
  });

  it('accounts for padding', () => {
    for (const length of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const bytes = Buffer.alloc(length, 7);
      const url = `data:image/jpeg;base64,${bytes.toString('base64')}`;
      expect(decodedSize(url), `${length} bytes`).toBe(length);
    }
  });

  it('is zero for something that is not a data URL', () => {
    expect(decodedSize('')).toBe(0);
    expect(decodedSize('nonsense')).toBe(0);
  });
});

describe('the caps line up with the API', () => {
  it('leaves room under the server limit', () => {
    // MAX_SCREENSHOT_BYTES on the API is 512 * 1024. Aiming exactly at it
    // means finding out it was too big only after uploading it.
    expect(MAX_BYTES).toBeLessThan(512 * 1024);
  });

  it('degrades quality in descending steps', () => {
    expect(QUALITIES).toEqual([...QUALITIES].sort((a, b) => b - a));
    expect(QUALITIES.every((q) => q > 0 && q <= 1)).toBe(true);
  });

  it('tries scaling before it tries ruining the text', () => {
    // The first quality tried is a readable one; the low ones are a last
    // resort after the dimensions have already come down.
    expect(QUALITIES[0]).toBeGreaterThanOrEqual(0.6);
  });
});
