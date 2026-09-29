'use strict';

const nodePath = require('path');
const {
  getBuildInfo,
  isAnnotationEnabled,
  buildInfoAttrs,
} = require('../lib/build-info.js');

/**
 * Babel plugin — annotates JSX text-bearing HTML elements with source metadata.
 *
 * Runs when INLINE_EDIT is truthy, or (when that flag is unset) when
 * NODE_ENV === 'development'. Preview deployments build with
 * NODE_ENV=production, so they must set INLINE_EDIT=1 explicitly.
 *
 * Wire into Next.js via .babelrc:
 *   { "presets": ["next/babel"], "plugins": [["<abs-path>/annotation/react/index.js"]] }
 *
 * Wire into Vite+React via vite.config.js:
 *   import { babel } from '@rollup/plugin-babel';
 *   plugins: [react(), babel({ plugins: ['../annotation/react/index.js'] })]
 */

/** Functions whose first string argument is a translation key. */
const TRANSLATE_FNS = new Set(['t', '$t', 'translate', 'i18n']);

/**
 * Pull the translation key out of `{t('hero.title')}` or `{i18n.t('...')}`.
 *
 * Text rendered through a translation function lives in a locale file, not
 * in the component. Without this the element is simply skipped — it has no
 * JSXText child — and the copy is uneditable. With it, the key travels to
 * the service, which patches the locale file instead.
 *
 * @returns {string|null}
 */
function translationKey(children, t) {
  const expressions = children.filter(
    (c) => t.isJSXExpressionContainer(c) && !t.isJSXEmptyExpression(c.expression)
  );
  const textual = children.filter((c) => t.isJSXText(c) && c.value.trim().length > 0);

  // Only a lone call, with no literal text alongside it, is unambiguous.
  if (expressions.length !== 1 || textual.length > 0) return null;

  const call = expressions[0].expression;
  if (!t.isCallExpression(call)) return null;

  const callee = call.callee;
  const name = t.isIdentifier(callee)
    ? callee.name
    : t.isMemberExpression(callee) && t.isIdentifier(callee.property)
      ? callee.property.name
      : null;

  if (!name || !TRANSLATE_FNS.has(name)) return null;

  const [first] = call.arguments;
  return t.isStringLiteral(first) ? first.value : null;
}

module.exports = function babelPluginInlineEditAnnotation({ types: t }) {
  return {
    name: 'inline-edit-annotation-react',
    visitor: {
      // `jsxPath` deliberately not named `path` — that would shadow the
      // `path` module and break the nodePath.relative() call below.
      JSXOpeningElement(jsxPath, state) {
        if (!isAnnotationEnabled(process.env.NODE_ENV === 'development')) return;

        const name = jsxPath.node.name;
        // Only native HTML tags (lowercase identifiers, not React components)
        if (!t.isJSXIdentifier(name)) return;
        const tagName = name.name;
        const attrs = jsxPath.node.attributes;

        const hasAttr = (attrName) =>
          attrs.some(
            (a) =>
              t.isJSXAttribute(a) &&
              t.isJSXIdentifier(a.name) &&
              a.name.name === attrName
          );

        // Stamp build provenance on <html> / <Html> (App Router layout or _document)
        if (tagName === 'html' || tagName === 'Html') {
          for (const [key, value] of Object.entries(buildInfoAttrs(getBuildInfo()))) {
            if (!hasAttr(key)) {
              attrs.push(t.jsxAttribute(t.jsxIdentifier(key), t.stringLiteral(value)));
            }
          }
          return;
        }

        // A capitalised tag is a component. Its children are a prop handed to
        // something else, and the DOM element that finally renders them is
        // not this one — so an annotation here would point at the wrong
        // element on the page.
        if (/^[A-Z]/.test(tagName)) return;

        // Idempotency: skip if already annotated
        if (hasAttr('data-edit-file')) return;

        const jsxElement = jsxPath.parent; // JSXElement
        const children = Array.isArray(jsxElement.children) ? jsxElement.children : [];

        // Not a tag allowlist. The rule is what the codemod can edit, which
        // is any literal run of text — a list missed every <div> holding
        // copy, which on a utility-class codebase is most of the page.
        // Any run of literal text is editable on its own, even with an
        // element or an {expression} beside it: the codemod rewrites the run,
        // not the element.
        const editableText = children.some(
          (child) => t.isJSXText(child) && child.value.trim().length > 0
        );

        // Text rendered through a translation function lives in a locale
        // file, so it is reachable even though the element holds no literal.
        const i18nKey = editableText ? null : translationKey(children, t);

        // The outermost JSX element of a tree — a component's returned
        // root, or one handed to a prop. Nothing above it in this file
        // carries an annotation, so without one an image, an icon or a
        // wrapper inside it has no ancestor to inherit a file from, and
        // Inspect and Comment can name no source for it.
        const parent = jsxElement.parent ?? jsxPath.parentPath?.parent;
        const isRoot = !t.isJSXElement(parent) && !t.isJSXFragment(parent);

        if (!editableText && !i18nKey && !isRoot) return;

        // Source location
        const loc = jsxPath.node.loc;
        if (!loc) {
          attrs.push(
            t.jsxAttribute(t.jsxIdentifier('data-editable'), t.stringLiteral('false')),
            t.jsxAttribute(t.jsxIdentifier('data-edit-reason'), t.stringLiteral('no-source'))
          );
          return;
        }

        // Prefer Babel's configured cwd (the project root) over process.cwd(),
        // which differs when the build is invoked from another directory.
        const root = state.cwd || process.cwd();
        const filePath = state.filename ? nodePath.relative(root, state.filename) : '';
        attrs.push(
          t.jsxAttribute(t.jsxIdentifier('data-edit-file'), t.stringLiteral(filePath)),
          t.jsxAttribute(t.jsxIdentifier('data-edit-line'), t.stringLiteral(String(loc.start.line))),
          t.jsxAttribute(t.jsxIdentifier('data-edit-col'), t.stringLiteral(String(loc.start.column))),
          t.jsxAttribute(t.jsxIdentifier('data-edit-framework'), t.stringLiteral('react'))
        );

        // `data-editable` is the editing contract — the codemod can rewrite
        // this. `data-edit-file` above is provenance — this came from here.
        // A root with no text of its own gets the second and not the first.
        if (editableText || i18nKey) {
          attrs.push(
            t.jsxAttribute(t.jsxIdentifier('data-editable'), t.stringLiteral('true'))
          );
        }

        if (i18nKey) {
          attrs.push(
            t.jsxAttribute(t.jsxIdentifier('data-edit-i18n-key'), t.stringLiteral(i18nKey))
          );
        }
      },
    },
  };
};
