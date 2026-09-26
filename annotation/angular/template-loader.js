'use strict';

const path = require('path');

/**
 * Webpack loader — processes Angular HTML templates and TypeScript component
 * files with inline templates, injecting source-location metadata attributes.
 *
 * Active only when options.isDev === true (set by webpack.config.js).
 */

const { annotateSource, annotateInlineTemplates } = require('./template-annotator');
const { isAnnotationEnabled, stampHtmlTag } = require('../lib/build-info.js');

module.exports = function inlineEditTemplateLoader(source) {
  const options = this.getOptions ? this.getOptions() : (this.query || {});

  // INLINE_EDIT overrides; otherwise fall back to the dev signal that
  // webpack.config.js passed down.
  if (!isAnnotationEnabled(options.isDev)) return source;

  const absPath = this.resourcePath;
  const relPath = path.relative(this.rootContext || process.cwd(), absPath);

  if (absPath.endsWith('.html')) {
    let result = annotateSource(source, relPath, 'angular');
    // For the root index.html, stamp branch / commit / repo on <html>
    if (path.basename(absPath) === 'index.html') {
      result = stampHtmlTag(result);
    }
    return result;
  }

  if (absPath.endsWith('.ts')) {
    return annotateInlineTemplates(source, relPath);
  }

  return source;
};
