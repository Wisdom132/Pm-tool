// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import {
  hasDirectText,
  domPath,
  editKey,
  findEditableElements,
  editableAncestors,
  describeElement,
  observeDom,
} from '../inline-edit-tool/extension/src/element-registry.js';

function mount(html) {
  document.body.innerHTML = html;
  return document.body;
}

describe('hasDirectText', () => {
  it('sees a direct text node', () => {
    mount('<p id="a">Hello</p>');
    expect(hasDirectText(document.getElementById('a'))).toBe(true);
  });

  it('ignores text that belongs to a child', () => {
    mount('<div id="a"><span>Hello</span></div>');
    expect(hasDirectText(document.getElementById('a'))).toBe(false);
  });

  it('ignores whitespace-only content', () => {
    mount('<p id="a">\n   \n</p>');
    expect(hasDirectText(document.getElementById('a'))).toBe(false);
  });

  it('sees text alongside a child element', () => {
    mount('<p id="a">Hello <b>there</b></p>');
    expect(hasDirectText(document.getElementById('a'))).toBe(true);
  });
});

describe('domPath', () => {
  it('builds a path from body', () => {
    mount('<div><section><h1 id="a">Hi</h1></section></div>');
    expect(domPath(document.getElementById('a'))).toBe('div:1>section:1>h1:1');
  });

  it('counts position among same-tag siblings only', () => {
    mount('<div><span>x</span><p id="a">y</p><p id="b">z</p></div>');
    expect(domPath(document.getElementById('a'))).toBe('div:1>p:1');
    expect(domPath(document.getElementById('b'))).toBe('div:1>p:2');
  });

  it('distinguishes sibling subtrees', () => {
    mount('<div><h1 id="a">A</h1></div><div><h1 id="b">B</h1></div>');
    expect(domPath(document.getElementById('a'))).not.toBe(
      domPath(document.getElementById('b'))
    );
  });
});

describe('editKey', () => {
  it('prefers the annotation coordinate', () => {
    mount('<h1 id="a" data-edit-file="src/Hero.tsx" data-edit-line="12" data-edit-col="4">Hi</h1>');
    expect(editKey(document.getElementById('a'))).toBe('src:src/Hero.tsx:12:4');
  });

  it('defaults the column when absent', () => {
    mount('<h1 id="a" data-edit-file="src/Hero.tsx" data-edit-line="12">Hi</h1>');
    expect(editKey(document.getElementById('a'))).toBe('src:src/Hero.tsx:12:0');
  });

  it('falls back to a DOM path when unannotated', () => {
    mount('<div><h1 id="a">Hi</h1></div>');
    expect(editKey(document.getElementById('a'))).toBe('dom:div:1>h1:1');
  });

  it('survives an element being replaced by a re-render', () => {
    // This is the property the whole design depends on: a key computed from
    // source coordinates is identical before and after React swaps the node.
    mount('<h1 id="a" data-edit-file="src/Hero.tsx" data-edit-line="12" data-edit-col="4">Hi</h1>');
    const before = editKey(document.getElementById('a'));

    mount('<h1 id="a" data-edit-file="src/Hero.tsx" data-edit-line="12" data-edit-col="4">Changed</h1>');
    expect(editKey(document.getElementById('a'))).toBe(before);
  });

  it('gives different keys to different elements', () => {
    mount(
      '<h1 id="a" data-edit-file="src/Hero.tsx" data-edit-line="12" data-edit-col="4">A</h1>' +
      '<h2 id="b" data-edit-file="src/Hero.tsx" data-edit-line="13" data-edit-col="4">B</h2>'
    );
    expect(editKey(document.getElementById('a'))).not.toBe(
      editKey(document.getElementById('b'))
    );
  });
});

describe('findEditableElements', () => {
  it('prefers annotated elements', () => {
    mount('<h1 data-editable="true">A</h1><p>not annotated</p>');
    const { elements, autoDetected } = findEditableElements(document);
    expect(elements).toHaveLength(1);
    expect(autoDetected).toBe(false);
  });

  it('falls back to auto-detection', () => {
    mount('<h1>A</h1><p>B</p>');
    const { elements, autoDetected } = findEditableElements(document);
    expect(elements.length).toBeGreaterThanOrEqual(2);
    expect(autoDetected).toBe(true);
  });

  it('excludes our own UI', () => {
    mount('<h1 data-editable="true" id="ours">Toolbar</h1><h2 data-editable="true">Page</h2>');
    const { elements } = findEditableElements(document, (el) => el.id === 'ours');
    expect(elements).toHaveLength(1);
    expect(elements[0].tagName).toBe('H2');
  });

  it('skips elements with no direct text when auto-detecting', () => {
    mount('<div><img src="a.png"></div><p>Real text</p>');
    const { elements } = findEditableElements(document);
    expect(elements.every((el) => el.textContent.trim())).toBe(true);
  });
});

describe('editableAncestors', () => {
  const isEditable = (el) => el.hasAttribute?.('data-editable');

  it('returns the chain outermost first', () => {
    mount('<div data-editable="true" id="outer">Hi <span data-editable="true" id="inner">there</span></div>');
    const chain = editableAncestors(document.getElementById('inner'), isEditable);
    expect(chain.map((n) => n.id)).toEqual(['outer', 'inner']);
  });

  it('returns just the element when nothing above is editable', () => {
    mount('<div><span data-editable="true" id="inner">x</span></div>');
    const chain = editableAncestors(document.getElementById('inner'), isEditable);
    expect(chain.map((n) => n.id)).toEqual(['inner']);
  });
});

describe('describeElement', () => {
  it('summarises tag and text', () => {
    mount('<h1 id="a">Build things</h1>');
    expect(describeElement(document.getElementById('a'))).toBe('h1 · Build things');
  });

  it('truncates long text', () => {
    mount(`<p id="a">${'x'.repeat(80)}</p>`);
    expect(describeElement(document.getElementById('a'))).toMatch(/…$/);
  });

  it('collapses whitespace', () => {
    mount('<p id="a">\n  Build   things\n</p>');
    expect(describeElement(document.getElementById('a'))).toBe('p · Build things');
  });

  it('falls back to the tag name when empty', () => {
    mount('<p id="a"></p>');
    expect(describeElement(document.getElementById('a'))).toBe('p');
  });
});

describe('observeDom', () => {
  it('reports a re-render after debouncing', async () => {
    mount('<div id="root"><h1>A</h1></div>');
    const onChange = vi.fn();
    const obs = observeDom(document.body, onChange, { debounceMs: 5 });

    document.getElementById('root').innerHTML = '<h1>B</h1>';
    await new Promise((r) => setTimeout(r, 40));

    expect(onChange).toHaveBeenCalledTimes(1);
    obs.disconnect();
  });

  it('coalesces a burst of mutations into one callback', async () => {
    mount('<div id="root"></div>');
    const onChange = vi.fn();
    const obs = observeDom(document.body, onChange, { debounceMs: 5 });

    const root = document.getElementById('root');
    for (let i = 0; i < 10; i++) root.appendChild(document.createElement('p'));
    await new Promise((r) => setTimeout(r, 40));

    expect(onChange).toHaveBeenCalledTimes(1);
    obs.disconnect();
  });

  it('ignores class changes, which are our own decorations', async () => {
    mount('<h1 id="a">A</h1>');
    const onChange = vi.fn();
    const obs = observeDom(document.body, onChange, { debounceMs: 5 });

    document.getElementById('a').classList.add('__iet-dirty');
    await new Promise((r) => setTimeout(r, 40));

    expect(onChange).not.toHaveBeenCalled();
    obs.disconnect();
  });

  it('stays quiet while paused', async () => {
    mount('<div id="root"></div>');
    const onChange = vi.fn();
    const obs = observeDom(document.body, onChange, { debounceMs: 5 });

    obs.pause();
    document.getElementById('root').appendChild(document.createElement('p'));
    await new Promise((r) => setTimeout(r, 40));
    expect(onChange).not.toHaveBeenCalled();

    obs.resume();
    obs.disconnect();
  });

  it('stops after disconnect', async () => {
    mount('<div id="root"></div>');
    const onChange = vi.fn();
    const obs = observeDom(document.body, onChange, { debounceMs: 5 });

    obs.disconnect();
    document.getElementById('root').appendChild(document.createElement('p'));
    await new Promise((r) => setTimeout(r, 40));

    expect(onChange).not.toHaveBeenCalled();
  });
});
