// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStructureBar } from '../inline-edit-tool/extension/src/ui/structure-bar.js';

/**
 * The bar opens on anything now — Structure is a whole-page tool — so what
 * happens on an element the codemod cannot reach has to be said up front.
 * Before this, four buttons each refused only after being pressed.
 */
describe('the structure bar on an unannotated element', () => {
  let bar;
  let onOp;

  beforeEach(() => {
    document.body.innerHTML = '';
    onOp = vi.fn();
    bar = createStructureBar({ onOp });
    document.body.appendChild(bar.element);
  });

  const buttons = () => [...bar.element.querySelectorAll('.__iet-struct-btn')];
  const note = () => bar.element.querySelector('.__iet-struct-note');

  function annotated() {
    const el = document.createElement('section');
    el.dataset.editFile = 'src/pages/index.jsx';
    el.dataset.editLine = '4';
    document.body.appendChild(el);
    return el;
  }

  function bare() {
    const el = document.createElement('section');
    document.body.appendChild(el);
    return el;
  }

  it('disables every operation and says why', () => {
    bar.show(bare());

    expect(buttons().every((b) => b.disabled)).toBe(true);
    expect(note().hidden).toBe(false);
    expect(note().textContent.toLowerCase()).toContain('annotation');
  });

  it('enables everything on an annotated element', () => {
    bar.show(annotated());

    expect(buttons().every((b) => !b.disabled)).toBe(true);
    expect(note().hidden).toBe(true);
  });

  it('recovers when re-shown for a different element', () => {
    // The bar is one reused node; state from the last element must not
    // leak into the next.
    bar.show(bare());
    bar.show(annotated());
    expect(buttons().every((b) => !b.disabled)).toBe(true);
    expect(note().hidden).toBe(true);

    bar.show(bare());
    expect(buttons().every((b) => b.disabled)).toBe(true);
  });

  it('a disabled button reports nothing even if clicked programmatically', () => {
    bar.show(bare());
    for (const b of buttons()) b.click();
    expect(onOp).not.toHaveBeenCalled();
  });
});
