// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDesignPanel } from '../inline-edit-tool/extension/src/ui/design-panel.js';

/**
 * The design panel.
 *
 * Every change here becomes a line in a pull request, which is what separates
 * it from VisBug's version and what most of these tests are about: a class
 * that does nothing on the page is not a harmless no-op, it is a change a
 * reviewer has to read and then puzzle over.
 */

/** The panel refuses to work on a page that does not use utility classes. */
function makeUtilityPage() {
  document.body.innerHTML = `
    <div class="p-4 text-lg flex gap-2"></div>
    <div class="m-2 font-bold rounded"></div>
  `;
}

/** happy-dom computes no layout, so display is stated per element. */
function withDisplay(el, display) {
  el.style.display = display;
  return el;
}

const el = (className = '', display) => {
  const node = document.createElement('div');
  node.className = className;
  if (display) withDisplay(node, display);
  document.body.appendChild(node);
  return node;
};

let onChange;
let panel;

beforeEach(() => {
  document.body.innerHTML = '';
  makeUtilityPage();
  onChange = vi.fn();
  panel = createDesignPanel({ onChange });
  document.body.appendChild(panel.element);
});

const rowValue = (id) =>
  panel.element.querySelector(`[data-row="${id}"] .__iet-design-value`)?.textContent;

const row = (id) => panel.element.querySelector(`[data-row="${id}"]`);

describe('flex alignment', () => {
  it('steps justify on a flex container and records the class change', () => {
    const target = el('p-4', 'flex');
    panel.show(target);

    panel.applyTo(target, 1); // focused row is the first one — move to justify
    onChange.mockClear();

    // Drive the row directly rather than relying on focus order.
    panel.element
      .querySelector('[data-row="justifyContent"] .__iet-design-step:last-child')
      .click();

    expect(target.className).toContain('justify-center');
    expect(onChange).toHaveBeenCalled();
    const change = onChange.mock.calls.at(-1)[0];
    expect(change.attribute).toBe('class');
    expect(change.newValue).toContain('justify-center');
  });

  it('refuses to write an alignment class onto a non-flex element', () => {
    // The whole reason this guard exists. VisBug force-sets `display: flex`
    // on the element instead; here that would arrive in the pull request as a
    // layout change nobody asked for, as a side effect of an arrow key.
    const target = el('p-4', 'block');
    panel.show(target);

    panel.element
      .querySelector('[data-row="justifyContent"] .__iet-design-step:last-child')
      .click();

    expect(target.className).not.toContain('justify');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('explains why, rather than appearing to do nothing', () => {
    const target = el('p-4', 'block');
    panel.show(target);

    panel.element
      .querySelector('[data-row="justifyContent"] .__iet-design-step:last-child')
      .click();

    expect(rowValue('justifyContent')).toMatch(/needs a flex or grid container/);
  });

  it('dims the rows that cannot act, and says why in the title', () => {
    const target = el('p-4', 'block');
    panel.show(target);

    expect(row('justifyContent').dataset.inert).toBe('true');
    expect(row('alignItems').title).toMatch(/flex or grid/);
  });

  it('enables the alignment rows once the element is a flex container', () => {
    const target = el('p-4', 'flex');
    panel.show(target);

    expect(row('justifyContent').dataset.inert).toBeUndefined();
    expect(row('flexDirection').dataset.inert).toBeUndefined();
  });

  it('treats a grid container as alignable too', () => {
    const target = el('p-4', 'grid');
    panel.show(target);

    expect(row('justifyContent').dataset.inert).toBeUndefined();
  });

  it('counts a flex container the page styled itself, not just one with a class', () => {
    // An element is usually flex by way of the stylesheet. Requiring a `flex`
    // class would dim the row while looking straight at a flex row.
    const target = el('row', 'flex');
    panel.show(target);

    expect(row('justifyContent').dataset.inert).toBeUndefined();
  });

  it('keeps direction and wrap independent of each other', () => {
    const target = el('flex flex-row flex-wrap', 'flex');
    panel.show(target);

    panel.element
      .querySelector('[data-row="flexDirection"] .__iet-design-step:last-child')
      .click();

    expect(target.className).toContain('flex-col');
    expect(target.className).toContain('flex-wrap');
    expect(target.className).not.toContain('flex-row');
  });

  it('offers display, so an element can be made flex from here', () => {
    const target = el('p-4', 'block');
    panel.show(target);

    expect(row('display')).not.toBeNull();
    expect(row('display').dataset.inert).toBeUndefined();
  });
});

describe('refusing dead classes generally', () => {
  it('will not put an offset on a statically positioned element', () => {
    // `top-4` does nothing without a position, and the panel used to dim this
    // row while still letting the arrows write the class.
    const target = el('p-4', 'block');
    panel.show(target);

    panel.element.querySelector('[data-row="top"] .__iet-design-step:last-child').click();

    expect(target.className).not.toContain('top-');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('allows the offset once something is positioned', () => {
    const target = el('p-4 relative', 'block');
    panel.show(target);

    panel.element.querySelector('[data-row="top"] .__iet-design-step:last-child').click();

    expect(target.className).toMatch(/\btop-/);
    expect(onChange).toHaveBeenCalled();
  });

  it('skips the elements it cannot change in a multi-selection', () => {
    // Stepping across a selection must not add a dead class to each member
    // that happens not to be a flex container.
    const flex = el('p-4', 'flex');
    const block = el('p-4', 'block');
    panel.show(flex);

    // Point the arrows at the justify row.
    row('justifyContent').click();

    expect(panel.applyTo(flex, 1)).toBe(true);
    expect(panel.applyTo(block, 1)).toBe(false);
    expect(block.className).not.toContain('justify');
  });
});

describe('our own classes', () => {
  it('never writes editor decorations into the recorded value', () => {
    const target = el('p-4', 'flex');
    target.classList.add('__iet-editable', '__iet-hovered');
    panel.show(target);

    panel.element
      .querySelector('[data-row="justifyContent"] .__iet-design-step:last-child')
      .click();

    const change = onChange.mock.calls.at(-1)[0];
    expect(change.newValue).not.toContain('__iet');
    expect(change.originalValue).not.toContain('__iet');
    // But they stay on the element, or the page loses its decoration.
    expect(target.classList.contains('__iet-hovered')).toBe(true);
  });
});
