// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  effectiveBackground,
  openEditorOverlay,
} from '../inline-edit-tool/extension/src/editor-overlay.js';

/**
 * The editing overlay.
 *
 * Typing happens in an overlay rather than in the page's own element, because
 * making a framework-managed node contentEditable loses the text on the next
 * re-render. The cost of that choice is that two copies of the same text now
 * exist, and every test below is a way they were visibly disagreeing: the
 * overlay sized differently from the element it stands in for, or the
 * original still showing through underneath it.
 */
const HIDDEN = '__iet-text-hidden';

/** happy-dom has no layout, so boxes are stated rather than measured. */
function withBox(el, { top = 0, left = 0, width = 0, height = 0 }) {
  el.getBoundingClientRect = () => ({
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  return el;
}

const noop = () => {};
let root;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
});

const mount = (html) => {
  document.body.insertAdjacentHTML('afterbegin', html);
  return document.body.firstElementChild;
};

describe('sizing', () => {
  it('takes the target’s width exactly, so the text wraps where it did', () => {
    // The regression. Only `min-width` was set, so the overlay grew to fit
    // its content: a long paragraph in a 560px column laid itself out across
    // the full 1560px viewport. The typed copy and the original then broke
    // into different lines and overlapped, and neither was readable.
    const target = withBox(mount('<p>a long paragraph of copy</p>'), {
      top: 40,
      left: 120,
      width: 560,
      height: 96,
    });

    const { element } = openEditorOverlay(target, root, {
      onCommit: noop,
      onCancel: noop,
    });

    expect(element.style.width).toBe('560px');
    expect(element.style.left).toBe('120px');
    expect(element.style.top).toBe('40px');
  });

  it('treats the height as a floor, not a cap', () => {
    // Typing a longer sentence has to be able to grow downwards; a fixed
    // height would clip it.
    const target = withBox(mount('<p>x</p>'), { width: 300, height: 20 });

    const { element } = openEditorOverlay(target, root, {
      onCommit: noop,
      onCancel: noop,
    });

    expect(element.style.minHeight).toBe('20px');
    expect(element.style.height).toBe('');
  });

  it('follows the target when the page scrolls', () => {
    const target = withBox(mount('<p>x</p>'), { top: 100, width: 200, height: 20 });
    const { element } = openEditorOverlay(target, root, {
      onCommit: noop,
      onCancel: noop,
    });
    expect(element.style.top).toBe('100px');

    withBox(target, { top: 10, width: 200, height: 20 });
    window.dispatchEvent(new Event('scroll'));

    expect(element.style.top).toBe('10px');
  });

  it('drops the padding when standing in for one run of text', () => {
    // A run is measured with a Range, whose box already excludes the
    // element's padding. Adding it back would shift the text off the words
    // it is replacing.
    const target = mount('<p style="padding: 20px">Hello <strong>world</strong></p>');
    withBox(target, { width: 400, height: 40 });

    const run = target.firstChild;
    const { element } = openEditorOverlay(target, root, {
      textNode: run,
      onCommit: noop,
      onCancel: noop,
    });

    expect(element.style.padding).toBe('0px');
  });
});

describe('hiding the original', () => {
  it('hides the element it is standing in for, and restores it', () => {
    // Without this the overlay relied on its own background colour covering
    // the original, which fails over an image, a gradient, or a colour on an
    // ancestor the walk cannot resolve.
    const target = withBox(mount('<p>hello</p>'), { width: 200, height: 20 });

    const overlay = openEditorOverlay(target, root, {
      onCommit: noop,
      onCancel: noop,
    });
    expect(target.classList.contains(HIDDEN)).toBe(true);

    overlay.destroy();
    expect(target.classList.contains(HIDDEN)).toBe(false);
  });

  it('reveals the text again after a commit', () => {
    // Leaving the page with permanently invisible text is far worse than the
    // overlap this fixes, so the restore has to survive both exits.
    const target = withBox(mount('<p>hello</p>'), { width: 200, height: 20 });
    let committed = null;

    const { element } = openEditorOverlay(target, root, {
      onCommit: (text) => {
        committed = text;
      },
      onCancel: noop,
    });
    element.textContent = 'goodbye';
    element.dispatchEvent(new Event('blur'));

    expect(committed).toBe('goodbye');
    expect(target.classList.contains(HIDDEN)).toBe(false);
  });

  it('reveals the text again after a cancel', () => {
    const target = withBox(mount('<p>hello</p>'), { width: 200, height: 20 });
    let cancelled = false;

    const { element } = openEditorOverlay(target, root, {
      onCommit: noop,
      onCancel: () => {
        cancelled = true;
      },
    });
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

    expect(cancelled).toBe(true);
    expect(target.classList.contains(HIDDEN)).toBe(false);
  });

  it('hides only the run being edited, not its siblings', () => {
    // Colouring the parent would inherit into every child, so editing
    // "Hello " in `Hello <strong>world</strong>` would blank out "world" as
    // well — text the overlay is not covering, so it would simply vanish.
    const target = mount('<p>Hello <strong>world</strong></p>');
    withBox(target, { width: 400, height: 20 });
    const run = target.firstChild;

    const overlay = openEditorOverlay(target, root, {
      textNode: run,
      onCommit: noop,
      onCancel: noop,
    });

    expect(target.classList.contains(HIDDEN)).toBe(false);
    expect(run.parentElement.classList.contains(HIDDEN)).toBe(true);
    expect(target.querySelector('strong').closest(`.${HIDDEN}`)).toBeNull();

    overlay.destroy();
    expect(target.querySelector(`.${HIDDEN}`)).toBeNull();
    expect(target.textContent).toBe('Hello world');
  });

  it('has already restored the DOM by the time onCommit runs', () => {
    // The regression this guards. Hiding a run reparents its text node into a
    // sleeve, and the commit handler identifies the run by looking through the
    // element's *direct* child text nodes. While the sleeve was still in place
    // that lookup missed, so the handler recorded the edit against an empty
    // original and the change was silently dropped on submit.
    //
    // Nothing about the editing state may outlive the editor.
    const target = mount('<p>Hello <strong>world</strong></p>');
    withBox(target, { width: 400, height: 20 });

    const directRuns = () =>
      [...target.childNodes].filter(
        (n) => n.nodeType === 3 && n.textContent.trim()
      );

    let runsAtCommit = null;
    let sleeveAtCommit = null;

    const { element } = openEditorOverlay(target, root, {
      textNode: target.firstChild,
      onCommit: () => {
        runsAtCommit = directRuns().map((n) => n.textContent);
        sleeveAtCommit = target.querySelector(`.${HIDDEN}`);
      },
      onCancel: noop,
    });
    element.dispatchEvent(new Event('blur'));

    expect(sleeveAtCommit).toBeNull();
    expect(runsAtCommit).toEqual(['Hello ']);
  });

  it('has already restored the DOM by the time onCancel runs', () => {
    const target = mount('<p>Hello <strong>world</strong></p>');
    withBox(target, { width: 400, height: 20 });

    let sleeveAtCancel;
    const { element } = openEditorOverlay(target, root, {
      textNode: target.firstChild,
      onCommit: noop,
      onCancel: () => {
        sleeveAtCancel = target.querySelector(`.${HIDDEN}`);
      },
    });
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

    expect(sleeveAtCancel).toBeNull();
  });

  it('commits the typed text, read before the overlay is torn down', () => {
    // Tearing down first must not cost the text — it has to be captured off
    // the overlay before it leaves the document.
    const target = withBox(mount('<p>old</p>'), { width: 200, height: 20 });
    let committed = null;

    const { element } = openEditorOverlay(target, root, {
      onCommit: (text) => {
        committed = text;
      },
      onCancel: noop,
    });
    element.textContent = 'new copy';
    element.dispatchEvent(new Event('blur'));

    expect(committed).toBe('new copy');
  });

  it('settles once, even though removing a focused overlay re-fires blur', () => {
    const target = withBox(mount('<p>old</p>'), { width: 200, height: 20 });
    let commits = 0;

    const { element } = openEditorOverlay(target, root, {
      onCommit: () => {
        commits += 1;
      },
      onCancel: noop,
    });
    element.dispatchEvent(new Event('blur'));
    element.dispatchEvent(new Event('blur'));

    expect(commits).toBe(1);
  });

  it('leaves the run rejoined, so a second edit sees the whole thing', () => {
    // Unwrapping leaves the text split across adjacent nodes unless it is
    // normalised, and the next edit would then open on a fragment.
    const target = mount('<p>Hello <strong>world</strong></p>');
    withBox(target, { width: 400, height: 20 });

    openEditorOverlay(target, root, {
      textNode: target.firstChild,
      onCommit: noop,
      onCancel: noop,
    }).destroy();

    expect(target.firstChild.nodeType).toBe(3);
    expect(target.firstChild.textContent).toBe('Hello ');
  });
});

describe('reading the target’s styles', () => {
  it('copies the real colour, not the hidden one', () => {
    // `getComputedStyle` returns a *live* object. Hiding the target before
    // reading it would hand the overlay the transparent value and nothing
    // would be visible while typing.
    const target = withBox(mount('<p style="color: rgb(10, 20, 30)">hi</p>'), {
      width: 200,
      height: 20,
    });

    const { element } = openEditorOverlay(target, root, {
      onCommit: noop,
      onCancel: noop,
    });

    expect(element.style.color).toBe('rgb(10, 20, 30)');
  });

  it('starts from the text already there', () => {
    const target = withBox(mount('<p>existing copy</p>'), { width: 200, height: 20 });
    const { element } = openEditorOverlay(target, root, {
      onCommit: noop,
      onCancel: noop,
    });

    expect(element.textContent).toBe('existing copy');
  });

  it('starts from just the run when given one', () => {
    const target = mount('<p>Hello <strong>world</strong></p>');
    withBox(target, { width: 400, height: 20 });

    const { element } = openEditorOverlay(target, root, {
      textNode: target.firstChild,
      onCommit: noop,
      onCancel: noop,
    });

    expect(element.textContent).toBe('Hello');
  });
});

describe('effectiveBackground', () => {
  const stub = (colors) => (el) => ({ backgroundColor: colors.get(el) ?? '' });

  it('walks up past transparent ancestors', () => {
    const target = mount('<section><div><p>x</p></div></section>');
    const p = target.querySelector('p');
    const colors = new Map([
      [p, 'rgba(0, 0, 0, 0)'],
      [target.querySelector('div'), 'transparent'],
      [target, 'rgb(17, 17, 17)'],
    ]);

    expect(effectiveBackground(p, stub(colors))).toBe('rgb(17, 17, 17)');
  });

  it('falls back to white rather than leaving it see-through', () => {
    const p = mount('<p>x</p>');
    expect(effectiveBackground(p, stub(new Map()))).toBe('#ffffff');
  });
});
