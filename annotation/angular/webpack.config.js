'use strict';

const path = require('path');

/**
 * Angular custom webpack config.
 *
 * Wire into angular.json under architect.build.options:
 *   {
 *     "customWebpackConfig": {
 *       "path": "../annotation/angular/webpack.config.js",
 *       "mergeStrategies": { "module.rules": "prepend" }
 *     }
 *   }
 *
 * Requires @angular-builders/custom-webpack in the Angular project:
 *   ng add @angular-builders/custom-webpack
 *   (then set builder to "@angular-builders/custom-webpack:browser")
 */

module.exports = (config, options) => {
  // Dev signal only — the loader applies the INLINE_EDIT override on top of
  // this, so preview builds can annotate without a development configuration.
  const isDev =
    options.configuration === 'development' ||
    process.env.NODE_ENV === 'development';

  config.module.rules.unshift({
    test: /\.(html|ts)$/,
    use: [
      {
        loader: path.resolve(__dirname, 'template-loader.js'),
        options: { isDev },
      },
    ],
    enforce: 'pre',
  });

  return config;
};
