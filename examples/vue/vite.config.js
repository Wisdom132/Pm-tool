import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createRequire } from 'node:module';

// See the note in examples/svelte/vite.config.js: a relative CommonJS plugin
// gets bundled into the config, where `require` is unavailable.
const require = createRequire(import.meta.url);
const inlineEditPreview = require('../../annotation/preview/index.cjs');
const inlineEdit = require('../../annotation/vue/index.js');

// inlineEdit runs first (`enforce: 'pre'`), so it sees the .vue file before
// the Vue compiler turns its template into render code.
export default defineConfig({
  plugins: [inlineEdit(), vue(), inlineEditPreview()],
});
