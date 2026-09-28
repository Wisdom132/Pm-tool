'use strict';

const path = require('path');
const { isAnnotationEnabled, stampHtmlTag } = require('../lib/build-info.js');

/**
 * Vite plugin — annotates Vue 3 template text-bearing elements with source metadata.
 *
 * Runs when INLINE_EDIT is truthy, or (when that flag is unset) when Vite is in
 * dev mode. Preview deployments are production builds, so they must set
 * INLINE_EDIT=1 explicitly.
 *
 * Wire into vite.config.js:
 *   import inlineEditPlugin from '../annotation/vue/index.js';
 *   plugins: [vue(), inlineEditPlugin()]
 *
 * Wire into nuxt.config.ts:
 *   import inlineEditPlugin from '../annotation/vue/index.js';
 *   vite: { plugins: [inlineEditPlugin()] }
 *
 * Peer deps (already present in any Vue 3 project):
 *   @vue/compiler-sfc, @vue/compiler-dom
 */

/**
 * Which elements are worth annotating.
 *
 * Not a tag allowlist. The codemod can rewrite an element whose meaningful
 * children are *all* text, whatever the tag — and it refuses one that also
 * holds an element or an interpolation, because replacing the text would
 * destroy them. So that is the rule here too.
 *
 * A list of tags gets this wrong in both directions. It missed every
 * `<div>` holding copy, which on a utility-class codebase is most of the
 * page: one real Nuxt site had 35 editable elements going unannotated. And
 * it annotated `<p>text <a>link</a></p>`, offering an edit the codemod then
 * refused at pull-request time.
 */
function isEditable(node, NodeTypes) {
  const children = node.children || [];

  // Any run of literal text is editable on its own, even with an element or
  // an interpolation beside it: the codemod rewrites the run, not the
  // element, so `<div>Focus on the things you <span>love</span> while we
  // handle the rest</div>` is two editable runs and a span.
  return children.some(
    (c) => c.type === NodeTypes.TEXT && c.content.trim().length > 0
  );
}

// Vue AST NodeTypes (mirrors @vue/compiler-core NodeTypes enum)
const NodeTypes = {
  ROOT: 0,
  ELEMENT: 1,
  TEXT: 2,
  COMMENT: 3,
  ATTRIBUTE: 6,
};

/**
 * Collect mutation points (offsets + injection text) by walking the AST.
 * @param {object} node - Vue template AST node
 * @param {string} filePath - absolute file path (for data-edit-file)
 * @param {Array}  mutations - accumulator
 * @param {number} templateContentOffset - offset of template content start in the full file
 * @param {number} lineOffset - whole lines before the template content, so emitted lines are file lines
 */
function collectMutations(node, filePath, mutations, templateContentOffset, lineOffset) {
  if (node.type === NodeTypes.ELEMENT) {
    const tag = node.tag;
    // A capitalised tag is a component: its children are slot content handed
    // to something else, and the element that finally renders them is not
    // this one, so an annotation here would point at the wrong element.
    if (!/^[A-Z]/.test(tag)) {
      if (isEditable(node, NodeTypes)) {
        const alreadyAnnotated =
          Array.isArray(node.props) &&
          node.props.some(
            (p) => p.type === NodeTypes.ATTRIBUTE && p.name === 'data-edit-file'
          );

        if (!alreadyAnnotated && node.loc) {
          // node.loc.start.offset is position of '<' within the template content string
          // We insert right after the tag name: '<tagname' → '<tagname[injection]'
          const insertOffset = templateContentOffset + node.loc.start.offset + 1 + tag.length;
          // Template AST lines count from the template block, but
          // data-edit-line has to mean a line in the file — that is what the
          // React and Angular plugins emit, and what the service reads.
          const line = node.loc.start.line + lineOffset;
          const col = node.loc.start.column;
          mutations.push({
            offset: insertOffset,
            text:
              ` data-edit-file="${filePath}"` +
              ` data-edit-line="${line}"` +
              ` data-edit-col="${col}"` +
              ` data-editable="true"` +
              ` data-edit-framework="vue"`,
          });
        }
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        collectMutations(child, filePath, mutations, templateContentOffset, lineOffset);
      }
    }
  } else if (node.type === NodeTypes.ROOT && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectMutations(child, filePath, mutations, templateContentOffset, lineOffset);
    }
  }
}

/**
 * Where the template block's content starts.
 *
 * @vue/compiler-sfc changed what `template.loc.start.offset` points at:
 * current versions report the block's *content*, older ones reported the
 * `<template` tag itself. Scanning unconditionally, as this used to, shifted
 * every insertion past the first child element — attributes landed in the
 * middle of the next tag's text, splitting `{{ label.length }}` in half and
 * failing the build.
 *
 * Which convention is in play is visible in the source, so ask it rather
 * than pin a version.
 */
function templateContentOffset(code, blockStartOffset) {
  if (code.startsWith('<template', blockStartOffset)) {
    return findTemplateContentOffset(code, blockStartOffset);
  }
  return blockStartOffset;
}

/**
 * Scan past the closing '>' of an opening tag at `blockStartOffset`.
 */
function findTemplateContentOffset(code, blockStartOffset) {
  let i = blockStartOffset;
  let inStr = false;
  let strCh = '';
  while (i < code.length) {
    const ch = code[i];
    if (inStr) {
      if (ch === strCh) inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      strCh = ch;
    } else if (ch === '>') {
      return i + 1;
    }
    i++;
  }
  return blockStartOffset; // fallback
}

module.exports = function inlineEditAnnotationPlugin() {
  let enabled = false;

  return {
    name: 'inline-edit-annotation-vue',
    enforce: 'pre',

    configResolved(config) {
      const isDev = config.command === 'serve' || config.mode === 'development';
      enabled = isAnnotationEnabled(isDev);
    },

    transform(code, id) {
      if (!enabled) return null;
      if (!id.endsWith('.vue')) return null;

      // Lazy-require so users without Vue deps don't error on import
      let parseSfc, parseDom;
      try {
        ({ parse: parseSfc } = require('@vue/compiler-sfc'));
        ({ parse: parseDom } = require('@vue/compiler-dom'));
      } catch {
        return null; // Vue compiler not available
      }

      let descriptor;
      try {
        const result = parseSfc(code, { filename: id });
        if (result.errors && result.errors.length > 0) return null;
        descriptor = result.descriptor;
      } catch {
        return null;
      }

      if (!descriptor.template) return null;

      const contentOffset = templateContentOffset(
        code,
        descriptor.template.loc.start.offset
      );
      const templateContent = descriptor.template.content;

      let ast;
      try {
        ast = parseDom(templateContent, { parseMode: 'base' });
      } catch {
        return null;
      }

      const relId = path.relative(process.cwd(), id);
      const mutations = [];
      const lineOffset = (code.slice(0, contentOffset).match(/\n/g) || []).length;
      collectMutations(ast, relId, mutations, contentOffset, lineOffset);

      if (mutations.length === 0) return null;

      // Apply in reverse order to preserve earlier offsets
      mutations.sort((a, b) => b.offset - a.offset);
      let result = code;
      for (const { offset, text } of mutations) {
        result = result.slice(0, offset) + text + result.slice(offset);
      }

      return { code: result, map: null };
    },

    transformIndexHtml(html) {
      if (!enabled) return html;
      // Stamp branch / commit / repo on <html> so the extension can resolve
      // the exact build it is editing.
      return stampHtmlTag(html);
    },
  };
};

// Exposed for unit testing — not part of the plugin's public surface.
module.exports.findTemplateContentOffset = findTemplateContentOffset;
module.exports.templateContentOffset = templateContentOffset;
