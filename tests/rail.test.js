// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRail, createToast, TOOL } from '../inline-edit-tool/extension/src/ui/rail.js';
import { icon, ICON_NAMES } from '../inline-edit-tool/extension/src/ui/icons.js';
import {
  createLabelLayer,
  createInspectorCard,
} from '../inline-edit-tool/extension/src/ui/labels.js';

const button = (rail, id) => rail.element.querySelector(`[data-id="${id}"]`);

describe('icons', () => {
  it('renders an svg for every named icon', () => {
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.childNodes.length).toBeGreaterThan(0);
    }
  });

  it('scales to the requested size', () => {
    expect(icon('edit', 32).getAttribute('width')).toBe('32');
  });

  it('inherits colour from the button', () => {
    expect(icon('edit').getAttribute('stroke')).toBe('currentColor');
  });
});

describe('tool rail', () => {
  let rail;
  let onTool;
  let onAction;

  beforeEach(() => {
    onTool = vi.fn();
    onAction = vi.fn();
    rail = createRail({ onTool, onAction });
    document.body.innerHTML = '';
    document.body.appendChild(rail.element);
  });

  it('starts hidden with no tool active', () => {
    expect(rail.visible).toBe(false);
    expect(rail.activeTool).toBeNull();
  });

  it('shows and hides', () => {
    rail.show();
    expect(rail.visible).toBe(true);
    rail.hide();
    expect(rail.visible).toBe(false);
  });

  it('activates a tool on click', () => {
    button(rail, TOOL.EDIT).click();
    expect(rail.activeTool).toBe(TOOL.EDIT);
    expect(onTool).toHaveBeenCalledWith(TOOL.EDIT);
  });

  it('marks the active tool pressed', () => {
    button(rail, TOOL.EDIT).click();
    expect(button(rail, TOOL.EDIT).getAttribute('aria-pressed')).toBe('true');
    expect(button(rail, TOOL.INSPECT).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps exactly one tool active', () => {
    button(rail, TOOL.EDIT).click();
    button(rail, TOOL.INSPECT).click();
    expect(rail.activeTool).toBe(TOOL.INSPECT);
    expect(button(rail, TOOL.EDIT).getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles a tool off when clicked again', () => {
    button(rail, TOOL.EDIT).click();
    button(rail, TOOL.EDIT).click();
    expect(rail.activeTool).toBeNull();
    expect(onTool).toHaveBeenLastCalledWith(null);
  });

  it('deselects the active tool when hidden', () => {
    rail.show();
    button(rail, TOOL.EDIT).click();
    rail.hide();
    expect(rail.activeTool).toBeNull();
  });

  it('reports actions without becoming active', () => {
    button(rail, 'undo').disabled = false;
    button(rail, 'undo').click();
    expect(onAction).toHaveBeenCalledWith('undo');
    expect(rail.activeTool).toBeNull();
  });

  it('shows a count badge only when there are edits', () => {
    const badge = button(rail, 'changes').querySelector('.__iet-count');

    rail.setCount(0);
    expect(badge.hidden).toBe(true);
    expect(button(rail, 'submit').disabled).toBe(true);

    rail.setCount(3);
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('3');
    expect(button(rail, 'submit').disabled).toBe(false);
  });

  it('enables undo and redo from history state', () => {
    rail.setHistory({ canUndo: true, canRedo: false });
    expect(button(rail, 'undo').disabled).toBe(false);
    expect(button(rail, 'redo').disabled).toBe(true);
  });

  it('flips dock side', () => {
    expect(rail.side).toBe('left');
    rail.setSide('right');
    expect(rail.side).toBe('right');
    expect(rail.element.dataset.side).toBe('right');
  });

  it('treats an unknown side as left', () => {
    rail.setSide('sideways');
    expect(rail.side).toBe('left');
  });

  it('reports a flip from the brand button', () => {
    rail.element.querySelector('.__iet-brand').click();
    expect(onAction).toHaveBeenCalledWith('flip');
  });

  it('labels every control for screen readers', () => {
    for (const btn of rail.element.querySelectorAll('button')) {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    }
  });
});

describe('toast', () => {
  it('shows and auto-hides', async () => {
    const toast = createToast();
    toast.show('Saved', { duration: 20 });
    expect(toast.element.hidden).toBe(false);
    expect(toast.element.textContent).toBe('Saved');

    await new Promise((r) => setTimeout(r, 60));
    expect(toast.element.hidden).toBe(true);
  });

  it('carries a tone', () => {
    const toast = createToast();
    toast.show('Done', { tone: 'done', duration: 0 });
    expect(toast.element.dataset.tone).toBe('done');
  });

  it('stays up when duration is zero', async () => {
    const toast = createToast();
    toast.show('Persistent', { duration: 0 });
    await new Promise((r) => setTimeout(r, 40));
    expect(toast.element.hidden).toBe(false);
  });

  it('can be hidden early', () => {
    const toast = createToast();
    toast.show('Gone soon', { duration: 0 });
    toast.hide();
    expect(toast.element.hidden).toBe(true);
  });
});

describe('element label', () => {
  let labels;

  beforeEach(() => {
    labels = createLabelLayer();
    document.body.innerHTML = '';
    document.body.appendChild(labels.element);
  });

  const mount = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.firstElementChild;
  };

  it('names the tag and its classes', () => {
    const el = mount('<h1 class="title big">Hi</h1>');
    labels.show(el);
    expect(labels.element.querySelector('.__iet-label-tag').textContent).toBe(
      '<h1>.title.big'
    );
  });

  it('never shows our own decoration classes', () => {
    const el = mount('<h1 class="title __iet-editable __iet-hovered">Hi</h1>');
    labels.show(el);
    expect(labels.element.querySelector('.__iet-label-tag').textContent).toBe('<h1>.title');
  });

  it('shows the source file and line', () => {
    const el = mount('<h1 data-edit-file="src/components/Hero.tsx" data-edit-line="12">Hi</h1>');
    labels.show(el);
    expect(labels.element.querySelector('.__iet-label-src').textContent).toBe('Hero.tsx:12');
  });

  it('flags an element with no source map', () => {
    const el = mount('<h1>Hi</h1>');
    labels.show(el);
    const src = labels.element.querySelector('.__iet-label-src');
    expect(src.textContent).toBe('no source map');
    expect(src.dataset.unmapped).toBe('true');
  });

  it('surfaces a translation key', () => {
    const el = mount('<h1 data-edit-i18n-key="hero.title">Hi</h1>');
    labels.show(el);
    const flag = labels.element.querySelector('.__iet-label-flag');
    expect(flag.hidden).toBe(false);
    expect(flag.textContent).toContain('hero.title');
  });

  it('carries the state for colouring', () => {
    const el = mount('<h1>Hi</h1>');
    labels.show(el, { state: 'edited' });
    expect(labels.element.dataset.state).toBe('edited');
  });

  it('hides', () => {
    const el = mount('<h1>Hi</h1>');
    labels.show(el);
    labels.hide();
    expect(labels.element.hidden).toBe(true);
  });
});

describe('inspector card', () => {
  let inspector;

  beforeEach(() => {
    inspector = createInspectorCard();
    document.body.innerHTML = '';
    document.body.appendChild(inspector.element);
  });

  const mount = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.firstElementChild;
  };

  it('lists what the service will be told', () => {
    const el = mount(
      '<h1 data-edit-file="src/Hero.tsx" data-edit-line="12" data-edit-framework="react">Build things</h1>'
    );
    inspector.show(el);
    const text = inspector.element.textContent;
    expect(text).toContain('src/Hero.tsx');
    expect(text).toContain('react');
    expect(text).toContain('Build things');
  });

  it('omits rows it has no value for', () => {
    const el = mount('<h1 data-edit-file="src/Hero.tsx">Hi</h1>');
    inspector.show(el);
    expect(inspector.element.textContent).not.toContain('Framework');
  });

  it('warns when the element has no build annotation', () => {
    const el = mount('<h1>Hi</h1>');
    inspector.show(el);
    expect(inspector.element.querySelector('.__iet-inspector-note')).not.toBeNull();
  });

  it('does not warn when annotated', () => {
    const el = mount('<h1 data-edit-file="src/Hero.tsx" data-edit-line="1">Hi</h1>');
    inspector.show(el);
    expect(inspector.element.querySelector('.__iet-inspector-note')).toBeNull();
  });

  it('tracks visibility', () => {
    const el = mount('<h1>Hi</h1>');
    expect(inspector.visible).toBe(false);
    inspector.show(el);
    expect(inspector.visible).toBe(true);
    inspector.hide();
    expect(inspector.visible).toBe(false);
  });
});

describe('view toggles', () => {
  let rail;
  let onToggle;
  let onTool;

  beforeEach(() => {
    onTool = vi.fn();
    onToggle = vi.fn();
    rail = createRail({ onTool, onAction: vi.fn(), onToggle });
    document.body.innerHTML = '';
    document.body.appendChild(rail.element);
  });

  it('reports a toggle change', () => {
    button(rail, 'guides').click();
    expect(onToggle).toHaveBeenCalledWith('guides', true);
  });

  it('toggles back off', () => {
    button(rail, 'guides').click();
    button(rail, 'guides').click();
    expect(onToggle).toHaveBeenLastCalledWith('guides', false);
    expect(rail.isToggleOn('guides')).toBe(false);
  });

  it('does not disturb the active tool', () => {
    // A view option is not a mode: turning guides on must not stop the
    // pencil deciding what a click does.
    button(rail, TOOL.EDIT).click();
    button(rail, 'guides').click();
    expect(rail.activeTool).toBe(TOOL.EDIT);
    expect(button(rail, TOOL.EDIT).getAttribute('aria-pressed')).toBe('true');
  });

  it('is not cleared when a tool is switched', () => {
    rail.setToggle('guides', true);
    button(rail, TOOL.INSPECT).click();
    expect(rail.isToggleOn('guides')).toBe(true);
  });

  it('can be set without firing user intent twice', () => {
    rail.setToggle('guides', true);
    expect(rail.isToggleOn('guides')).toBe(true);
  });

  it('is marked as a toggle so it can be styled apart from a tool', () => {
    expect(button(rail, 'guides').dataset.toggle).toBe('true');
    expect(button(rail, TOOL.EDIT).dataset.toggle).toBeUndefined();
  });
});

// ============================================================
//  Controls that are on but cannot act
//
//  A view option is a stored preference, so it stays on across
//  pages and across tool changes. The failure it produced: with
//  no tool selected nothing tracks the pointer, so the guides
//  toggle sat lit and did nothing — which reads as "I turned it
//  on and it stopped working" rather than "it is waiting".
// ============================================================
describe('inert controls', () => {
  let rail;

  beforeEach(() => {
    document.body.innerHTML = '';
    rail = createRail({ onTool() {}, onAction() {}, onToggle() {} });
    document.body.append(rail.element);
  });

  const button = (id) => rail.element.querySelector(`[data-id="${id}"]`);

  it('marks a control inert without unsetting it', () => {
    // Switching the toggle off instead would lose a preference the person
    // deliberately set, and silently.
    rail.setToggle('guides', true, { silent: true });
    rail.setInert('guides', true, 'Pick a tool to hover with');

    expect(button('guides').dataset.inert).toBe('true');
    expect(button('guides').getAttribute('aria-pressed')).toBe('true');
  });

  it('explains itself in the tooltip while inert', () => {
    rail.setInert('guides', true, 'Pick a tool to hover with');
    expect(button('guides').querySelector('.__iet-tip-sub').textContent).toBe(
      'Pick a tool to hover with'
    );
  });

  it('puts the original hint back when it can act again', () => {
    const before = button('guides').querySelector('.__iet-tip-sub').textContent;

    rail.setInert('guides', true, 'Pick a tool to hover with');
    rail.setInert('guides', false);

    expect(button('guides').dataset.inert).toBeUndefined();
    expect(button('guides').querySelector('.__iet-tip-sub').textContent).toBe(before);
  });

  it('is safe on an id that does not exist', () => {
    expect(() => rail.setInert('nope', true, 'x')).not.toThrow();
  });
});
