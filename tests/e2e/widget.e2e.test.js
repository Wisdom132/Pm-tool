import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

/**
 * The public widget, in a real browser, against the real API.
 *
 * Unit tests cover the pure parts and `test/feedback-public.sh` covers the
 * endpoint. Neither proves the thing a visitor actually does works: that the
 * script boots inside a shadow root on a page it knows nothing about, that
 * the picker can select an element the page owns, and that what comes out
 * the other end carries the source file the build stamped on it.
 *
 * The page is served from `localhost`, and a site is registered for that
 * hostname — because the API refuses a page URL that is not on the site's
 * own hostname, which is exactly the check that would otherwise go untested.
 *
 *   npm run dev:api        # in apps/api
 *   npm run build:widget
 *   npm run test:e2e
 */

const API = process.env.API_URL ?? 'http://localhost:3333/api';
const API_LOG = process.env.API_LOG ?? '/tmp/ie-api.log';
const PORT = 4347;

/**
 * A two-label hostname, because the site registry refuses a single-label one
 * — `localhost` alone is not a site anybody can own, and that rule is
 * right. Chromium resolves any `*.localhost` name to loopback, so this needs
 * no hosts-file entry.
 */
const HOSTNAME = 'acme.localhost';
const PAGE = `http://${HOSTNAME}:${PORT}/`;

let browser;
let page;
let server;
let available = false;
let widgetSource = '';
let db = '';

/** The page under test: annotated markup, and the embed tag. */
const HTML = `<!doctype html>
<html><head><title>Acme</title></head>
<body>
  <main data-edit-file="src/pages/Pricing.vue" data-edit-line="1">
    <h1 id="headline" data-edit-file="src/pages/Pricing.vue" data-edit-line="12"
        data-editable="true">Simple pricing</h1>
    <p id="price" data-edit-file="src/pages/Pricing.vue" data-edit-line="18"
       data-editable="true">£19 a month</p>
    <img id="shot" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="A screenshot">
  </main>
  <script src="/widget.js" data-api="${API}"></script>
</body></html>`;

function sql(query) {
  return execFileSync('psql', [db, '-At', '-c', query], { encoding: 'utf8' }).trim();
}

beforeAll(async () => {
  try {
    const probe = await fetch(`${API}/auth/me`);
    // 401 means it is running and refusing us, which is all we need.
    available = probe.status === 401 || probe.ok;
  } catch {
    available = false;
  }

  try {
    widgetSource = await readFile(
      new URL('../../widget/dist/widget.js', import.meta.url),
      'utf8',
    );
  } catch {
    available = false;
  }

  if (!available) return;

  const env = await readFile(
    new URL('../../apps/api/.env', import.meta.url),
    'utf8',
  );
  db = /^DATABASE_URL="?([^"\n?]+)/m.exec(env)?.[1] ?? '';
  if (!db) {
    available = false;
    return;
  }

  // ── a site for `localhost`, verified, widget on ──
  const stamp = Date.now();
  const email = `widget-e2e-${stamp}@example.test`;

  await fetch(`${API}/auth/request-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  const log = await readFile(API_LOG, 'utf8');
  const token = [...log.matchAll(/verify\?token=([A-Za-z0-9_-]+)/g)].at(-1)?.[1];

  const verified = await fetch(`${API}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const session = /ie_session=([^;]+)/.exec(verified.headers.get('set-cookie') ?? '')?.[1];

  const me = await (
    await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${session}` } })
  ).json();
  const org = me.organisations[0].id;

  const connection = sql(
    `insert into connection (id, organisation_id, provider, account_login, external_id)
     values (gen_random_uuid(), '${org}', 'github', 'we2e${stamp}', 'we${stamp}') returning id`,
  ).split('\n')[0];

  const registered = await fetch(`${API}/sites`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session}`,
      'x-organisation-id': org,
    },
    body: JSON.stringify({
      name: 'Widget e2e',
      hostname: HOSTNAME,
      label: 'production',
      repository: `we2e${stamp}/site`,
      branch: 'main',
      connectionId: connection,
    }),
  });

  // Checked, not assumed. Ignoring this response is what hid an earlier
  // version of this test registering nothing at all: the hostname was
  // rejected, every request then 404'd, and the failure surfaced six steps
  // later as "the thank-you never appeared".
  if (!registered.ok) {
    throw new Error(
      `Could not register ${HOSTNAME}: ${registered.status} ${await registered.text()}`,
    );
  }

  // The two gates the widget needs, set directly: domain verification has no
  // endpoint yet (P2.5), and this test is not about how it gets set.
  sql(
    `update site set verified_at=now(), feedback_widget=true
     where id in (select site_id from site_environment
                  where organisation_id='${org}' and hostname='${HOSTNAME}')`,
  );

  // ── serve the page, with the built widget alongside it ──
  server = createServer((req, res) => {
    if (req.url?.startsWith('/widget.js')) {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end(widgetSource);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(HTML);
  });
  await new Promise((resolve) => server.listen(PORT, resolve));

  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
});

const maybe = (name, fn) =>
  it(name, async (ctx) => {
    if (!available) return ctx.skip();
    await fn();
  });

describe('the public widget on a real page', () => {
  maybe('boots and shows a launcher', async () => {
    await page.goto(PAGE);
    // Inside a shadow root. Playwright's CSS engine pierces an *open* root
    // automatically, which is why a plain descendant selector reaches it —
    // no `>>>`, which Playwright reads as a child combinator and which
    // therefore matched `.launcher` (a direct child of the root) while
    // silently missing everything nested deeper.
    const launcher = page.locator('#inline-edit-feedback .launcher');
    await launcher.waitFor({ timeout: 10_000 });
    expect(await launcher.textContent()).toContain('Feedback');
  });

  maybe('does not disturb the page it is on', async () => {
    // A widget that shifts the customer's layout is worse than no widget.
    expect(await page.locator('#headline').textContent()).toBe('Simple pricing');
    expect(await page.locator('#price').isVisible()).toBe(true);
  });

  maybe('opens a form', async () => {
    await page.locator('#inline-edit-feedback .launcher').click();
    await page.locator('#inline-edit-feedback .message').waitFor();
    expect(await page.locator('#inline-edit-feedback .send').isDisabled()).toBe(true);
  });

  maybe('will not send an empty comment', async () => {
    await page.locator('#inline-edit-feedback .message').fill('   ');
    // Whitespace is not something. The API refuses it too; this saves the
    // round trip and the error message.
    expect(await page.locator('#inline-edit-feedback .send').isDisabled()).toBe(true);
  });

  maybe('picks an element off the page and reads its annotation', async () => {
    await page.locator('#inline-edit-feedback .pick').click();
    await page.locator('#price').click();

    const target = page.locator('#inline-edit-feedback .target');
    await target.waitFor();

    const text = await target.textContent();
    // The whole promise of this tool: the comment knows which file to go to.
    expect(text).toContain('src/pages/Pricing.vue');
    expect(text).toContain('18');
  });

  maybe('sends the comment, and it arrives with its source line', async () => {
    const message = `e2e widget ${Date.now()}`;

    await page.locator('#inline-edit-feedback .message').fill(message);
    await page.locator('#inline-edit-feedback .name').fill('A Visitor');
    await page.locator('#inline-edit-feedback .send').click();

    // If it did not go through, the widget's own message is the most useful
    // thing to fail with — far better than "element never appeared".
    try {
      await page.locator('#inline-edit-feedback .thanks').waitFor({ timeout: 10_000 });
    } catch (err) {
      const shown = await page
        .locator('#inline-edit-feedback .status')
        .textContent()
        .catch(() => '(no status shown)');
      throw new Error(`The comment was not accepted. The widget said: ${shown}`);
    }

    const row = sql(
      `select source || '|' || coalesce(source_file,'-') || '|' ||
              coalesce(source_line::text,'-') || '|' || coalesce(author_name,'-') || '|' ||
              coalesce(element,'-')
       from feedback where message='${message}'`,
    );

    const [source, file, line, author, element] = row.split('|');
    expect(source).toBe('widget');
    expect(file).toBe('src/pages/Pricing.vue');
    expect(line).toBe('18');
    // Self-declared and stored as such — never matched to a user.
    expect(author).toBe('A Visitor');
    expect(element).toBeTruthy();

    const userId = sql(`select coalesce(author_user_id::text,'-') from feedback where message='${message}'`);
    expect(userId).toBe('-');
  });

  maybe('can pick an image, which is rarely annotated itself', async () => {
    await page.goto(PAGE);
    await page.locator('#inline-edit-feedback .launcher').click();
    await page.locator('#inline-edit-feedback .pick').click();
    await page.locator('#shot').click();

    const text = await page.locator('#inline-edit-feedback .target').textContent();
    // The <img> carries no annotation; the <main> around it does, and that
    // is still the right file.
    expect(text).toContain('src/pages/Pricing.vue');
    expect(text).toContain('A screenshot');
  });

  maybe('closes on Escape without sending', async () => {
    await page.locator('#inline-edit-feedback .message').fill('never sent');
    await page.keyboard.press('Escape');

    await page.locator('#inline-edit-feedback .launcher').waitFor();
    expect(sql("select count(*) from feedback where message='never sent'")).toBe('0');
  });

  maybe('does not load twice when the tag is included twice', async () => {
    // Scripts get included twice more often than anyone expects — a tag
    // manager plus a template. Two launchers would be the visible symptom.
    await page.goto(PAGE);
    await page.locator('#inline-edit-feedback .launcher').waitFor();
    await page.addScriptTag({ url: '/widget.js' });

    expect(await page.locator('#inline-edit-feedback').count()).toBe(1);
  });
});
