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
