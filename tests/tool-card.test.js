// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { CARDS, createToolCard } from '../inline-edit-tool/extension/src/ui/tool-card.js';
import { TOOL } from '../inline-edit-tool/extension/src/ui/rail.js';

/**
 * The gesture cards. Two promises worth pinning:
 *
 * - every tool in the rail has a card, so no tool is ever selected into
 *   silence;
 * - the cards say the quiet parts out loud — the alt-click source editor
 *   existed for months with nothing on screen admitting it.
 */
describe('CARDS', () => {
  it('covers every tool in the rail', () => {
    for (const id of Object.values(TOOL)) {
      expect(CARDS[id], `no card for ${id}`).toBeTruthy();
    }
  });

  it('advertises the source editor from every tool that supports it', () => {
    // ⌥-click opens the source whatever tool is active — the gesture is the
    // mode. Comment is the exception: it is for people who cannot or should
    // not open an editor at all.
    for (const id of [TOOL.INSPECT, TOOL.EDIT, TOOL.PROPERTIES, TOOL.STRUCTURE]) {
      const rows = CARDS[id].rows.map(([what]) => what.toLowerCase());
      expect(rows.some((w) => w.includes('source editor')), id).toBe(true);
    }
  });

  it('shows a key that the keyboard handler actually binds', () => {
    // A shortcut badge for a key that does nothing teaches people to stop
    // believing the cards. The handler binds i/e/p/r/c.
    const bound = { inspect: 'I', edit: 'E', properties: 'P', structure: 'R', comment: 'C' };
    for (const [id, key] of Object.entries(bound)) {
      expect(CARDS[id].key, id).toBe(key);
    }
  });

  it('tells Inspect users how to measure', () => {
    const rows = CARDS.inspect.rows.map(([what]) => what.toLowerCase());
    expect(rows.some((w) => w.includes('measure'))).toBe(true);
  });

  it('leads with the primary gesture, not the escape hatch', () => {
    for (const [id, spec] of Object.entries(CARDS)) {
      const first = spec.rows[0][1].toLowerCase();
      expect(first.includes('esc'), `${id} leads with escape`).toBe(false);
    }
  });
});

describe('the card', () => {
  it('renders the tool name, key and every gesture row', () => {
    const card = createToolCard();
    document.body.appendChild(card.element);

    card.show('inspect');

    expect(card.visible).toBe(true);
    expect(card.element.textContent).toContain('Inspect');
    expect(card.element.querySelector('kbd').textContent).toBe('I');
    expect(card.element.querySelectorAll('dt')).toHaveLength(CARDS.inspect.rows.length);
  });

  it('replaces its content when the tool changes, never stacking', () => {
    const card = createToolCard();
    document.body.appendChild(card.element);

    card.show('inspect');
    card.show('edit');

    expect(card.element.textContent).toContain('Edit text');
    expect(card.element.textContent).not.toContain('Inspect');
    expect(card.element.querySelectorAll('kbd')).toHaveLength(1);
  });

  it('hides on an unknown tool rather than showing an empty box', () => {
    const card = createToolCard();
    card.show('inspect');
    card.show('not-a-tool');
    expect(card.visible).toBe(false);
  });

  it('mirrors the rail side', () => {
    const card = createToolCard();
    card.setSide('right');
    expect(card.element.dataset.side).toBe('right');
    card.setSide('left');
    expect(card.element.dataset.side).toBe('left');
    // Anything else falls back to left rather than an unstyled state.
    card.setSide('sideways');
    expect(card.element.dataset.side).toBe('left');
  });

  it('hides and can be shown again', () => {
    const card = createToolCard();
    card.show('edit');
    card.hide();
    expect(card.visible).toBe(false);
    card.show('edit');
    expect(card.visible).toBe(true);
  });
});
