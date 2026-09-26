// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGuideLayer } from '../inline-edit-tool/extension/src/ui/guides.js';

describe('alignment guides', () => {
  let guides;
  let el;

  beforeEach(() => {
    guides = createGuideLayer();
    document.body.innerHTML = '';
    document.body.append(guides.element);

    el = document.createElement('h1');
    el.textContent = 'Hi';
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({
      top: 100, bottom: 140, left: 50, right: 300, width: 250, height: 40,
    });
  });

  const lines = () => guides.element.querySelectorAll('.__iet-guide');

  it('draws one line per edge', () => {
    expect(lines()).toHaveLength(4);
    expect(guides.element.querySelectorAll('.__iet-guide-h')).toHaveLength(2);
    expect(guides.element.querySelectorAll('.__iet-guide-v')).toHaveLength(2);
  });

  it('starts hidden', () => {
    expect(guides.element.hidden).toBe(true);
  });

  it('places lines on the element edges', () => {
    guides.show(el);
    const [top, bottom, left, right] = lines();
    expect(top.style.transform).toBe('translateY(100px)');
    expect(bottom.style.transform).toBe('translateY(140px)');
    expect(left.style.transform).toBe('translateX(50px)');
    expect(right.style.transform).toBe('translateX(300px)');
  });

  it('carries the state for colouring', () => {
    guides.show(el, 'selected');
    expect(guides.element.dataset.state).toBe('selected');
  });

  it('hides', () => {
    guides.show(el);
    guides.hide();
    expect(guides.element.hidden).toBe(true);
  });

  it('follows the element on reposition', () => {
    guides.show(el);
    el.getBoundingClientRect = () => ({ top: 10, bottom: 50, left: 5, right: 80 });
    guides.reposition(el);
    expect(lines()[0].style.transform).toBe('translateY(10px)');
  });

  it('does not reposition while hidden', () => {
    guides.show(el);
    guides.hide();
    el.getBoundingClientRect = () => ({ top: 999, bottom: 999, left: 999, right: 999 });
    guides.reposition(el);
    expect(lines()[0].style.transform).toBe('translateY(100px)');
  });

  it('stays away when disabled', () => {
    guides.setEnabled(false);
    guides.show(el);
    expect(guides.element.hidden).toBe(true);
  });

  it('hides immediately when disabled while visible', () => {
    guides.show(el);
    guides.setEnabled(false);
    expect(guides.element.hidden).toBe(true);
  });

  it('works again once re-enabled', () => {
    guides.setEnabled(false);
    guides.setEnabled(true);
    guides.show(el);
    expect(guides.element.hidden).toBe(false);
  });

  it('reports its enabled state', () => {
    expect(guides.enabled).toBe(true);
    guides.setEnabled(false);
    expect(guides.enabled).toBe(false);
  });

  it('ignores a missing element', () => {
    expect(() => guides.show(null)).not.toThrow();
    expect(guides.element.hidden).toBe(true);
  });
});
