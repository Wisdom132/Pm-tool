// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSearchPanel, findMatches } from '../inline-edit-tool/extension/src/ui/search.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findMatches', () => {
  it('tries the query as a CSS selector first', () => {
    document.body.innerHTML = '<p class="btn">a</p><p>b</p><span class="btn">c</span>';
    expect(findMatches('.btn')).toHaveLength(2);
    expect(findMatches('span')).toHaveLength(1);
  });

  it('falls back to text when the query is not a selector', () => {
    document.body.innerHTML = '<p>Sign up now</p><p>sign UP later</p><p>neither</p>';
    const matches = findMatches('sign up');
    expect(matches).toHaveLength(2);
  });

  it('matches direct text only, so a query does not return <body>', () => {
    // Matching descendants would make every container a hit for every
    // query, and the first result would always be the page itself.
    document.body.innerHTML = '<div id="wrap"><p id="hit">Sign up</p></div>';
    const matches = findMatches('Sign up');
    expect(matches.map((m) => m.id)).toEqual(['hit']);
  });

  it('excludes what the caller excludes — our own UI', () => {
    document.body.innerHTML = '<p id="ours">Sign up</p><p id="theirs">Sign up</p>';
    const ours = document.getElementById('ours');
    expect(findMatches('Sign up', document, (el) => el === ours)).toHaveLength(1);
  });

  it('never matches script contents', () => {
    document.body.innerHTML = '<script>var signUp = 1;</script><p>signUp</p>';
    expect(findMatches('signUp').every((el) => el.tagName !== 'SCRIPT')).toBe(true);
  });

  it('is empty for an empty query rather than matching everything', () => {
    document.body.innerHTML = '<p>a</p>';
    expect(findMatches('')).toEqual([]);
    expect(findMatches('   ')).toEqual([]);
  });

  it('caps runaway result sets', () => {
    document.body.innerHTML = Array.from({ length: 200 }, () => '<p>x</p>').join('');
    expect(findMatches('p').length).toBeLessThanOrEqual(50);
  });
});

describe('the search panel', () => {
  let panel;
  let onPick;
  let onHighlight;

  beforeEach(() => {
    onPick = vi.fn();
    onHighlight = vi.fn();
    panel = createSearchPanel({ onPick, onHighlight });
    document.body.appendChild(panel.element);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<p id="one">Sign up</p><p id="two">Sign up</p>'
    );
    for (const el of document.querySelectorAll('p')) {
      el.scrollIntoView = () => {};
    }
  });

  const input = () => panel.element.querySelector('.__iet-search-input');
  const type = (q) => {
    input().value = q;
    input().dispatchEvent(new Event('input', { bubbles: true }));
  };
  const press = (key, init = {}) =>
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));

  it('counts matches as the query is typed', () => {
    panel.open();
    type('Sign up');
    expect(panel.element.querySelector('.__iet-search-count').textContent).toBe('2');
  });

  it('enter walks the matches and highlights each', () => {
    panel.open();
    type('Sign up');
    press('Enter');

    expect(onHighlight).toHaveBeenLastCalledWith(document.getElementById('one'));
    expect(panel.element.querySelector('.__iet-search-count').textContent).toBe('1 of 2');
  });

  it('wraps at the end and walks backwards with shift', () => {
    panel.open();
    type('Sign up');
    press('Enter');
    press('Enter', { shiftKey: true });
    // Back from the first wraps to the last.
    expect(onHighlight).toHaveBeenLastCalledWith(document.getElementById('two'));
  });

  it('cmd-enter hands the current match to the active tool and closes', () => {
    panel.open();
    type('Sign up');
    press('Enter'); // stand on #one
    press('Enter', { metaKey: true }); // take it

    expect(onPick).toHaveBeenCalledWith(document.getElementById('one'));
    expect(panel.visible).toBe(false);
  });

  it('plain enter keeps walking — the second match must be reachable', () => {
    // The regression this pins: pick-on-plain-Enter made every match past
    // the first unreachable by keyboard.
    panel.open();
    type('Sign up');
    press('Enter');
    press('Enter');

    expect(onPick).not.toHaveBeenCalled();
    expect(onHighlight).toHaveBeenLastCalledWith(document.getElementById('two'));
  });

  it('shows the source file of the current match — the part VisBug cannot', () => {
    document.getElementById('one').dataset.editFile = 'src/pages/index.jsx';
    document.getElementById('one').dataset.editLine = '12';

    panel.open();
    type('Sign up');
    press('Enter');

    expect(panel.element.querySelector('.__iet-search-source').textContent).toBe('index.jsx:12');
  });

  it('says honestly when a match has no source map', () => {
    panel.open();
    type('Sign up');
    press('Enter');

    const source = panel.element.querySelector('.__iet-search-source');
    expect(source.textContent).toBe('no source map');
    expect(source.dataset.unmapped).toBe('true');
  });

  it('escape closes and clears the highlight', () => {
    panel.open();
    type('Sign up');
    press('Enter');
    press('Escape');

    expect(panel.visible).toBe(false);
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  it('editing the query resets the walk', () => {
    panel.open();
    type('Sign up');
    press('Enter');
    type('Sign');
    // A stale "1 of 2" against a new result set would point at the wrong
    // element.
    expect(panel.element.querySelector('.__iet-search-count').textContent).toBe('2');
    expect(onHighlight).toHaveBeenLastCalledWith(null);
  });

  it('keystrokes in the query never leak to the page', () => {
    const leaked = vi.fn();
    document.addEventListener('keydown', leaked);

    panel.open();
    press('e'); // would switch to the Edit tool if it escaped

    expect(leaked).not.toHaveBeenCalled();
    document.removeEventListener('keydown', leaked);
  });
});
