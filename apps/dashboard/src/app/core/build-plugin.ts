/**
 * How to wire the annotation plugin into a build, per framework.
 *
 * Shared rather than owned by the register-a-site dialog, because that
 * dialog shows this once and then never again. Somebody who clicked past it,
 * or who joined the team afterwards, had no way back to the one instruction
 * that decides whether the editor works at all — so the site's own page
 * needs the same text, from the same source.
 */

export type Framework = 'nuxt' | 'vue' | 'react' | 'next' | 'svelte' | 'angular';

export const FRAMEWORKS: { label: string; value: Framework }[] = [
  { label: 'Nuxt', value: 'nuxt' },
  { label: 'Vue + Vite', value: 'vue' },
  { label: 'React + Vite', value: 'react' },
  { label: 'Next.js', value: 'next' },
  { label: 'SvelteKit', value: 'svelte' },
  { label: 'Angular', value: 'angular' },
];

export const PACKAGE = '@usecaliper/annotation';

export interface PluginSnippet {
  /** The file the change goes in, named so it can be found. */
  file: string;
  code: string;
  /** Why the order or the placement matters, where it does. */
  note?: string;
}

/** The exact wiring for one framework — no guessing at the docs. */
export function pluginSnippet(framework: Framework): PluginSnippet {
  switch (framework) {
    case 'nuxt':
      return {
        file: 'nuxt.config.ts',
        code: `export default defineNuxtConfig({\n  modules: ['${PACKAGE}/nuxt'],\n});`,
        note: 'Nuxt renders through Nitro, so this is a module rather than a Vite plugin — that is what puts the build metadata on <html>.',
      };
    case 'vue':
      return {
        file: 'vite.config.js',
        code: `import inlineEdit from '${PACKAGE}/vue';\n\nexport default defineConfig({\n  plugins: [inlineEdit(), vue()],\n});`,
        note: 'Before vue(): the plugin needs the raw .vue file, not the compiled render function.',
      };
    case 'react':
      return {
        file: 'vite.config.js',
        code: `import react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [\n    react({\n      babel: { plugins: ['${PACKAGE}/react'] },\n    }),\n  ],\n});`,
      };
    case 'next':
      return {
        file: '.babelrc',
        code: `{\n  "presets": ["next/babel"],\n  "plugins": ["${PACKAGE}/react"]\n}`,
      };
    case 'svelte':
      return {
        file: 'vite.config.js',
        code: `import inlineEdit from '${PACKAGE}/svelte';\n\nexport default defineConfig({\n  plugins: [inlineEdit(), sveltekit()],\n});`,
        note: 'Before sveltekit(): the compiler turns components into JavaScript, and the markup has to be read first.',
      };
    case 'angular':
      return {
        file: 'angular.json',
        code: `"customWebpackConfig": {\n  "path": "./node_modules/${PACKAGE}/angular/webpack.config.js",\n  "mergeStrategies": { "module.rules": "prepend" }\n}`,
        note: 'Needs @angular-builders/custom-webpack. Under architect.build.options.',
      };
  }
}

/**
 * Guess the framework from the repository, so the right tab opens first.
 *
 * Only a hint — every framework stays selectable, because a repository name
 * is weak evidence and being wrong here should cost one click, not send
 * somebody to the wrong instructions with no way out.
 */
export function guessFramework(repository: string | null | undefined): Framework {
  const name = (repository ?? '').toLowerCase();
  if (name.includes('nuxt')) return 'nuxt';
  if (name.includes('next')) return 'next';
  if (name.includes('svelte')) return 'svelte';
  if (name.includes('angular') || name.includes('ng-')) return 'angular';
  if (name.includes('vue')) return 'vue';
  return 'react';
}
