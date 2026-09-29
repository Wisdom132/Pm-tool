import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

/**
 * Every dashboard route, rendered in a real browser.
 *
 * This exists because a passing `ng build` does not prove much about
 * component structure: it confirms the templates parse, not that each one
 * resolved to the file it now lives in, and not that a component still finds
 * its styles after being moved. Only rendering does.
 *
 * It needs both servers running, so it is skipped rather than failed when
 * they are not — a unit-test run should not depend on a database.
 *
 *   npm run dev:api                 # in one terminal
 *   npm --prefix apps/dashboard start
 *   npm run test:e2e
 */

const APP = process.env.DASHBOARD_URL ?? 'http://localhost:4200';
const API_LOG = process.env.API_LOG ?? '/tmp/ie-api.log';

const ROUTES = [
  '/overview',
  '/sites',
  '/feedback',
  '/connections',
  '/integrations',
  '/people',
  '/teams',
  '/audit',
  '/settings',
  '/account',
];

let browser;
let page;
let available = false;

beforeAll(async () => {
  try {
    const probe = await fetch(`${APP}/api/health`);
    available = probe.ok;
  } catch {
    available = false;
  }
  if (!available) return;

  browser = await chromium.launch();
  page = await (await browser.newContext({ baseURL: APP })).newPage();

  // Sign in the way the dashboard does: request a link, then read the token
  // out of the API's own log, which is where the dev mailer writes it.
  const email = `e2e-${Date.now()}@example.test`;
  await page.request.post(`${APP}/api/auth/request-link`, { data: { email } });

  const log = await readFile(API_LOG, 'utf8');
  const tokens = [...log.matchAll(/verify\?token=([A-Za-z0-9_-]+)/g)];
  await page.request.post(`${APP}/api/auth/verify`, {
    data: { token: tokens.at(-1)[1] },
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

describe('dashboard routes', () => {
  for (const route of ROUTES) {
    it(`renders ${route}`, async () => {
      if (!available) {
        console.log(`  skipped: no dashboard at ${APP}`);
        return;
      }

      const errors = [];
      const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
      const onError = (e) => errors.push(`pageerror: ${e.message}`);
      page.on('console', onConsole);
      page.on('pageerror', onError);

      await page.goto(route, { waitUntil: 'networkidle' });
      const rendered = await page.locator('app-root').first().innerHTML();

      page.off('console', onConsole);
      page.off('pageerror', onError);

      // A missing favicon is not a broken screen.
      const real = errors.filter((e) => !/favicon/i.test(e));

      expect(real, `console errors on ${route}`).toEqual([]);
      // A component whose templateUrl did not resolve renders an empty host.
      expect(rendered.length, `${route} rendered almost nothing`).toBeGreaterThan(500);
    });
  }
});

/**
 * The invitation page, in each state a real link can be in.
 *
 * Worth its own block because it is the one screen reachable both signed in
 * and signed out, and because it was hard-coded for weeks — it rendered
 * "Heykara" and "Wisdom Ekpot" to anyone who opened it.
 */
describe('invitation links', () => {
  let token;
  let organisation;

  beforeAll(async () => {
    if (!available) return;

    // An admin invites somebody; the token comes from the dev mailer's log.
    const org = await page.request.get(`${APP}/api/auth/me`);
    const { organisations } = await org.json();
    organisation = organisations[0];

    await page.request.post(`${APP}/api/members/invitations`, {
      headers: { 'x-organisation-id': organisation.id },
      data: { email: `invited-${Date.now()}@example.test`, role: 'editor' },
    });

    const log = await readFile(API_LOG, 'utf8');
    token = [...log.matchAll(/invitations\/([A-Za-z0-9_-]+)/g)].at(-1)[1];
  }, 60_000);

  it('names the real organisation, not a hard-coded one', async () => {
    if (!available) return;

    // A fresh context: no cookie, which is how an invitee arrives.
    const anonymous = await browser.newContext({ baseURL: APP });
    const fresh = await anonymous.newPage();
    await fresh.goto(`/invitations/${token}`, { waitUntil: 'networkidle' });

    const text = await fresh.locator('app-root').innerText();
    expect(text).toContain(organisation.name);
    expect(text).not.toContain('Heykara');
    expect(text).not.toContain('Wisdom Ekpot');
    // Signed out, the only way forward is a link to the invited address.
    expect(text.toLowerCase()).toContain('sign-in link');

    await anonymous.close();
  });

  it('refuses to let the wrong account accept', async () => {
    if (!available) return;

    // This page's session belongs to the inviter, not the invitee.
    await page.goto(`/invitations/${token}`, { waitUntil: 'networkidle' });
    const text = await page.locator('app-root').innerText();
    expect(text).toMatch(/signed in as/i);
    expect(text).not.toMatch(/Accept invitation/);
  });

  it('is reachable while signed in, rather than bouncing to the overview', async () => {
    if (!available) return;

    // Regression: the auth layout had `requireNoSession`, which redirected
    // away the one person who could accept.
    await page.goto(`/invitations/${token}`, { waitUntil: 'networkidle' });
    expect(new URL(page.url()).pathname).toBe(`/invitations/${token}`);
  });

  it('still honours the old /invite/:token shape', async () => {
    if (!available) return;

    // Invitations live 14 days, so links in the old shape may be in an inbox.
    await page.goto(`/invite/${token}`, { waitUntil: 'networkidle' });
    expect(new URL(page.url()).pathname).toBe(`/invitations/${token}`);
  });
});
