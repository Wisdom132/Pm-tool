import { describe, it, expect } from 'vitest';
import {
  compositeOver,
  contrastRatio,
  isLargeText,
  luminance,
  parseCssColor,
  wcagVerdict,
} from '../inline-edit-tool/extension/src/ui/contrast.js';

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const WHITE = { r: 255, g: 255, b: 255, a: 1 };

describe('parseCssColor', () => {
  it('parses what getComputedStyle actually returns', () => {
    expect(parseCssColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseCssColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  it('tolerates the spacing browsers vary on', () => {
    expect(parseCssColor('rgb(1,2,3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColor('  rgba( 10 , 20 , 30 , 0.25 )  ')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
  });

  it('refuses author formats — the browser normalises those before we look', () => {
    expect(parseCssColor('#fff')).toBeNull();
    expect(parseCssColor('white')).toBeNull();
    expect(parseCssColor('hsl(0, 0%, 100%)')).toBeNull();
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor(null)).toBeNull();
  });

  it('clamps out-of-range channels rather than propagating them', () => {
    expect(parseCssColor('rgb(300, 0, 0)').r).toBe(255);
    expect(parseCssColor('rgba(0, 0, 0, 7)').a).toBe(1);
  });
});

describe('luminance and ratio — WCAG constants, not approximations', () => {
  it('white is 1, black is 0', () => {
    expect(luminance(WHITE)).toBeCloseTo(1, 5);
    expect(luminance(BLACK)).toBeCloseTo(0, 5);
  });

  it('black on white is 21:1, the maximum', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 1);
  });

  it('a colour against itself is 1:1, the minimum', () => {
    expect(contrastRatio(WHITE, WHITE)).toBe(1);
    const grey = { r: 119, g: 119, b: 119, a: 1 };
    expect(contrastRatio(grey, grey)).toBe(1);
  });

  it('is symmetric — which one is the text does not change the number', () => {
    const a = { r: 30, g: 60, b: 90, a: 1 };
    expect(contrastRatio(a, WHITE)).toBe(contrastRatio(WHITE, a));
  });

  it('matches WebAIM on the canonical example', () => {
    // #777 on white is the textbook borderline: 4.48, an AA fail by 0.02.
    // Getting this one right is the whole reason the check must not round
    // before comparing.
    const grey = { r: 119, g: 119, b: 119, a: 1 };
    expect(contrastRatio(grey, WHITE)).toBeCloseTo(4.48, 2);
    expect(wcagVerdict(contrastRatio(grey, WHITE)).aa).toBe(false);
  });

  it('matches WebAIM on a passing pair', () => {
    // #595959 on white: 7.0, the AAA boundary.
    const grey = { r: 89, g: 89, b: 89, a: 1 };
    expect(contrastRatio(grey, WHITE)).toBeGreaterThanOrEqual(7);
  });
});

describe('compositeOver', () => {
  it('an opaque colour ignores its backdrop', () => {
    expect(compositeOver({ ...BLACK, a: 1 }, WHITE)).toEqual(BLACK);
  });

  it('half-alpha black over white is mid grey', () => {
    const out = compositeOver({ ...BLACK, a: 0.5 }, WHITE);
    expect(out.r).toBeCloseTo(127.5);
    expect(out.a).toBe(1);
  });

  it('translucent text really does lose contrast', () => {
    // rgba(0,0,0,0.6) on white reads as grey. Treating the alpha as opaque
    // would claim 21:1 for text the eye sees at ~5.7:1.
    const seen = compositeOver({ ...BLACK, a: 0.6 }, WHITE);
    const honest = contrastRatio(seen, WHITE);
    expect(honest).toBeLessThan(8);
    expect(honest).toBeGreaterThan(4.5);
  });
});

describe('isLargeText — WCAG px boundaries, exactly', () => {
  it('24px regular is large; 23.9 is not', () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(23.9, 400)).toBe(false);
  });

  it('18.66px bold is large; the same size regular is not', () => {
    expect(isLargeText(18.66, 700)).toBe(true);
    expect(isLargeText(18.66, 400)).toBe(false);
  });

  it('handles the keyword-ish weights browsers report as numbers', () => {
    expect(isLargeText(19, 800)).toBe(true);
    expect(isLargeText(19, 600)).toBe(false);
  });
});

describe('wcagVerdict', () => {
  it('normal text: AA at 4.5, AAA at 7', () => {
    expect(wcagVerdict(4.5)).toMatchObject({ aa: true, aaa: false });
    expect(wcagVerdict(4.49)).toMatchObject({ aa: false });
    expect(wcagVerdict(7)).toMatchObject({ aa: true, aaa: true });
  });

  it('large text: AA at 3, AAA at 4.5', () => {
    const large = { fontSizePx: 24, fontWeight: 400 };
    expect(wcagVerdict(3, large)).toMatchObject({ aa: true, aaa: false, large: true });
    expect(wcagVerdict(2.99, large)).toMatchObject({ aa: false });
    expect(wcagVerdict(4.5, large)).toMatchObject({ aaa: true });
  });

  it('rounds for display but never for the verdict', () => {
    // 4.4949 displays as 4.49 — and must not round its way past the 4.5
    // boundary into a pass.
    const verdict = wcagVerdict(4.4949);
    expect(verdict.ratio).toBe(4.49);
    expect(verdict.aa).toBe(false);
  });
});
