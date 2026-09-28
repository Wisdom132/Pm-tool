import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(here, '../../inline-edit-tool/extension');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

/**
 * Serve the extension directory.
 *
 * preview.html loads dist/content.js, so this exercises the shipped build —
 * the same code the browser runs, not a copy of it.
 */
function serve() {
  const server = createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    try {
      const body = await readFile(resolve(EXT_DIR, `.${path}`));
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'text/plain' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((r) => server.listen(0, () => r(server)));
}

let server;
let browser;
let page;
let baseUrl;

beforeAll(async () => {
  server = await serve();
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

beforeEach(async () => {
  page = await browser.newPage();
  await page.goto(`${baseUrl}/preview.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__IET_TEST__?.root);
  // The toolbar lives in a closed shadow root; the preview page opts into
  // exposing it so controls can be driven directly.
  await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'TOGGLE_TOOLBAR' }));
  await page.evaluate(() =>
    chrome.runtime.__dispatchToContent({ type: 'SET_EDIT_MODE', enabled: true })
  );
});

const heroSelector = 'h1[data-edit-file="src/pages/index.jsx"]';

/** Click an element and type a replacement into the editing overlay. */
async function editText(selector, text) {
  await page.click(selector);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/**
 * Playwright's auto-retrying matchers are not available under Vitest's
 * expect, so poll in the page instead of asserting once.
 */
async function expectText(selector, expected) {
  await page.waitForFunction(
    ([sel, want]) => document.querySelector(sel)?.innerText.trim() === want,
    [selector, expected],
    { timeout: 5000 }
  ).catch(async () => {
    const actual = await page.locator(selector).innerText();
    throw new Error(`expected ${selector} to read "${expected}", got "${actual.trim()}"`);
  });
}

async function expectClass(selector, className) {
  await page.waitForFunction(
    ([sel, cls]) => document.querySelector(sel)?.classList.contains(cls),
    [selector, className],
    { timeout: 5000 }
  ).catch(async () => {
    const actual = await page.locator(selector).getAttribute('class');
    throw new Error(`expected ${selector} to have .${className}, got "${actual}"`);
  });
}

const state = () =>
  page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'GET_EDIT_STATE' }));

const storedEdits = () =>
  page.evaluate(() => {
    const raw = localStorage.getItem('iet_local_editSession');
    return raw ? JSON.parse(raw).edits : [];
  });

describe('inline editing', () => {
  it('marks annotated elements editable', async () => {
    const count = await page.locator('.__iet-editable').count();
    expect(count).toBeGreaterThan(0);
  });

  it('keeps the UI out of the page DOM', async () => {
    // Everything is in a closed shadow root, so the page sees only the host.
    const toolbar = await page.locator('#__iet-toolbar').count();
    expect(toolbar).toBe(0);
    expect(await page.locator('#__iet-root').count()).toBe(1);
  });

  it('records an edit and updates the page', async () => {
    await editText(heroSelector, 'Build things that matter');

    await expectText(heroSelector, 'Build things that matter');
    expect((await state()).count).toBe(1);
  });

  it('marks the edited element dirty', async () => {
    await editText(heroSelector, 'Build things that matter');
    await expectClass(heroSelector, '__iet-dirty');
  });

  it('persists the edit to storage', async () => {
    await editText(heroSelector, 'Build things that matter');

    const edits = await storedEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      sourceFile: 'src/pages/index.jsx',
      sourceLine: 12,
      originalText: 'Build things that mater',
      newText: 'Build things that matter',
    });
  });

  it('restores the session after a reload', async () => {
    await editText(heroSelector, 'Build things that matter');
    await page.reload();
    await page.waitForFunction(() => window.chrome?.runtime?.__dispatchToContent);

    expect((await state()).count).toBe(1);
  });

  it('does not record a no-op edit', async () => {
    await editText(heroSelector, 'Build things that mater');
    expect((await state()).count).toBe(0);
  });

  it('abandons an edit on Escape', async () => {
    await page.click(heroSelector);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Discarded');
    await page.keyboard.press('Escape');

    expect((await state()).count).toBe(0);
    await expectText(heroSelector, 'Build things that mater');
  });
});

describe('surviving a re-render', () => {
  it('keeps the edited text when the DOM is replaced', async () => {
    // The whole point of the MutationObserver: a framework replacing markup
    // must not silently discard what the editor typed.
    await editText(heroSelector, 'Build things that matter');

    const cardHeading = 'h3[data-edit-line="8"]';
    await editText(cardHeading, 'Genuinely fast');
    await expectText(cardHeading, 'Genuinely fast');

    await page.click('#rerender');
    await page.waitForTimeout(400);

    // Assert both: this test used to edit the hero but only check the card
    // afterwards, which hid the fact that the demo's re-render button did
    // not cover the hero at all.
    await expectText(heroSelector, 'Build things that matter');
    await expectText(cardHeading, 'Genuinely fast');
    expect((await state()).count).toBe(2);
  });

  it('re-renders the whole content root, not one section', async () => {
    await editText(heroSelector, 'Build things that matter');
    await page.click('#rerender');
    await page.waitForTimeout(400);

    await expectText(heroSelector, 'Build things that matter');
    await expectClass(heroSelector, '__iet-dirty');
  });

  it('re-decorates replaced elements', async () => {
    await editText('h3[data-edit-line="8"]', 'Genuinely fast');
    await page.click('#rerender');
    await page.waitForTimeout(400);

    await expectClass('h3[data-edit-line="8"]', '__iet-dirty');
    await expectClass('h3[data-edit-line="16"]', '__iet-editable');
  });
});

describe('undo and redo', () => {
  it('undoes an edit and restores the text', async () => {
    await editText(heroSelector, 'Build things that matter');
    await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'UNDO' }));

    expect((await state()).count).toBe(0);
    await expectText(heroSelector, 'Build things that mater');
  });

  it('redoes it again', async () => {
    await editText(heroSelector, 'Build things that matter');
    await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'UNDO' }));
    await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'REDO' }));

    expect((await state()).count).toBe(1);
    await expectText(heroSelector, 'Build things that matter');
  });

  it('reports what is available', async () => {
    expect(await state()).toMatchObject({ canUndo: false, canRedo: false });
    await editText(heroSelector, 'Build things that matter');
    expect(await state()).toMatchObject({ canUndo: true, canRedo: false });
  });
});

describe('edit mode', () => {
  it('removes decorations when turned off', async () => {
    await page.evaluate(() =>
      chrome.runtime.__dispatchToContent({ type: 'SET_EDIT_MODE', enabled: false })
    );
    expect(await page.locator('.__iet-editable').count()).toBe(0);
  });

  it('keeps pending edits when turned off and on again', async () => {
    await editText(heroSelector, 'Build things that matter');

    await page.evaluate(() =>
      chrome.runtime.__dispatchToContent({ type: 'SET_EDIT_MODE', enabled: false })
    );
    await page.evaluate(() =>
      chrome.runtime.__dispatchToContent({ type: 'SET_EDIT_MODE', enabled: true })
    );

    expect((await state()).count).toBe(1);
    await expectText(heroSelector, 'Build things that matter');
  });
});

describe('tool model', () => {
  const setTool = (tool) =>
    page.evaluate((t) => chrome.runtime.__dispatchToContent({ type: 'SET_TOOL', tool: t }), tool);

  it('leaves the page untouched until a tool is picked', async () => {
    await setTool(null);
    expect(await page.locator('.__iet-editable').count()).toBe(0);
  });

  it('decorates the page when the edit tool is picked', async () => {
    await setTool('edit');
    expect(await page.locator('.__iet-editable').count()).toBeGreaterThan(0);
  });

  it('reports the active tool', async () => {
    await setTool('inspect');
    expect(await state()).toMatchObject({ tool: 'inspect', editMode: false });

    await setTool('edit');
    expect(await state()).toMatchObject({ tool: 'edit', editMode: true });
  });

  it('does not edit text while inspecting', async () => {
    await setTool('inspect');
    await page.click(heroSelector);
    await page.waitForTimeout(200);

    // No editing overlay, so typing goes nowhere and nothing is recorded.
    await page.keyboard.type('should not appear');
    expect((await state()).count).toBe(0);
    await expectText(heroSelector, 'Build things that mater');
  });

  it('switches tools with a single keystroke', async () => {
    await setTool(null);
    await page.keyboard.press('e');
    expect((await state()).tool).toBe('edit');
    await page.keyboard.press('i');
    expect((await state()).tool).toBe('inspect');
  });

  it('does not steal keystrokes while text is being edited', async () => {
    // "e" and "i" are tool shortcuts; typing them must not switch tools.
    await setTool('edit');
    await editText(heroSelector, 'There is time');

    expect((await state()).tool).toBe('edit');
    await expectText(heroSelector, 'There is time');
  });
});

describe('properties tool', () => {
  const LOGO = '#logo';

  beforeEach(async () => {
    await page.evaluate(() =>
      chrome.runtime.__dispatchToContent({ type: 'SET_TOOL', tool: 'properties' })
    );
    await page.click(LOGO);
    await page.waitForTimeout(200);
  });

  /** Drive a control inside the closed shadow root. */
  const setAttr = (label, value) =>
    page.evaluate(
      ([lbl, val]) => {
        const input = [...__IET_TEST__.root.querySelectorAll('.__iet-prop-row')]
          .find((r) => r.querySelector('.__iet-prop-label').textContent === lbl)
          ?.querySelector('input');
        if (!input) throw new Error(`no row labelled ${lbl}`);
        input.value = val;
        input.dispatchEvent(new Event('blur'));
      },
      [label, value]
    );

  const addClass = (name) =>
    page.evaluate((n) => {
      const input = __IET_TEST__.root.querySelector('.__iet-chip-input');
      input.value = n;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }, name);

  it('edits an attribute and applies it live', async () => {
    await setAttr('Alt text', 'Acme logo, redrawn');
    await page.waitForTimeout(200);

    expect(await page.locator(LOGO).getAttribute('alt')).toBe('Acme logo, redrawn');
    expect((await state()).count).toBe(1);
  });

  it('records the attribute name and source location', async () => {
    await setAttr('Alt text', 'Acme logo, redrawn');
    await page.waitForTimeout(200);

    const [edit] = await storedEdits();
    expect(edit).toMatchObject({
      attribute: 'alt',
      originalText: 'Acme Corp logo',
      newText: 'Acme logo, redrawn',
      sourceFile: 'src/pages/index.jsx',
    });
  });

  it('keeps text and attribute edits on one element separate', async () => {
    await setAttr('Alt text', 'One');
    await setAttr('Source', '/logo-v2.png');
    await page.waitForTimeout(250);

    const edits = await storedEdits();
    expect(edits).toHaveLength(2);
    expect(new Set(edits.map((e) => e.key)).size).toBe(2);
  });

  it('adds a class and applies it live', async () => {
    await addClass('ring-2');
    await page.waitForTimeout(200);

    expect(await page.locator(LOGO).getAttribute('class')).toContain('ring-2');
    const [edit] = await storedEdits();
    expect(edit.newText).toBe('hero-logo rounded shadow-sm ring-2');
  });

  it('never writes our decoration classes into the source', async () => {
    await addClass('ring-2');
    await page.waitForTimeout(200);

    const [edit] = await storedEdits();
    expect(edit.newText).not.toContain('__iet');
  });

  it('uses className for a React element', async () => {
    await addClass('ring-2');
    await page.waitForTimeout(200);
    expect((await storedEdits())[0].attribute).toBe('className');
  });

  it('removes a class', async () => {
    await page.evaluate(() => {
      const chip = [...__IET_TEST__.root.querySelectorAll('.__iet-chip')].find((c) =>
        c.textContent.startsWith('rounded')
      );
      chip.querySelector('.__iet-chip-remove').click();
    });
    await page.waitForTimeout(200);

    expect(await page.locator(LOGO).getAttribute('class')).not.toContain('rounded');
    expect((await storedEdits())[0].newText).toBe('hero-logo shadow-sm');
  });

  it('does not open the text editor', async () => {
    // The properties tool inspects and configures; it never starts typing.
    expect(await page.evaluate(() => !!__IET_TEST__.root.querySelector('.__iet-edit-overlay'))).toBe(
      false
    );
  });
});

describe('opening the toolbar', () => {
  // Regression: the toolbar used to open with no tool active, so hovering
  // highlighted nothing and the lit guides toggle advertised a feature that
  // could not fire. It read as broken.
  beforeEach(async () => {
    await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'SET_TOOL', tool: null }));
    await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'TOGGLE_TOOLBAR' })); // hide
    await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'TOGGLE_TOOLBAR' })); // show
    await page.waitForTimeout(150);
  });

  it('activates a tool straight away', async () => {
    expect((await state()).tool).toBe('inspect');
  });

  it('decorates the page straight away', async () => {
    expect(await page.locator('.__iet-editable').count()).toBeGreaterThan(0);
  });

  it('shows guides and a label on the first hover', async () => {
    await page.hover('h3[data-edit-line="24"]');
    await page.waitForTimeout(300);

    const visible = await page.evaluate(() => ({
      guides: !__IET_TEST__.root.querySelector('.__iet-guides').hidden,
      label: !__IET_TEST__.root.querySelector('.__iet-label').hidden,
    }));
    expect(visible).toEqual({ guides: true, label: true });
  });

  it('draws a guide on each edge of the hovered element', async () => {
    await page.hover('h3[data-edit-line="24"]');
    await page.waitForTimeout(300);

    const transforms = await page.evaluate(() =>
      [...__IET_TEST__.root.querySelectorAll('.__iet-guide')].map((g) => g.style.transform)
    );
    expect(transforms).toHaveLength(4);
    expect(transforms.every((t) => t.length > 0)).toBe(true);
  });
});

describe('responsive preview', () => {
  const toggle = () =>
    page.evaluate(() => __IET_TEST__.root.querySelector('[data-id="responsive"]').click());

  it('reveals the breakpoint bar', async () => {
    await toggle();
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(() => !__IET_TEST__.root.querySelector('#__iet-breakpoints').hidden)
    ).toBe(true);
  });

  it('offers a width for each breakpoint', async () => {
    await toggle();
    await page.waitForTimeout(250);
    const labels = await page.evaluate(() =>
      [...__IET_TEST__.root.querySelectorAll('.__iet-breakpoint')].map((b) => b.textContent)
    );
    expect(labels).toEqual(['Mobile', 'Tablet', 'Laptop', 'Desktop']);
  });

  it('marks the width the viewport is already at', async () => {
    await toggle();
    await page.waitForTimeout(250);
    const pressed = await page.evaluate(() =>
      [...__IET_TEST__.root.querySelectorAll('.__iet-breakpoint')]
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.textContent)
    );
    expect(pressed).toEqual(['Laptop']); // the 1280px test viewport
  });

  it('says what it did, so the bar is not missed', async () => {
    await toggle();
    await page.waitForTimeout(250);
    const toastText = await page.evaluate(
      () => __IET_TEST__.root.querySelector('#__iet-toast')?.textContent
    );
    expect(toastText).toMatch(/width/i);
  });

  it('hides again when switched off', async () => {
    await toggle();
    await page.waitForTimeout(200);
    await toggle();
    await page.waitForTimeout(200);
    expect(
      await page.evaluate(() => __IET_TEST__.root.querySelector('#__iet-breakpoints').hidden)
    ).toBe(true);
  });
});

describe('guides toggle', () => {
  const toggle = () =>
    page.evaluate(() => __IET_TEST__.root.querySelector('[data-id="guides"]').click());

  it('is on by default', async () => {
    expect(
      await page.evaluate(
        () => __IET_TEST__.root.querySelector('[data-id="guides"]').getAttribute('aria-pressed')
      )
    ).toBe('true');
  });

  it('stops drawing guides when switched off', async () => {
    await toggle();
    await page.waitForTimeout(200);
    await page.hover('h3[data-edit-line="24"]');
    await page.waitForTimeout(300);

    expect(
      await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-guides').hidden)
    ).toBe(true);
    // The label still works — only the lines were turned off.
    expect(
      await page.evaluate(() => !__IET_TEST__.root.querySelector('.__iet-label').hidden)
    ).toBe(true);
  });
});

describe('undo across every kind of edit', () => {
  // Regression: undo assumed every edit was a text edit. Undoing an
  // attribute change left the attribute untouched *and* wrote its value
  // into the element, destroying any children it had.
  const undo = () =>
    page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'UNDO' }));
  const setTool = (tool) =>
    page.evaluate((t) => chrome.runtime.__dispatchToContent({ type: 'SET_TOOL', tool: t }), tool);

  const addProbeLink = () =>
    page.evaluate(() => {
      document.querySelector('.nested p').insertAdjacentHTML(
        'beforeend',
        ' <a id="probe" href="/docs" data-editable="true" ' +
          'data-edit-file="src/pages/index.jsx" data-edit-line="40" ' +
          'data-edit-framework="react">Read <strong>the docs</strong></a>'
      );
    });

  const editAttr = (label, value) =>
    page.evaluate(
      ([lbl, val]) => {
        const input = [...__IET_TEST__.root.querySelectorAll('.__iet-prop-row')]
          .find((r) => r.querySelector('.__iet-prop-label').textContent === lbl)
          .querySelector('input');
        input.value = val;
        input.dispatchEvent(new Event('blur'));
      },
      [label, value]
    );

  it('restores an attribute', async () => {
    await addProbeLink();
    await setTool(null);
    await setTool('properties');
    await page.click('#probe');
    await page.waitForTimeout(200);

    await editAttr('Link', '/documentation');
    await page.waitForTimeout(200);
    await undo();
    await page.waitForTimeout(250);

    expect(await page.locator('#probe').getAttribute('href')).toBe('/docs');
  });

  it('does not destroy the element while undoing an attribute', async () => {
    await addProbeLink();
    await setTool(null);
    await setTool('properties');
    await page.click('#probe');
    await page.waitForTimeout(200);

    await editAttr('Link', '/documentation');
    await page.waitForTimeout(200);
    await undo();
    await page.waitForTimeout(250);

    expect(await page.locator('#probe strong').count()).toBe(1);
    expect(await page.locator('#probe').innerHTML()).toBe('Read <strong>the docs</strong>');
  });

  it('restores a class list without losing our decorations', async () => {
    await setTool('properties');
    await page.click('#logo');
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const input = __IET_TEST__.root.querySelector('.__iet-chip-input');
      input.value = 'ring-4';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await page.waitForTimeout(200);
    await undo();
    await page.waitForTimeout(250);

    const cls = await page.locator('#logo').getAttribute('class');
    expect(cls).not.toContain('ring-4');
    expect(cls).toContain('hero-logo');
    expect(cls).toContain('__iet-editable');
  });

  it('removes a duplicated element', async () => {
    await setTool('structure');
    await page.click('h3[data-edit-line="8"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => __IET_TEST__.root.querySelector('[data-op="duplicate"]').click());
    await page.waitForTimeout(250);
    expect(await page.locator('h3:text-is("Blazing fast")').count()).toBe(2);

    await undo();
    await page.waitForTimeout(300);
    expect(await page.locator('h3:text-is("Blazing fast")').count()).toBe(1);
  });

  it('unmarks an element queued for deletion', async () => {
    await setTool('structure');
    await page.click('h3[data-edit-line="16"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => __IET_TEST__.root.querySelector('[data-op="delete"]').click());
    await page.waitForTimeout(250);
    expect(await page.locator('.__iet-removed').count()).toBe(1);

    await undo();
    await page.waitForTimeout(300);
    expect(await page.locator('.__iet-removed').count()).toBe(0);
  });

  it('leaves a duplicated copy out of the editable set', async () => {
    // The copy has no source location of its own; treating it as editable
    // would collide with the original's annotation.
    await setTool('structure');
    await page.click('h3[data-edit-line="8"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => __IET_TEST__.root.querySelector('[data-op="duplicate"]').click());
    await page.waitForTimeout(250);

    expect(await page.locator('[data-iet-copy]').count()).toBe(1);
    expect(await page.locator('[data-iet-copy][data-editable]').count()).toBe(0);
  });
});

describe('structural ops the page cannot make', () => {
  const doOp = (op) =>
    page.evaluate(
      (o) => __IET_TEST__.root.querySelector(`.__iet-struct-btn[data-op="${o}"]`).click(),
      op
    );
  const toastText = () =>
    page.evaluate(() => __IET_TEST__.root.querySelector('#__iet-toast')?.textContent);
  const firstCard = async () =>
    (await page.locator('#feature-grid .card').first().allInnerTexts())[0].replace(
      /\s*\n\s*/g,
      ' | '
    );

  beforeEach(async () => {
    await page.evaluate(() =>
      chrome.runtime.__dispatchToContent({ type: 'SET_TOOL', tool: 'structure' })
    );
  });

  it('refuses to move an element that is already first', async () => {
    // It used to queue an edit the service would then reject, so the change
    // looked accepted and quietly never arrived.
    await page.click('h3[data-edit-line="8"]');
    await page.waitForTimeout(200);
    await doOp('move-up');
    await page.waitForTimeout(250);

    expect((await state()).count).toBe(0);
    expect(await toastText()).toMatch(/already the first/);
  });

  it('moves an element that does have a neighbour', async () => {
    const before = await firstCard();
    await page.click('h3[data-edit-line="8"]');
    await page.waitForTimeout(200);
    await doOp('move-down');
    await page.waitForTimeout(300);

    expect(await firstCard()).not.toBe(before);
    expect((await state()).count).toBe(1);
  });

  it('restores the order on undo', async () => {
    const before = await firstCard();
    await page.click('h3[data-edit-line="8"]');
    await page.waitForTimeout(200);
    await doOp('move-down');
    await page.waitForTimeout(250);

    await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'UNDO' }));
    await page.waitForTimeout(300);

    expect(await firstCard()).toBe(before);
    expect((await state()).count).toBe(0);
  });

  it('accumulates repeated nudges into one edit', async () => {
    // A list with three siblings, so there is room to move twice.
    await page.click('#steps li[data-edit-line="46"]');
    await page.waitForTimeout(200);
    await doOp('move-up');
    await page.waitForTimeout(200);
    await doOp('move-up');
    await page.waitForTimeout(250);

    const edits = await storedEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ op: 'move', moveBy: -2 });
  });

  it('clears the edit when nudged back to where it started', async () => {
    await page.click('#steps li[data-edit-line="46"]');
    await page.waitForTimeout(200);
    await doOp('move-up');
    await page.waitForTimeout(200);
    await doOp('move-down');
    await page.waitForTimeout(250);

    expect((await state()).count).toBe(0);
    expect(await toastText()).toMatch(/original position/);
  });

  it('refuses a delete while a move is queued', async () => {
    // Both rewrite overlapping ranges; the service can only drop one.
    await page.click('#steps li[data-edit-line="46"]');
    await page.waitForTimeout(200);
    await doOp('move-up');
    await page.waitForTimeout(200);
    await doOp('delete');
    await page.waitForTimeout(250);

    const edits = await storedEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0].op).toBe('move');
    expect(await toastText()).toMatch(/already queued/);
  });
});

describe('review panel', () => {
  beforeEach(async () => {
    await editText(heroSelector, 'Changed heading');
    await page.evaluate(() =>
      chrome.runtime.__dispatchToContent({ type: 'OPEN_SUBMIT_PANEL' })
    );
    await page.waitForTimeout(900);
  });

  it('opens with every action mounted', async () => {
    // Regression: the issue button was referenced in five places but never
    // created, so refreshSubmitState() threw a ReferenceError on each call
    // and observer mode had no route at all.
    const buttons = await page.evaluate(() =>
      [...__IET_TEST__.root.querySelectorAll('#__iet-panel-btns button')].map(
        (b) => b.textContent
      )
    );
    expect(buttons).toEqual(['Cancel', 'File as issue', 'Open Pull Request →']);
  });

  it('opens without throwing', async () => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.evaluate(() => __IET_TEST__.root.querySelector('#__iet-panel-cancel').click());
    await page.waitForTimeout(200);
    await page.evaluate(() =>
      chrome.runtime.__dispatchToContent({ type: 'OPEN_SUBMIT_PANEL' })
    );
    await page.waitForTimeout(700);

    expect(errors).toEqual([]);
  });

  it('shows the word-level diff', async () => {
    const marks = await page.evaluate(() =>
      [...__IET_TEST__.root.querySelectorAll('#__iet-edits-table mark')].map((m) => m.textContent)
    );
    expect(marks.length).toBeGreaterThan(0);
  });

  it('never promises the code search that was removed', async () => {
    // The panel kept advertising automatic source-file lookup long after
    // that behaviour was retired in favour of confirmable Locate.
    const text = await page.evaluate(
      () => __IET_TEST__.root.querySelector('#__iet-panel-card').textContent
    );
    expect(text).not.toMatch(/located automatically/i);
  });
});

// ============================================================
//  In-browser source editor
// ============================================================
describe('the source editor', () => {
  // The panel keeps every opened tab mounted, so a bare `.cm-line` would also
  // match the hidden panes. Selectors below are scoped to the visible one.

  /** Alt-click an annotated element and wait for CodeMirror to mount. */
  async function openSource(selector = heroSelector) {
    await page.click(selector, { modifiers: ['Alt'] });
    await page.waitForFunction(
      () => __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden]) .cm-content'),
      null,
      { timeout: 15_000 }
    );
  }

  const inPanel = (selector) =>
    page.evaluate((s) => __IET_TEST__.root.querySelector(s)?.textContent?.trim() ?? null, selector);

  /** Path of the tab currently being edited. */
  const activePath = () =>
    page.evaluate(
      () =>
        __IET_TEST__.root.querySelector('.__iet-source-tab[aria-selected="true"]')?.dataset.path ??
        null
    );

  const panelOpen = () =>
    page.evaluate(() => Boolean(__IET_TEST__.root.querySelector('#__iet-source-panel')));

  it('opens on alt-click whichever tool is active', async () => {
    await openSource();
    expect(await activePath()).toBe('src/pages/index.jsx');
  });

  it('loads CodeMirror only when asked', async () => {
    // The chunk is an order of magnitude larger than the content script, so
    // it must not arrive until an element's source is actually opened.
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));

    await page.click(heroSelector);
    await page.waitForTimeout(300);
    expect(requests.some((u) => u.includes('code-editor'))).toBe(false);

    await openSource();
    expect(requests.some((u) => u.includes('code-editor'))).toBe(true);
  });

  it('highlights the line the element was built from', async () => {
    await openSource();
    // The annotation says line 12; the highlight has to land on the h1 that
    // produced the element, not merely somewhere in the file.
    expect(await inPanel('.__iet-origin-line')).toContain('<h1>');
    expect(await inPanel('.__iet-source-meta')).toMatch(/^line 12 of \d+$/);
  });

  it('syntax highlights according to the file extension', async () => {
    await openSource();
    const tags = await page.evaluate(() =>
      [
        ...__IET_TEST__.root.querySelectorAll(
          '.__iet-source-editor:not([hidden]) .cm-content span[class^="ͼ"]'
        ),
      ].length
    );
    expect(tags).toBeGreaterThan(0);
  });

  it('cannot be staged until something changes', async () => {
    await openSource();
    const disabled = () =>
      page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-primary').disabled);

    expect(await disabled()).toBe(true);

    await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden]) .cm-content').focus());
    await page.keyboard.type('// changed');
    await page.waitForTimeout(200);

    expect(await disabled()).toBe(false);
    expect(await inPanel('.__iet-source-hint')).toBe('Unsaved changes');
  });

  it('does not let typed text reach the tool shortcuts', async () => {
    // Our shadow root is closed, so a document listener cannot see that the
    // editor has focus via composedPath — typing "edit" switched tools and
    // tore the panel down.
    const pressed = () =>
      page.evaluate(() =>
        [...__IET_TEST__.root.querySelectorAll('[data-id]')]
          .filter((b) => b.getAttribute('aria-pressed') === 'true')
          .map((b) => b.dataset.id)
          .sort()
      );

    await openSource();
    const before = await pressed();

    await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden]) .cm-content').focus());
    await page.keyboard.type('// edit inspect it');
    await page.waitForTimeout(200);

    expect(await panelOpen()).toBe(true);
    expect(await pressed()).toEqual(before);
    // The keystrokes went to the document, so they had better be in the file.
    expect(await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden]) .cm-content').textContent))
      .toContain('// edit inspect it');
  });

  it('stages the whole file, keyed by path', async () => {
    await openSource();
    await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden]) .cm-content').focus());
    await page.keyboard.type('// staged from the browser\n');
    await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-primary').click());
    await page.waitForTimeout(300);

    expect(await panelOpen()).toBe(false);

    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem('iet_local_editSession')).edits
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].kind).toBe('file');
    expect(stored[0].key).toBe('file:src/pages/index.jsx');
    expect(stored[0].sourceFile).toBe('src/pages/index.jsx');
    expect(stored[0].baseSha).toBeTruthy();
    expect(stored[0].fileContent).toContain('// staged from the browser');
  });

  it('discards without staging', async () => {
    await openSource();
    await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden]) .cm-content').focus());
    await page.keyboard.type('// thrown away');
    await page.evaluate(() =>
      [...__IET_TEST__.root.querySelectorAll('.__iet-source-btn')]
        .find((b) => b.textContent === 'Discard')
        .click()
    );
    await page.waitForTimeout(200);

    expect(await panelOpen()).toBe(false);
    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem('iet_local_editSession') || '{"edits":[]}').edits
    );
    expect(stored).toEqual([]);
  });

  it('closes on Escape', async () => {
    await openSource();
    await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden]) .cm-content').focus());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    expect(await panelOpen()).toBe(false);
  });

  it('shows up in the review panel as a whole file, not a text diff', async () => {
    await openSource();
    await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden]) .cm-content').focus());
    await page.keyboard.type('// one new line\n');
    await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-primary').click());
    await page.waitForTimeout(300);

    await page.evaluate(() => __IET_TEST__.root.querySelector('[data-id="submit"]').click());
    await page.waitForFunction(() => __IET_TEST__.root.querySelector('#__iet-edits-table'), null, {
      timeout: 10_000,
    });

    const row = await page.evaluate(() => {
      const cell = __IET_TEST__.root.querySelector('#__iet-edits-table td.__iet-whole-file');
      if (!cell) return null;
      return {
        text: cell.textContent,
        colSpan: cell.colSpan,
        path: cell.parentElement.cells[0].textContent,
        added: cell.querySelector('.__iet-lines-added')?.textContent ?? null,
      };
    });

    expect(row).not.toBeNull();
    // The full path, not just the basename: the change is to the file itself.
    expect(row.path).toBe('src/pages/index.jsx');
    expect(row.colSpan).toBe(2);
    expect(row.text).toContain('Edited in the browser');
    expect(row.added).toBe('+1');
    // The placeholder newText must never leak into the table as a diff.
    expect(row.text).not.toContain('edited index.jsx');
  });

  it('opens a different file for an element from a different component', async () => {
    // The demo served one canned file for every path, so every element
    // opened the same source and the feature looked broken.
    await openSource();
    const hero = await page.evaluate(() => ({
      path: __IET_TEST__.root.querySelector('.__iet-source-tab[aria-selected="true"]').dataset.path,
      first: __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden]) .cm-line').textContent,
      origin: __IET_TEST__.root
        .querySelector('.__iet-source-editor:not([hidden]) .__iet-origin-line')
        .textContent.trim(),
    }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await openSource('h3[data-edit-line="24"]');
    const card = await page.evaluate(() => ({
      path: __IET_TEST__.root.querySelector('.__iet-source-tab[aria-selected="true"]').dataset.path,
      first: __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden]) .cm-line').textContent,
      origin: __IET_TEST__.root
        .querySelector('.__iet-source-editor:not([hidden]) .__iet-origin-line')
        .textContent.trim(),
    }));

    expect(hero.path).toBe('src/pages/index.jsx');
    expect(card.path).toBe('src/components/Features.jsx');
    expect(card.first).not.toBe(hero.first);
    expect(hero.origin).toContain('<h1>Build things that mater</h1>');
    expect(card.origin).toContain('<h3>Scals with you</h3>');
  });

  it('highlights the annotated line in every annotated element', async () => {
    // Each element must land on its own line. A fixture whose line numbers
    // drift from the page's annotations points at the wrong code, which is
    // indistinguishable from a broken locator.
    const expected = {
      'h1[data-edit-line="12"]': '<h1>Build things that mater</h1>',
      'p[data-edit-line="15"]': 'The fastest way to ship high-quality products.',
      'h3[data-edit-line="8"]': '<h3>Blazing fast</h3>',
      'p[data-edit-line="17"]': 'Great DX out of the bocks.',
      'span[data-edit-line="32"]': 'getting started guide',
      'li[data-edit-line="46"]': '<li>Edit and open a PR</li>',
    };

    for (const [selector, line] of Object.entries(expected)) {
      await openSource(selector);
      const origin = await inPanel('.__iet-origin-line');
      expect(origin, `${selector} should open on ${JSON.stringify(line)}`).toContain(line);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }
  });

  // ── Live preview ───────────────────────────────────────
  /** Replace one whole line of the open document. */
  async function replaceLine(n, text) {
    await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden]) .cm-content').focus());
    await page.evaluate((lineNumber) => {
      const pane = __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden])');
      const line = [...pane.querySelectorAll('.cm-line')][lineNumber - 1];
      const range = document.createRange();
      range.selectNodeContents(line);
      const sel = __IET_TEST__.root.getSelection?.() ?? window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }, n);
    await page.keyboard.type(text);
    await page.waitForTimeout(500);
  }

  /**
   * Replace a phrase in the open document, the way a person selects words.
   *
   * Retyping a whole line that contains a tag does not work: the editor
   * auto-closes `<span ...>` as you type it, so a typed `</span>` lands twice.
   */
  async function replaceWords(from, to) {
    await page.evaluate(([oldText]) => {
      const pane = __IET_TEST__.root.querySelector('.__iet-source-editor:not([hidden])');
      const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.textContent.indexOf(oldText);
        if (i === -1) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + oldText.length);
        const sel = __IET_TEST__.root.getSelection?.() ?? window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      throw new Error(`"${oldText}" is not visible in the editor`);
    }, [from]);
    await page.keyboard.type(to);
    await page.waitForTimeout(500);
  }

  const discard = () =>
    page.evaluate(() =>
      [...__IET_TEST__.root.querySelectorAll('.__iet-source-btn')]
        .find((b) => b.textContent === 'Discard')
        .click()
    );

  it('shows a source edit on the page as it is typed', async () => {
    const heading = () =>
      page.evaluate(() => document.querySelector('h3[data-edit-line="8"]').textContent.trim());

    await openSource('h3[data-edit-line="8"]');
    expect(await heading()).toBe('Blazing fast');

    await replaceLine(8, '        <h3>Genuinely fast</h3>');
    expect(await heading()).toBe('Genuinely fast');
  });

  it('applies literal attributes without losing our decoration classes', async () => {
    const attrs = () =>
      page.evaluate(() => {
        const el = document.querySelector('h3[data-edit-line="8"]');
        return { class: el.getAttribute('class'), title: el.getAttribute('title') };
      });

    await openSource('h3[data-edit-line="8"]');
    await replaceLine(8, '        <h3 className="headline" title="hi">Blazing fast</h3>');

    const got = await attrs();
    expect(got.title).toBe('hi');
    expect(got.class).toContain('headline');
    // Losing these would undecorate the element and break every other tool.
    expect(got.class).toContain('__iet-editable');
  });

  it('leaves an element that has children of its own alone', async () => {
    // <p>Read our <span>guide</span> to ship...</p> — replacing the text would
    // delete the span, which is itself an annotated, editable element.
    await openSource('p[data-edit-line="31"]');
    await replaceLine(32, '          Read our <span className="link">the manual</span> now.');

    const span = await page.evaluate(
      () => document.querySelector('span[data-edit-line="32"]')?.textContent.trim()
    );
    expect(span).toBe('the manual');
  });

  it('puts the page back when the edit is discarded', async () => {
    const heading = () =>
      page.evaluate(() => {
        const el = document.querySelector('h3[data-edit-line="8"]');
        return { text: el.textContent.trim(), class: el.getAttribute('class') };
      });

    const before = await heading();
    await openSource('h3[data-edit-line="8"]');
    await replaceLine(8, '        <h3 className="headline">Genuinely fast</h3>');
    expect((await heading()).text).toBe('Genuinely fast');

    await discard();
    await page.waitForTimeout(400);

    const after = await heading();
    expect(after.text).toBe(before.text);
    expect(after.class).toBe(before.class);
  });

  it('keeps the preview once the change is staged', async () => {
    await openSource('h3[data-edit-line="8"]');
    await replaceLine(8, '        <h3>Genuinely fast</h3>');
    await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-primary').click());
    await page.waitForTimeout(400);

    expect(
      await page.evaluate(() => document.querySelector('h3[data-edit-line="8"]').textContent.trim())
    ).toBe('Genuinely fast');
  });

  it('survives a half-typed tag rather than clearing the page', async () => {
    const heading = () =>
      page.evaluate(() => document.querySelector('h3[data-edit-line="8"]').textContent.trim());

    await openSource('h3[data-edit-line="8"]');
    await replaceLine(8, '        <h3>Still here');
    // Unparseable, so the page keeps the last good state instead of blanking.
    expect(await heading()).not.toBe('');
  });

  describe('when the element already has an edit from another tool', () => {
    const heading = () =>
      page.evaluate(() => document.querySelector('h1[data-edit-line="12"]').textContent.trim());
    const storedEdits = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('iet_local_editSession') || '{"edits":[]}').edits
      );

    async function pencilEdit(text) {
      await editText('h1[data-edit-line="12"]', text);
      await page.waitForTimeout(250);
    }

    it('lets the source win while the panel is open', async () => {
      // A DOM write triggers the rescan, which re-applies pending element
      // edits — and used to put the old text straight back over the preview,
      // so typing in the editor appeared to do nothing.
      await pencilEdit('Build things that maters');
      expect(await heading()).toBe('Build things that maters');

      await openSource('h1[data-edit-line="12"]');
      await replaceLine(12, '        <h1>Build things that mater all the time</h1>');

      expect(await heading()).toBe('Build things that mater all the time');
    });

    it('supersedes that edit when the file is staged', async () => {
      // Otherwise the file commits first and the element codemod then runs on
      // top of it, quietly undoing what was typed in the editor.
      await pencilEdit('Build things that maters');
      await openSource('h1[data-edit-line="12"]');
      await replaceLine(12, '        <h1>Build things that mater all the time</h1>');
      await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-primary').click());
      await page.waitForTimeout(400);

      const edits = await storedEdits();
      expect(edits).toHaveLength(1);
      expect(edits[0].kind).toBe('file');
      expect(await heading()).toBe('Build things that mater all the time');
    });

    it('says so, rather than dropping the edit silently', async () => {
      await pencilEdit('Build things that maters');
      await openSource('h1[data-edit-line="12"]');
      await replaceLine(12, '        <h1>Build things that mater all the time</h1>');
      await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-primary').click());
      await page.waitForTimeout(400);

      const toast = await page.evaluate(
        () => __IET_TEST__.root.querySelector('#__iet-toast, .__iet-toast')?.textContent ?? ''
      );
      expect(toast).toContain('replaced 1 element edit');
    });

    it('keeps that edit if the source change is discarded', async () => {
      await pencilEdit('Build things that maters');
      await openSource('h1[data-edit-line="12"]');
      await replaceLine(12, '        <h1>Something else entirely</h1>');
      expect(await heading()).toBe('Something else entirely');

      await discard();
      await page.waitForTimeout(500);

      expect(await heading()).toBe('Build things that maters');
      const edits = await storedEdits();
      expect(edits).toHaveLength(1);
      expect(edits[0].kind).toBeUndefined();
    });
  });

  // ── Stylesheet tabs ────────────────────────────────────
  describe('the stylesheets a component imports', () => {
    const tabs = () =>
      page.evaluate(() =>
        [...__IET_TEST__.root.querySelectorAll('.__iet-source-tab')].map((b) => b.textContent)
      );

    const openTab = async (label) => {
      await page.evaluate((want) => {
        [...__IET_TEST__.root.querySelectorAll('.__iet-source-tab')]
          .find((b) => b.textContent === want)
          .click();
      }, label);
      await page.waitForTimeout(500);
    };

    const fontSize = () =>
      page.evaluate(
        () => getComputedStyle(document.querySelector('h1[data-edit-line="12"]')).fontSize
      );

    it('opens one tab per imported stylesheet', async () => {
      await openSource('h1[data-edit-line="12"]');
      expect(await tabs()).toEqual(['index.jsx', 'hero.css']);
    });

    it('applies a CSS edit to the page as it is typed', async () => {
      // CSS can be applied exactly, unlike markup: it is declarative, and the
      // browser already knows how to run it.
      await openSource('h1[data-edit-line="12"]');
      expect(await fontSize()).toBe('44px');

      await openTab('hero.css');
      const line = await page.evaluate(() =>
        [...__IET_TEST__.root.querySelectorAll('.__iet-source-editor:not([hidden]) .cm-line')]
          .findIndex((l) => l.textContent.includes('font-size: 44px')) + 1
      );
      await replaceLine(line, '  font-size: 20px;');

      expect(await fontSize()).toBe('20px');
    });

    it('marks the tab that changed, not all of them', async () => {
      await openSource('h1[data-edit-line="12"]');
      await openTab('hero.css');
      await replaceLine(1, '/* edited */');

      const dirty = await page.evaluate(() =>
        [...__IET_TEST__.root.querySelectorAll('.__iet-source-tab')]
          .filter((b) => b.classList.contains('__iet-tab-dirty'))
          .map((b) => b.textContent)
      );
      expect(dirty).toEqual(['hero.css']);
    });

    it('stages each edited file separately', async () => {
      await openSource('h1[data-edit-line="12"]');
      await replaceLine(12, '        <h1>Changed in the markup</h1>');
      await openTab('hero.css');
      await replaceLine(1, '/* changed in the stylesheet */');

      expect(await inPanel('.__iet-source-hint')).toBe('Unsaved changes in 2 files');

      await page.evaluate(() => __IET_TEST__.root.querySelector('.__iet-source-primary').click());
      await page.waitForTimeout(400);

      const edits = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('iet_local_editSession')).edits.map((e) => e.key).sort()
      );
      expect(edits).toEqual(['file:src/pages/hero.css', 'file:src/pages/index.jsx']);
    });

    it('reverts a CSS edit on discard', async () => {
      await openSource('h1[data-edit-line="12"]');
      await openTab('hero.css');
      const line = await page.evaluate(() =>
        [...__IET_TEST__.root.querySelectorAll('.__iet-source-editor:not([hidden]) .cm-line')]
          .findIndex((l) => l.textContent.includes('font-size: 44px')) + 1
      );
      await replaceLine(line, '  font-size: 20px;');
      expect(await fontSize()).toBe('20px');

      await discard();
      await page.waitForTimeout(400);
      expect(await fontSize()).toBe('44px');
    });

    it('says plainly when a component imports no stylesheet', async () => {
      // Features.jsx imports nothing, which is the normal case for Tailwind
      // and CSS-in-JS. An empty tab would read as a broken feature.
      await openSource('h3[data-edit-line="8"]');
      expect(await tabs()).toEqual(['Features.jsx', 'Styles']);

      await openTab('Styles');
      const note = await inPanel('.__iet-source-note');
      expect(note).toContain('No stylesheet imported');
      expect(note).toContain('Features.jsx');
    });
  });

  // ── Frameworks other than React ────────────────────────
  describe('a Vue single-file component', () => {
    const banner = 'h2[data-edit-line="3"]';
    const txt = (sel) => page.evaluate((s) => document.querySelector(s).textContent.trim(), sel);

    it('previews a template edit, using the HTML grammar', async () => {
      // The outline reader looked for JSXElement only, so this did nothing at
      // all on a .vue file — and did it silently.
      await openSource(banner);
      expect(await txt(banner)).toBe('Ship it on Friday');

      await replaceLine(3, '    <h2 class="banner-title">Ship it on Thursday</h2>');
      expect(await txt(banner)).toBe('Ship it on Thursday');
    });

    it('never writes template interpolation to the page', async () => {
      // `{{ deployCount }}` is a rendered value. Putting its source into the
      // DOM would replace the number with the expression that produced it.
      const counter = 'p[data-edit-line="5"]';
      await openSource(counter);
      await replaceLine(5, '    <p class="banner-count">{{ deployCount }} deploys this month</p>');

      expect(await txt(counter)).not.toContain('{{');
      expect(await txt(counter)).toBe('12 deploys this week');
    });

    it('previews the component\'s own <style> block', async () => {
      const size = () => page.evaluate(() => getComputedStyle(document.querySelector('h2[data-edit-line="3"]')).fontSize);

      await openSource(banner);
      expect(await size()).toBe('24px');

      const line = await page.evaluate(() =>
        [...__IET_TEST__.root.querySelectorAll('.__iet-source-editor:not([hidden]) .cm-line')]
          .findIndex((l) => l.textContent.includes('font-size: 19px')) + 1
      );
      await replaceLine(line, '  font-size: 34px;');

      expect(await size()).toBe('34px');
    });

    it('warns that scoped styles preview unscoped', async () => {
      await openSource(banner);
      const warn = await page.evaluate(() => {
        const w = __IET_TEST__.root.querySelector('.__iet-source-warn');
        return w.hidden ? null : w.textContent;
      });
      expect(warn).toBe('Scoped styles preview unscoped');
    });

    it('says the styles are in the file already open', async () => {
      await openSource(banner);
      await page.evaluate(() => {
        [...__IET_TEST__.root.querySelectorAll('.__iet-source-tab')]
          .find((b) => b.textContent === 'Styles')
          .click();
      });
      await page.waitForTimeout(300);

      const note = await inPanel('.__iet-source-note');
      expect(note).toContain('Styles are in this file');
      expect(note).toContain('Banner.vue');
    });
  });

  it('previews a run of text that sits beside another element', async () => {
    // `<p>Read our <span>getting started guide</span> to ship...</p>` — the
    // element cannot be replaced wholesale without destroying the span, so
    // each run of text is previewed on its own. This did nothing at all
    // until the outline started reporting runs.
    const paragraph = 'p[data-edit-line="31"]';
    const linkText = () =>
      page.evaluate(() => document.querySelector('span[data-edit-line="32"]').textContent.trim());
    const runs = () =>
      page.evaluate(() =>
        [...document.querySelector('p[data-edit-line="31"]').childNodes]
          .filter((n) => n.nodeType === 3 && n.textContent.trim())
          .map((n) => n.textContent.trim())
      );

    await openSource(paragraph);
    expect(await runs()).toEqual(['Read our', 'to ship your first change.']);

    await replaceWords('Read our', 'Read the');
    await replaceWords('to ship your first change.', 'before you ship.');

    expect(await runs()).toEqual(['Read the', 'before you ship.']);
    // The nested element is annotated in its own right and must survive.
    expect(await linkText()).toBe('getting started guide');
  });

  it('shields the page while it is open', async () => {
    // The backdrop is what stops a click meant for the editor from also
    // selecting whatever sits behind it.
    await openSource();
    await expect(
      page.click(heroSelector, { modifiers: ['Alt'], timeout: 1500 })
    ).rejects.toThrow(/intercepts pointer events|Timeout/i);

    expect(
      await page.evaluate(
        () => __IET_TEST__.root.querySelectorAll('#__iet-source-panel').length
      )
    ).toBe(1);
  });
});
