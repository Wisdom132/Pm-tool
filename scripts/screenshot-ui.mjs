#!/usr/bin/env node
/**
 * Render the preview page and capture the UI in several states.
 *
 * The chrome lives in a closed shadow root, so it cannot be inspected from
 * the page — screenshots are the only way to check how it actually looks.
 *
 * Usage: node scripts/screenshot-ui.mjs [outDir]
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(here, '../inline-edit-tool/extension');
const OUT_DIR = resolve(process.argv[2] || resolve(here, '../.ui-shots'));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = await new Promise((r) => {
  const s = createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    try {
      const body = await readFile(resolve(EXT_DIR, `.${path}`));
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'text/plain' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  s.listen(0, () => r(s));
});

const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 820 },
  deviceScaleFactor: 2,
});

const shot = (name) => page.screenshot({ path: `${OUT_DIR}/${name}.png` });

await page.goto(`${base}/preview.html`);
await page.waitForFunction(() => window.chrome?.runtime?.__dispatchToContent);

// 1. Rail visible, no tool selected — the page should be untouched.
await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'TOGGLE_TOOLBAR' }));
await page.waitForTimeout(300);
await shot('1-rail-idle');

// 2. Edit tool active, hovering a heading: label + outline + breadcrumb.
await page.evaluate(() =>
  chrome.runtime.__dispatchToContent({ type: 'SET_EDIT_MODE', enabled: true })
);
await page.hover('h1[data-edit-file="src/pages/index.jsx"]');
await page.waitForTimeout(350);
await shot('2-edit-hover');

// 3. Mid-edit: the overlay sitting over the element.
await page.click('h1[data-edit-file="src/pages/index.jsx"]');
await page.waitForTimeout(250);
await shot('3-editing');

// 4. Committed edit — dirty state and the rail's count badge.
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.type('Build things that matter');
await page.keyboard.press('Enter');
await page.waitForTimeout(350);
await shot('4-edited');

// 5. Inspect tool on an element.
await page.evaluate(() =>
  chrome.runtime.__dispatchToContent({ type: 'SET_TOOL', tool: 'inspect' })
);
await page.click('h3[data-edit-line="8"]');
await page.waitForTimeout(350);
await shot('5-inspect');

// 6. Tooltip — only appears on a real pointer hover, so drive the mouse.
await page.keyboard.press('Escape');
await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'SET_TOOL', tool: 'edit' }));
await page.waitForTimeout(200);
await page.mouse.move(38, 296); // Inspect tool
await page.waitForTimeout(450);
await page.screenshot({
  path: `${OUT_DIR}/6-tooltip.png`,
  clip: { x: 0, y: 230, width: 360, height: 200 },
});

// 7. The rail on its own, to check icon weight and spacing.
await page.mouse.move(640, 700);
await page.waitForTimeout(250);
await page.screenshot({
  path: `${OUT_DIR}/7-rail-detail.png`,
  clip: { x: 0, y: 225, width: 200, height: 360 },
});

// 8. Docked right — the rail must not cover the text being edited.
await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'SET_TOOL', tool: 'edit' }));
await page.mouse.move(640, 700);
await page.waitForTimeout(150);
await page.evaluate(() => {
  const brand = document.getElementById('__iet-root');
  return brand;
});
// Click the brand to flip sides (real click: it lives in a closed shadow root).
await page.mouse.click(38, 256);
await page.waitForTimeout(400);
await page.hover('h1[data-edit-file="src/pages/index.jsx"]');
await page.waitForTimeout(350);
await shot('8-docked-right');

// 9. Breadcrumb: hovering a nested editable offers its editable ancestors.
await page.mouse.click(38, 256); // dock back to the left
await page.waitForTimeout(250);
await page.evaluate(() => chrome.runtime.__dispatchToContent({ type: 'SET_TOOL', tool: 'edit' }));
await page.hover('.nested span');
await page.waitForTimeout(400);
await shot('9-breadcrumb');

// 10. i18n-backed copy is flagged in the label.
await page.hover('[data-edit-i18n-key]');
await page.waitForTimeout(400);
await shot('10-i18n-label');

// 11. Review panel. Last, because its backdrop covers everything.
await page.evaluate(() =>
  chrome.runtime.__dispatchToContent({ type: 'OPEN_SUBMIT_PANEL' })
);
await page.waitForTimeout(1200);
await shot('11-review-panel');

console.log(`screenshots written to ${OUT_DIR}`);

await browser.close();
server.close();
