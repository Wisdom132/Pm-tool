'use strict';

const path = require('path');
const { isAnnotationEnabled, stampHtmlTag } = require('../lib/build-info.js');
const { annotateSource } = require('./annotator.js');

/**
 * Vite plugin — annotates Svelte and SvelteKit components with source metadata.
 *
 * Runs when INLINE_EDIT is truthy, or (when that flag is unset) when Vite is in
 * dev mode. Preview deployments are production builds, so they must set
 * INLINE_EDIT=1 explicitly.
 *
 * Wire into vite.config.js:
 *   import inlineEditPlugin from '@quartalyst/inline-edit-annotation/svelte';
 *   plugins: [inlineEditPlugin(), svelte()]
 *
 * Or svelte.config.js / SvelteKit:
 *   import inlineEditPlugin from '@quartalyst/inline-edit-annotation/svelte';
 *   // vite.config.js
 *   plugins: [inlineEditPlugin(), sveltekit()]
 *
 * `enforce: 'pre'` matters: the Svelte compiler turns a component into
 * JavaScript, so this has to see the file before it does. No peer
 * dependency — the annotator scans the markup itself.
 */
module.exports = function inlineEditAnnotationPlugin() {
  let enabled = false;

  return {
    name: 'inline-edit-annotation-svelte',
    enforce: 'pre',

    configResolved(config) {
      const isDev = config.command === 'serve' || config.mode === 'development';
      enabled = isAnnotationEnabled(isDev);
    },

    transform(code, id) {
      if (!enabled) return null;

      // Strip Vite's query suffixes (`?svelte&type=style`) before testing.
      const file = id.split('?')[0];
      if (!file.endsWith('.svelte')) return null;

      const relative = path.relative(process.cwd(), file);

      let annotated;
      try {
        annotated = annotateSource(code, relative);
      } catch {
        // A component that cannot be scanned is left exactly as it was: a
        // build must never fail because the editing tool is installed.
        return null;
      }

      if (annotated === code) return null;
      return { code: annotated, map: null };
    },

    transformIndexHtml(html) {
      if (!enabled) return html;
      // Stamp branch / commit / repo on <html> so the extension can resolve
      // the exact build it is editing.
      return stampHtmlTag(html);
    },
  };
};

module.exports.annotateSource = annotateSource;
