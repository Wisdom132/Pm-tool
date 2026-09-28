// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  isStylesheet,
  isPreprocessed,
  resolveImportPath,
  stylesheetImports,
  extractEmbeddedStyles,
  describeMissingStyles,
} from '../inline-edit-tool/extension/src/style-imports.js';

describe('isStylesheet', () => {
  it('accepts the extensions a bundler treats as styles', () => {
    for (const p of ['a.css', 'a.scss', 'a.sass', 'a.less', 'a.styl', 'a.pcss']) {
      expect(isStylesheet(p), p).toBe(true);
    }
  });

  it('rejects modules', () => {
    for (const p of ['a.js', 'a.jsx', 'a.ts', 'a.json', 'a.svg']) {
      expect(isStylesheet(p), p).toBe(false);
    }
  });

  it('ignores a query suffix', () => {
    // Vite appends these: `import './a.css?inline'`.
    expect(isStylesheet('./a.css?inline')).toBe(true);
  });
});

describe('resolveImportPath', () => {
  it('resolves a sibling', () => {
    expect(resolveImportPath('./hero.css', 'src/pages/index.jsx')).toBe('src/pages/hero.css');
  });

  it('resolves a parent', () => {
    expect(resolveImportPath('../styles/app.css', 'src/pages/index.jsx')).toBe(
      'src/styles/app.css'
    );
  });

  it('resolves several levels up', () => {
    expect(resolveImportPath('../../a.css', 'src/pages/deep/index.jsx')).toBe('src/a.css');
  });

  it('refuses to climb out of the repository', () => {
    expect(resolveImportPath('../../../x.css', 'src/index.jsx')).toBeNull();
  });

  it('ignores packages', () => {
    // A bare specifier lives in node_modules, which is not in the repository.
    expect(resolveImportPath('normalize.css', 'src/index.jsx')).toBeNull();
    expect(resolveImportPath('@acme/theme/base.css', 'src/index.jsx')).toBeNull();
  });

  it('ignores absolute paths', () => {
    // Served from a public directory, with no fixed place in the repo.
    expect(resolveImportPath('/styles/site.css', 'src/index.jsx')).toBeNull();
  });
});

describe('stylesheetImports', () => {
  const file = 'src/components/Features.jsx';

  it('finds both import forms', () => {
    const src = [
      "import React from 'react';",
      "import './features.css';",
      "import styles from './features.module.css';",
      'export function Features() {}',
    ].join('\n');

    expect(stylesheetImports(src, file)).toEqual([
      'src/components/features.module.css',
      'src/components/features.css',
    ]);
  });

  it('finds require and @import', () => {
    expect(stylesheetImports("require('./a.css')", file)).toEqual(['src/components/a.css']);
    expect(stylesheetImports("@import './b.css';", file)).toEqual(['src/components/b.css']);
  });

  it('leaves out modules and packages', () => {
    const src = [
      "import React from 'react';",
      "import 'normalize.css';",
      "import { Badge } from './Badge';",
      "import './real.css';",
    ].join('\n');

    expect(stylesheetImports(src, file)).toEqual(['src/components/real.css']);
  });

  it('does not report the same file twice', () => {
    const src = ["import './a.css';", "import x from './a.css';"].join('\n');
    expect(stylesheetImports(src, file)).toEqual(['src/components/a.css']);
  });

  it('returns nothing for a file that imports no styles', () => {
    expect(stylesheetImports('export const a = 1;', file)).toEqual([]);
  });
});

describe('describeMissingStyles', () => {
  const el = (className) => {
    const node = document.createElement('div');
    node.className = className;
    return node;
  };

  it('recognises utility classes and points at the markup', () => {
    const got = describeMissingStyles(
      el('flex items-center gap-4 text-sm __iet-editable'),
      'src/pages/index.jsx'
    );
    expect(got.reason).toBe('utility-classes');
    expect(got.detail).toMatch(/class list/);
    // Our own decorations are not the user's styling.
    expect(got.classes).not.toContain('__iet-editable');
  });

  it('says plainly that nothing was imported otherwise', () => {
    const got = describeMissingStyles(el('hero'), 'src/pages/index.jsx');
    expect(got.reason).toBe('no-import');
    expect(got.title).toBe('No stylesheet imported');
    expect(got.detail).toContain('index.jsx');
  });

  it('copes with an element that has no classes', () => {
    const got = describeMissingStyles(el(''), 'src/pages/index.jsx');
    expect(got.reason).toBe('no-import');
    expect(got.classes).toEqual([]);
  });
});

describe('isPreprocessed', () => {
  it('flags what the browser cannot run as-is', () => {
    for (const p of ['a.scss', 'a.sass', 'a.less', 'a.styl']) {
      expect(isPreprocessed(p), p).toBe(true);
    }
  });

  it('leaves plain CSS alone', () => {
    expect(isPreprocessed('a.css')).toBe(false);
    expect(isPreprocessed('a.pcss')).toBe(false);
  });
});

describe('extractEmbeddedStyles', () => {
  it('returns null when there is no style block', () => {
    expect(extractEmbeddedStyles('<template><p>hi</p></template>')).toBeNull();
  });

  it('pulls the CSS out of a single-file component', () => {
    const sfc = [
      '<template><p class="a">hi</p></template>',
      '<style>',
      '.a { color: red; }',
      '</style>',
    ].join('\n');

    const got = extractEmbeddedStyles(sfc);
    expect(got.css).toContain('.a { color: red; }');
    expect(got.scoped).toBe(false);
  });

  it('reports that a block is scoped', () => {
    // The compiler rewrites these selectors with a per-component attribute
    // that does not exist until build, so the preview cannot reproduce it.
    const sfc = '<style scoped>\n.a { color: red; }\n</style>';
    expect(extractEmbeddedStyles(sfc).scoped).toBe(true);
  });

  it('joins several blocks', () => {
    const sfc = '<style>.a{}</style>\n<style lang="css">.b{}</style>';
    const got = extractEmbeddedStyles(sfc);
    expect(got.css).toContain('.a{}');
    expect(got.css).toContain('.b{}');
  });

  it('ignores the markup around it', () => {
    const sfc = '<template><p>not css</p></template><style>.a{}</style>';
    expect(extractEmbeddedStyles(sfc).css).not.toContain('not css');
  });
});

describe('describeMissingStyles for a single-file component', () => {
  it('points at the tab already open', () => {
    const el = document.createElement('div');
    const got = describeMissingStyles(el, 'src/components/Banner.vue', '<style scoped>.a{}</style>');
    expect(got.reason).toBe('embedded');
    expect(got.title).toBe('Styles are in this file');
    expect(got.detail).toContain('Banner.vue');
  });
});
