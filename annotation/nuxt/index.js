'use strict';

const path = require('path');
const vuePlugin = require('../vue/index.js');
const { getBuildInfo, isAnnotationEnabled } = require('../lib/build-info.js');

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
 *   modules: ['@quartalyst/inline-edit-annotation/nuxt']
 *
 * With the in-page editor as well (development only):
 *   modules: [['@quartalyst/inline-edit-annotation/nuxt', {
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

  // Which build the page came from. The Vite plugin puts these on <html> from
  // transformIndexHtml; here they have to be declared.
  const info = getBuildInfo();
  head.htmlAttrs = {
    ...head.htmlAttrs,
    ...(info.repo ? { 'data-edit-repo': info.repo } : {}),
    ...(info.branch ? { 'data-edit-branch': info.branch } : {}),
    ...(info.commit ? { 'data-edit-commit': info.commit } : {}),
  };

  if (!options.preview) return;

  // The editor itself, for trying the tool without installing the extension.
  // Dev only: a production build must never serve it.
  if (!nuxt.options.dev) return;

  const previewPlugin = require(
    path.resolve(__dirname, '../../examples/inline-edit-preview.cjs')
  );
  nuxt.options.vite.plugins.push(previewPlugin(options.preview));

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
  name: '@quartalyst/inline-edit-annotation',
  configKey: 'inlineEdit',
};

module.exports = inlineEditNuxtModule;
module.exports.default = inlineEditNuxtModule;
