// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { annotationOf, describe as describeElement, reasonFor } from '../widget/src/widget.js';
import { createPicker } from '../widget/src/picker.js';
import { decodedSize, screenshotSupported } from '../widget/src/capture.js';
import { panelMarkup } from '../widget/src/ui.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('annotationOf', () => {
  it('reads the annotation off the element itself', () => {
    document.body.innerHTML =
      '<h1 id="t" data-edit-file="src/Hero.vue" data-edit-line="14">Hi</h1>';

    expect(annotationOf(document.getElementById('t'))).toEqual({
      sourceFile: 'src/Hero.vue',
      sourceLine: 14,
    });
  });

  it('climbs to the nearest annotated ancestor', () => {
    // An image is rarely annotated itself, but the component around it is —
    // and that is still the right file. The same rule the extension uses.
    document.body.innerHTML =
      '<section data-edit-file="src/Hero.vue" data-edit-line="3"><img id="t" src="a.png"></section>';

    expect(annotationOf(document.getElementById('t')).sourceFile).toBe('src/Hero.vue');
  });

  it('is empty on an unannotated page', () => {
    // The common case on a site that has not added the build plugin. The
    // comment is still worth having, it just has no source link.
    document.body.innerHTML = '<p id="t">Hi</p>';

    expect(annotationOf(document.getElementById('t'))).toEqual({
      sourceFile: null,
      sourceLine: null,
    });
  });

  it('drops a line number that is not one', () => {
    // The attribute comes off a page we do not control.
    document.body.innerHTML =
      '<p id="t" data-edit-file="a.vue" data-edit-line="not-a-number">Hi</p>';

    expect(annotationOf(document.getElementById('t')).sourceLine).toBeNull();
  });

  it('drops a zero or negative line', () => {
    for (const line of ['0', '-4']) {
      document.body.innerHTML = `<p id="t" data-edit-file="a.vue" data-edit-line="${line}">Hi</p>`;
      expect(annotationOf(document.getElementById('t')).sourceLine, line).toBeNull();
    }
  });
});

describe('describe', () => {
  it('quotes the text, which is what the reporter recognises', () => {
    document.body.innerHTML = '<button id="t">Buy now</button>';
    expect(describeElement(document.getElementById('t'))).toBe('“Buy now”');
  });

  it('truncates a long run of text', () => {
    document.body.innerHTML = `<p id="t">${'x'.repeat(200)}</p>`;
    const label = describeElement(document.getElementById('t'));
    expect(label.length).toBeLessThan(50);
    expect(label).toContain('…');
  });

  it('collapses whitespace so a wrapped paragraph reads as one line', () => {
    document.body.innerHTML = '<p id="t">one\n  two\t three</p>';
    expect(describeElement(document.getElementById('t'))).toBe('“one two three”');
  });

  it('names an image by its alt text', () => {
    document.body.innerHTML = '<img id="t" src="a.png" alt="The product">';
    expect(describeElement(document.getElementById('t'))).toBe('image: The product');
  });

  it('falls back to the tag when there is nothing to quote', () => {
    document.body.innerHTML = '<img id="t" src="a.png">';
    expect(describeElement(document.getElementById('t'))).toBe('an image');

    document.body.innerHTML = '<div id="t"></div>';
    expect(describeElement(document.getElementById('t'))).toBe('<div>');
  });
});

describe('reasonFor', () => {
  it('does not tell a stranger why the site was refused', () => {
    // The API answers "not registered", "unverified" and "switched off"
    // identically on purpose. This must not be more specific than that.
    const message = reasonFor(404, {});
    expect(message).toMatch(/not currently accepting/i);
    expect(message).not.toMatch(/verif|registered|disabled/i);
  });

  it('explains a rate limit as something to retry', () => {
    expect(reasonFor(429, {})).toMatch(/try again/i);
  });

  it('surfaces the first validation message', () => {
    expect(reasonFor(400, { message: ['Say something.', 'And another thing.'] })).toBe(
      'Say something.',
    );
  });

  it('handles a validation message that is a plain string', () => {
    expect(reasonFor(400, { message: 'That page URL is not valid.' })).toBe(
      'That page URL is not valid.',
    );
  });

  it('has something to say about a status it has never seen', () => {
    expect(reasonFor(500, {})).toBeTruthy();
    expect(reasonFor(418, null)).toBeTruthy();
  });
});

describe('panelMarkup', () => {
  it('offers the screenshot button only where capture exists', () => {
    expect(panelMarkup({ canScreenshot: true, maxMessage: 5000 })).toContain('class="shot"');
    expect(panelMarkup({ canScreenshot: false, maxMessage: 5000 })).not.toContain('class="shot"');
  });

  it('warns that the browser will prompt', () => {
    // getDisplayMedia opens a picker. Somebody pressing the button should
    // not be surprised by it.
    expect(panelMarkup({ canScreenshot: true, maxMessage: 5000 })).toMatch(/ask which window/i);
  });

  it('caps the message at what the API accepts', () => {
    expect(panelMarkup({ canScreenshot: false, maxMessage: 5000 })).toContain('maxlength="5000"');
  });

  it('labels every input for a screen reader', () => {
    const markup = panelMarkup({ canScreenshot: true, maxMessage: 5000 });
    const inputs = markup.match(/<(input|textarea)\b[^>]*>/g) ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(input, input).toContain('aria-label');
  });

  it('says the name and email are optional', () => {
    // They are unverified and only used to follow up. Implying they are
    // required would cost comments from people who would rather stay
    // anonymous.
    expect(panelMarkup({ canScreenshot: false, maxMessage: 5000 })).toMatch(/optional/i);
  });
});

describe('createPicker', () => {
  /**
   * Click an element for real, rather than faking the event's path.
   *
   * An earlier version of this helper overrode `composedPath()` to report
   * the element under the pointer. That broke the test rather than the
   * code: happy-dom builds the propagation path *from* `composedPath`, so
   * a fake one that omitted `document` meant the picker's own capture-phase
   * listener was never reached at all. Dispatching on the element and
   * letting the DOM compute the path exercises what the browser does.
   */
  function clickOn(element) {
    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event;
  }

  function pressEscape() {
    document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  }

  beforeEach(() => {
    document.body.innerHTML = '<button id="target">Buy</button>';
  });

  it('reports what was clicked', () => {
    const onPick = vi.fn();
    const picker = createPicker({ onPick, onCancel: vi.fn() });
    picker.start();

    clickOn(document.getElementById('target'));

    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick.mock.calls[0][0].id).toBe('target');
  });

  it('stops the page from also receiving the click', () => {
    // Picking a link would otherwise navigate away, losing whatever the
    // visitor had typed.
    const picker = createPicker({ onPick: vi.fn(), onCancel: vi.fn() });
    picker.start();

    expect(clickOn(document.getElementById('target')).defaultPrevented).toBe(true);
  });

  it('skips the widget own UI', () => {
    document.body.innerHTML = '<div id="host"><button id="mine">Feedback</button></div>';
    const host = document.getElementById('host');

    const onPick = vi.fn();
    const picker = createPicker({
      onPick,
      onCancel: vi.fn(),
      ignore: (el) => el === host || host.contains(el),
    });
    picker.start();

    clickOn(document.getElementById('mine'));

    // Otherwise the first thing anybody picks is the feedback panel.
    expect(onPick).not.toHaveBeenCalled();
  });

  it('never picks documentElement or body', () => {
    const onPick = vi.fn();
    const picker = createPicker({ onPick, onCancel: vi.fn() });
    picker.start();

    clickOn(document.body);
    clickOn(document.documentElement);

    expect(onPick).not.toHaveBeenCalled();
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    const picker = createPicker({ onPick: vi.fn(), onCancel });
    picker.start();

    pressEscape();

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('removes its listeners and its outline when stopped', () => {
    const onPick = vi.fn();
    const picker = createPicker({ onPick, onCancel: vi.fn() });
    picker.start();
    picker.stop();

    clickOn(document.getElementById('target'));

    expect(onPick).not.toHaveBeenCalled();
    expect(document.querySelector('[data-inline-edit-picker]')).toBeNull();
    expect(document.documentElement.style.cursor).toBe('');
  });

  it('stops itself after a pick, so a second click does nothing', () => {
    const onPick = vi.fn();
    const picker = createPicker({ onPick, onCancel: vi.fn() });
    picker.start();

    clickOn(document.getElementById('target'));
    clickOn(document.getElementById('target'));

    expect(onPick).toHaveBeenCalledOnce();
  });

  it('can be stopped when it was never started', () => {
    expect(() => createPicker({ onPick: vi.fn(), onCancel: vi.fn() }).stop()).not.toThrow();
  });
});

describe('capture', () => {
  it('reports honestly whether a real capture is possible', () => {
    // There is no way for a plain page to screenshot itself. The widget says
    // so rather than shipping a DOM-rasteriser that draws an approximation.
    expect(screenshotSupported()).toBe(false);

    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: () => {} } });
    expect(screenshotSupported()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('measures decoded bytes, not the base64 length', () => {
    const bytes = Buffer.alloc(3000, 1);
    expect(decodedSize(`data:image/jpeg;base64,${bytes.toString('base64')}`)).toBe(3000);
  });

  it('is zero for a string that is not a data URL', () => {
    expect(decodedSize('nope')).toBe(0);
  });
});
