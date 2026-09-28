import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const inlineEditNuxt = require('../annotation/nuxt/index.js');

// ============================================================
//  Nuxt module
//
//  Nuxt renders its HTML through Nitro, so Vite's
//  transformIndexHtml never runs — which is the hook the plain
//  Vite plugin uses to stamp build metadata and inject the
//  editor. On a real Nuxt site the annotations appeared and
//  nothing else did. This module is why that works.
// ============================================================

/** The parts of a Nuxt instance the module touches. */
function fakeNuxt({ dev = true } = {}) {
  return { options: { dev, app: { head: {} }, vite: {} } };
}

const DIST = '/tmp/does-not-need-to-exist';

let saved;

beforeEach(() => {
  saved = { ...process.env };
  process.env.INLINE_EDIT = '1';
});

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe('inlineEditNuxt', () => {
  it('registers the Vue annotation plugin', () => {
    const nuxt = fakeNuxt();
    inlineEditNuxt({}, nuxt);

    expect(nuxt.options.vite.plugins.map((p) => p.name)).toContain(
      'inline-edit-annotation-vue'
    );
  });

  it('stamps the build onto <html>', () => {
    // The Vite plugin does this from transformIndexHtml, which Nuxt never
    // calls — without it the extension cannot tell which repository or
    // branch the page was built from, and the source panel gives up.
    const nuxt = fakeNuxt();
    inlineEditNuxt({}, nuxt);

    const attrs = nuxt.options.app.head.htmlAttrs;
    expect(attrs['data-edit-repo']).toBeTruthy();
    expect(attrs['data-edit-branch']).toBeTruthy();
  });

  it('keeps html attributes the project already set', () => {
    const nuxt = fakeNuxt();
    nuxt.options.app.head.htmlAttrs = { lang: 'en' };
    inlineEditNuxt({}, nuxt);

    expect(nuxt.options.app.head.htmlAttrs.lang).toBe('en');
  });

  it('does nothing at all without the flag', () => {
    // A production build must not annotate: the paths would be public.
    delete process.env.INLINE_EDIT;
    const nuxt = fakeNuxt({ dev: false });
    inlineEditNuxt({}, nuxt);

    expect(nuxt.options.vite.plugins ?? []).toEqual([]);
    expect(nuxt.options.app.head.htmlAttrs).toBeUndefined();
  });

  it('annotates in dev without the flag', () => {
    delete process.env.INLINE_EDIT;
    const nuxt = fakeNuxt({ dev: true });
    inlineEditNuxt({}, nuxt);

    expect(nuxt.options.vite.plugins).toHaveLength(1);
  });

  describe('the in-page editor', () => {
    it('is not injected unless asked for', () => {
      const nuxt = fakeNuxt();
      inlineEditNuxt({}, nuxt);

      expect(nuxt.options.app.head.script).toBeUndefined();
      expect(nuxt.options.vite.plugins).toHaveLength(1);
    });

    it('injects the shim before the content script', () => {
      // The shim installs chrome.*; the content script calls it on load.
      const nuxt = fakeNuxt();
      inlineEditNuxt({ preview: { extensionDist: DIST } }, nuxt);

      expect(nuxt.options.app.head.script.map((s) => s.src)).toEqual([
        '/__iet/shim.js',
        '/__iet/content.js',
      ]);
      expect(nuxt.options.app.head.link).toContainEqual({
        rel: 'stylesheet',
        href: '/__iet/page.css',
      });
    });

    it('adds the middleware that serves them', () => {
      const nuxt = fakeNuxt();
      inlineEditNuxt({ preview: { extensionDist: DIST } }, nuxt);

      expect(nuxt.options.vite.plugins.map((p) => p.name)).toEqual([
        'inline-edit-annotation-vue',
        'inline-edit-preview',
      ]);
    });

    it('is refused outside dev, even when asked for', () => {
      // INLINE_EDIT is set here, so annotation is on — but a production
      // build must never serve the editor to visitors.
      const nuxt = fakeNuxt({ dev: false });
      inlineEditNuxt({ preview: { extensionDist: DIST } }, nuxt);

      expect(nuxt.options.app.head.script).toBeUndefined();
      expect(nuxt.options.vite.plugins.map((p) => p.name)).toEqual([
        'inline-edit-annotation-vue',
      ]);
    });

    it('keeps scripts the project already declared', () => {
      const nuxt = fakeNuxt();
      nuxt.options.app.head.script = [{ src: '/analytics.js' }];
      inlineEditNuxt({ preview: { extensionDist: DIST } }, nuxt);

      expect(nuxt.options.app.head.script[0]).toEqual({ src: '/analytics.js' });
    });
  });
});
