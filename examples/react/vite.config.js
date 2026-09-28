import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const inlineEditPreview = require('../inline-edit-preview.cjs');

// The annotation plugin is a Babel plugin, and @vitejs/plugin-react already
// runs Babel — so it goes in there rather than pulling in a second pass.
export default defineConfig({
  plugins: [
    react({
      babel: { plugins: [require.resolve('../../annotation/react/index.js')] },
    }),
    // Runs the editor itself on the page, in dev only.
    inlineEditPreview(),
  ],
});
