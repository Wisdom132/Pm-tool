'use strict';

const path = require('path');
const vuePlugin = require('../vue/index.js');
const { buildInfoAttrs, getBuildInfo, isAnnotationEnabled } = require('../lib/build-info.js');

/**
 * Nuxt module.
 *
 * Nuxt renders its HTML through Nitro, so Vite's `transformIndexHtml` never
 * runs — the hook the plain Vite plugin uses to stamp the build metadata and
 * inject the editor. On Nuxt those go through `app.head` instead, which is
 * the whole reason this module exists rather than a line of documentation
 * telling people to add the Vite plugin themselves.
 *
 * Wire into nuxt.config.ts:
 *   modules: ['@usecaliper/annotation/nuxt']
 *
 * With the in-page editor as well (development only):
 *   modules: [['@usecaliper/annotation/nuxt', {
 *     preview: { extensionDist: '/path/to/inline-edit-tool/extension/dist' },
 *   }]]
 *
 * Nothing happens unless INLINE_EDIT is set, or Nuxt is in dev mode.
 *
 * @param {object} options
 * @param {object|false} [options.preview]  run the editor on the page too
 * @param {string} [options.preview.extensionDist]
 */
function inlineEditNuxtModule(options = {}, nuxt) {
  if (!isAnnotationEnabled(nuxt.options.dev)) return;

  nuxt.options.vite = nuxt.options.vite || {};
  nuxt.options.vite.plugins = nuxt.options.vite.plugins || [];
  nuxt.options.vite.plugins.push(vuePlugin());

  const head = (nuxt.options.app.head = nuxt.options.app.head || {});

  // Which build the page came from. The Vite plugin puts these on <html>
  // from transformIndexHtml, which Nitro never runs — here they have to be
  // declared instead.
  //
  // Through `buildInfoAttrs`, not a second copy of the list. This module
  // used to spell the attributes out itself, and when `data-edit-version`
  // was added to the shared helper every other plugin picked it up and
  // Nuxt silently did not. A real preview build is what caught it.
  head.htmlAttrs = { ...head.htmlAttrs, ...buildInfoAttrs(getBuildInfo()) };

  if (!options.preview) return;

  // The editor itself, for trying the tool without installing the extension.
  // Dev only: a production build must never serve it.
  if (!nuxt.options.dev) return;

  // Inside the package, not up in the repository's examples/ directory.
  // It used to be the latter, which resolved correctly from a `file:` link
  // and resolved to `node_modules/@usecaliper/examples` once installed from
  // npm — so the dev server died on boot for every real consumer. Nothing
  // the package requires at runtime may live outside its own `files`.
  const previewPlugin = require(path.resolve(__dirname, '../preview/index.cjs'));
  // `preview: true` is the common case now that the editor resolves itself
  // from `@usecaliper/editor`; the object form is for overriding where it
  // reads the build from.
  const previewOptions = options.preview === true ? {} : options.preview;
  nuxt.options.vite.plugins.push(previewPlugin(previewOptions));

  head.link = [...(head.link || []), { rel: 'stylesheet', href: '/__iet/page.css' }];
  head.script = [
    ...(head.script || []),
    // The shim installs chrome.* and must run before the content script.
    { src: '/__iet/shim.js' },
    { src: '/__iet/content.js' },
  ];
}

// Nuxt reads this to name the module in its startup output.
inlineEditNuxtModule.meta = {
  name: '@usecaliper/annotation',
  configKey: 'inlineEdit',
};

module.exports = inlineEditNuxtModule;
module.exports.default = inlineEditNuxtModule;
