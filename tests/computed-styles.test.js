// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULTS,
  nonDefaultStyles,
} from '../inline-edit-tool/extension/src/ui/computed-styles.js';

/**
 * getComputedStyle returns ~340 properties, nearly all of them the browser's
 * default. The question somebody standing in front of an element has is
 * "what is different about this one" — a list of fewer than ten.
 */
function fakeWindow(styles) {
  return {
    getComputedStyle: () => ({
      getPropertyValue: (p) => styles[p] ?? DEFAULTS[p] ?? '',
    }),
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="t">x</div>';
});

const target = () => document.getElementById('t');

describe('nonDefaultStyles', () => {
  it('reports only what differs from the default', () => {
    const win = fakeWindow({ padding: '16px', 'font-size': '16px' });
    const out = nonDefaultStyles(target(), win);

    expect(out).toEqual([{ prop: 'padding', value: '16px' }]);
  });

  it('is empty for an untouched element', () => {
    expect(nonDefaultStyles(target(), fakeWindow({}))).toEqual([]);
  });

  it('treats the many spellings of "nothing" as nothing', () => {
    // A browser reports `0px 0px 0px 0px` for untouched padding and
    // `rgba(0, 0, 0, 0)` for an unset background. Counting those as
    // deviations puts a row on every element and buries the real ones.
    const win = fakeWindow({
      padding: '0px 0px 0px 0px',
      'box-shadow': 'none',
      transform: 'none',
      'z-index': 'auto',
    });
    expect(nonDefaultStyles(target(), win)).toEqual([]);
  });

  it('does not report an element having the display its tag already has', () => {
    document.body.innerHTML = '<span id="t">x</span>';
    const win = fakeWindow({ display: 'inline' });
    expect(nonDefaultStyles(target(), win)).toEqual([]);
  });

  it('does report a display the tag would not have had', () => {
    document.body.innerHTML = '<span id="t">x</span>';
    const win = fakeWindow({ display: 'flex' });
    expect(nonDefaultStyles(target(), win)).toEqual([{ prop: 'display', value: 'flex' }]);
  });

  it('groups by kind rather than alphabetically', () => {
    // Nobody reads styles alphabetically. Box, then type, then paint, then
    // layout is how a designer thinks about an element.
    const keys = Object.keys(DEFAULTS);
    expect(keys.indexOf('padding')).toBeLessThan(keys.indexOf('font-size'));
    expect(keys.indexOf('font-size')).toBeLessThan(keys.indexOf('display'));
  });

  it('leaves font-family out on purpose', () => {
    // It is inherited from the page, so it differs on effectively every
    // element and would be noise on all of them.
    expect(DEFAULTS).not.toHaveProperty('font-family');
  });
});
