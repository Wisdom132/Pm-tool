import { describe, it, expect } from 'vitest';
import {
  BREAKPOINTS,
  activeBreakpoint,
  windowSizeFor,
} from '../inline-edit-tool/extension/src/ui/viewport.js';

describe('breakpoints', () => {
  it('covers phone through desktop', () => {
    const widths = BREAKPOINTS.map((b) => b.width);
    expect(Math.min(...widths)).toBeLessThanOrEqual(400);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(1600);
  });

  it('is ordered narrowest first', () => {
    const widths = BREAKPOINTS.map((b) => b.width);
    expect([...widths].sort((a, b) => a - b)).toEqual(widths);
  });
});

describe('activeBreakpoint', () => {
  it('matches an exact width', () => {
    expect(activeBreakpoint(390).id).toBe('mobile');
    expect(activeBreakpoint(1280).id).toBe('laptop');
  });

  it('tolerates a pixel or two of rounding', () => {
    expect(activeBreakpoint(391).id).toBe('mobile');
    expect(activeBreakpoint(389).id).toBe('mobile');
  });

  it('reports none when the viewport is its own size', () => {
    expect(activeBreakpoint(1024)).toBeNull();
    expect(activeBreakpoint(400)).toBeNull();
  });
});

describe('windowSizeFor', () => {
  const bp = { width: 390, height: 844 };

  it('adds the browser chrome so the viewport lands on target', () => {
    // A 390px window would give a narrower viewport; the difference between
    // outer and inner size has to be added back.
    const size = windowSizeFor(bp, {
      outerWidth: 1300, innerWidth: 1280,
      outerHeight: 900, innerHeight: 800,
    });
    expect(size.width).toBe(410);
    expect(size.height).toBe(944);
  });

  it('never subtracts when inner exceeds outer', () => {
    const size = windowSizeFor(bp, {
      outerWidth: 1280, innerWidth: 1300,
      outerHeight: 800, innerHeight: 900,
    });
    expect(size.width).toBe(390);
    expect(size.height).toBe(844);
  });
});
