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
  await page.waitForFunction(() => window.chrome?.runtime?.__dispatchToContent);
  // The toolbar lives in a closed shadow root, so drive it through messages.
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
