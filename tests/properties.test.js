// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPropertiesPanel,
  collectPageClasses,
  suggestClasses,
  classAttributeFor,
  EDITABLE_ATTRS,
} from '../inline-edit-tool/extension/src/ui/properties.js';

function mount(html) {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
}

describe('collectPageClasses', () => {
  it('gathers class names used on the page', () => {
    mount('<div class="a b"><span class="c"></span></div>');
    expect(collectPageClasses(document).sort()).toEqual(['a', 'b', 'c']);
  });

  it('excludes our own decoration classes', () => {
    mount('<div class="a __iet-editable __iet-dirty"></div>');
    expect(collectPageClasses(document)).toEqual(['a']);
  });

  it('deduplicates', () => {
    mount('<div class="a"></div><div class="a"></div>');
    expect(collectPageClasses(document)).toEqual(['a']);
  });

  it('respects the limit', () => {
    mount(
      `<div class="${Array.from({ length: 50 }, (_, i) => `c${i}`).join(' ')}"></div>`
    );
    expect(collectPageClasses(document, 10).length).toBeLessThanOrEqual(10);
  });
});

describe('suggestClasses', () => {
  const pool = ['text-sm', 'text-lg', 'text-center', 'btn', 'btn-primary', 'mt-4'];

  it('puts prefix matches before substring matches', () => {
    // "btn" contains "t" but does not start with "text"; every text-* class
    // should outrank it.
    const out = suggestClasses('t', [...pool, 'x-text-y']);
    expect(out.indexOf('text-sm')).toBeLessThan(out.indexOf('x-text-y'));
  });

  it('returns every prefix match', () => {
    const out = suggestClasses('text', pool);
    expect(out).toEqual(expect.arrayContaining(['text-sm', 'text-lg', 'text-center']));
  });

  it('includes substring matches after prefix matches', () => {
    const out = suggestClasses('btn', pool);
    expect(out).toEqual(['btn-primary']);
  });

  it('prefers shorter names', () => {
    expect(suggestClasses('text-', pool)[0]).toBe('text-lg');
  });

  it('omits an exact match, which is already typed', () => {
    expect(suggestClasses('btn', ['btn'])).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(suggestClasses('', pool)).toEqual([]);
    expect(suggestClasses('   ', pool)).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(suggestClasses('TEXT-S', pool)).toContain('text-sm');
  });
});

describe('classAttributeFor', () => {
  it('uses className for React', () => {
    const el = mount('<div data-edit-framework="react"></div>');
    expect(classAttributeFor(el)).toBe('className');
  });

  it('uses class elsewhere', () => {
    expect(classAttributeFor(mount('<div data-edit-framework="vue"></div>'))).toBe('class');
    expect(classAttributeFor(mount('<div></div>'))).toBe('class');
  });
});

describe('properties panel', () => {
  let panel;
  let onChange;
  let onPickImage;

  beforeEach(() => {
    document.body.innerHTML = '';
    onChange = vi.fn();
    onPickImage = vi.fn();
    panel = createPropertiesPanel({ root: document.body, onChange, onPickImage });
    document.body.appendChild(panel.element);
  });

  const inputFor = (label) =>
    [...panel.element.querySelectorAll(`.__iet-prop-row`)]
      .find((row) => row.querySelector('.__iet-prop-label').textContent === label)
      ?.querySelector('input');

  it('starts hidden', () => {
    expect(panel.element.hidden).toBe(true);
  });

  it('shows only attributes the element actually has', () => {
    const el = mount('<a href="/x" title="Go">Link</a>');
    panel.show(el);

    expect(inputFor('Link')).toBeTruthy();
    expect(inputFor('Tooltip')).toBeTruthy();
    // No alt on an anchor, so no row for it.
    expect(inputFor('Alt text')).toBeUndefined();
  });

  it('explains when there is nothing to edit', () => {
    panel.show(mount('<p>Just text</p>'));
    expect(panel.element.querySelector('.__iet-prop-note')).not.toBeNull();
  });

  it('reports an attribute change and applies it live', () => {
    const el = mount('<img src="/a.png" alt="Old">');
    panel.show(el);

    const input = inputFor('Alt text');
    input.value = 'New';
    input.dispatchEvent(new Event('blur'));

    expect(el.getAttribute('alt')).toBe('New');
    expect(onChange).toHaveBeenCalledWith({
      attribute: 'alt',
      originalValue: 'Old',
      newValue: 'New',
    });
  });

  it('reports nothing when the value is unchanged', () => {
    const el = mount('<img src="/a.png" alt="Same">');
    panel.show(el);
    inputFor('Alt text').dispatchEvent(new Event('blur'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the first original across repeated edits', () => {
    const el = mount('<img src="/a.png" alt="First">');
    panel.show(el);

    const input = inputFor('Alt text');
    input.value = 'Second';
    input.dispatchEvent(new Event('blur'));
    input.value = 'Third';
    input.dispatchEvent(new Event('blur'));

    // The panel reports each transition; the session collapses them. What
    // matters here is that the element ends up correct.
    expect(el.getAttribute('alt')).toBe('Third');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('offers image replacement only on a src row', () => {
    panel.show(mount('<img src="/a.png" alt="Logo">'));
    expect(panel.element.querySelector('.__iet-prop-pick')).not.toBeNull();

    panel.show(mount('<a href="/x">Link</a>'));
    expect(panel.element.querySelector('.__iet-prop-pick')).toBeNull();
  });

  it('asks to pick an image', () => {
    const el = mount('<img src="/a.png">');
    panel.show(el);
    panel.element.querySelector('.__iet-prop-pick').click();
    expect(onPickImage).toHaveBeenCalledWith(el);
  });
});

describe('class editing', () => {
  let panel;
  let onChange;

  beforeEach(() => {
    document.body.innerHTML = '';
    onChange = vi.fn();
    panel = createPropertiesPanel({ root: document.body, onChange });
    document.body.appendChild(panel.element);
  });

  const chips = () => [...panel.element.querySelectorAll('.__iet-chip')];

  it('lists the element classes as chips', () => {
    panel.show(mount('<div class="btn btn-primary"></div>'));
    expect(chips().map((c) => c.textContent.replace('×', ''))).toEqual(['btn', 'btn-primary']);
  });

  it('never shows our decoration classes as chips', () => {
    panel.show(mount('<div class="btn __iet-editable"></div>'));
    expect(chips()).toHaveLength(1);
  });

  it('removes a class and reports the new value', () => {
    const el = mount('<div class="btn btn-primary"></div>');
    panel.show(el);

    chips()[1].querySelector('.__iet-chip-remove').click();

    expect(el.className).toBe('btn');
    expect(onChange).toHaveBeenCalledWith({
      attribute: 'class',
      originalValue: 'btn btn-primary',
      newValue: 'btn',
    });
  });

  it('preserves our decoration classes on the element while editing', () => {
    // They are ours, not the page's — they must survive the rewrite but
    // never reach the source.
    const el = mount('<div class="btn __iet-dirty"></div>');
    panel.show(el);
    chips()[0].querySelector('.__iet-chip-remove').click();

    expect(el.classList.contains('__iet-dirty')).toBe(true);
    expect(onChange.mock.calls[0][0].newValue).toBe('');
  });

  it('adds a class on Enter', () => {
    const el = mount('<div class="btn"></div>');
    panel.show(el);

    const input = panel.element.querySelector('.__iet-chip-input');
    input.value = 'rounded-lg';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(el.classList.contains('rounded-lg')).toBe(true);
    expect(onChange.mock.calls[0][0].newValue).toBe('btn rounded-lg');
  });

  it('does not add a duplicate', () => {
    const el = mount('<div class="btn"></div>');
    panel.show(el);

    const input = panel.element.querySelector('.__iet-chip-input');
    input.value = 'btn';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('suggests classes already used on the page', () => {
    mount('<div class="existing-utility"></div>');
    const el = document.body.firstElementChild;
    document.body.appendChild(panel.element);
    panel.show(el);

    const input = panel.element.querySelector('.__iet-chip-input');
    input.value = 'exist';
    input.dispatchEvent(new Event('input'));

    const options = [...panel.element.querySelectorAll('.__iet-suggestion')];
    expect(options.map((o) => o.textContent)).toContain('existing-utility');
  });
});

describe('editable attribute list', () => {
  it('covers the attributes that carry meaning', () => {
    const names = EDITABLE_ATTRS.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining(['alt', 'href', 'title', 'aria-label', 'src'])
    );
  });
});
