'use strict';

/**
 * Angular annotation adapter entry point.
 *
 * Usage: point angular.json's customWebpackConfig.path at webpack.config.js
 * in this directory. This file exposes the webpack config path for programmatic use.
 *
 * Example angular.json excerpt:
 *   "architect": {
 *     "build": {
 *       "builder": "@angular-builders/custom-webpack:browser",
 *       "options": {
 *         "customWebpackConfig": {
 *           "path": "../annotation/angular/webpack.config.js",
 *           "mergeStrategies": { "module.rules": "prepend" }
 *         }
 *       }
 *     }
 *   }
 */

const path = require('path');

module.exports = {
  webpackConfigPath: path.resolve(__dirname, 'webpack.config.js'),
  loaderPath: path.resolve(__dirname, 'template-loader.js'),
};
