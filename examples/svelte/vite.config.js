import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createRequire } from 'node:module';

// The plugins are CommonJS. Installed from npm they would be externalised and
// a plain `import` would work — but this example loads one by relative path,
// which Vite bundles into the config, and a bundled CJS module cannot
// `require`. createRequire loads it as the module it actually is.
const require = createRequire(import.meta.url);
const inlineEdit = require('../../annotation/svelte/index.js');

// inlineEdit runs first: the Svelte compiler turns a component into
// JavaScript, so the annotations have to be in the markup before it does.
export default defineConfig({
  plugins: [inlineEdit(), svelte({ configFile: false })],
});
