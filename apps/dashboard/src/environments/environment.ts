/**
 * Where the API is.
 *
 * A file rather than a build-time define so a deployment can be
 * reconfigured without a rebuild, and so the dev default is visible in the
 * repository instead of implied.
 */
export const environment = {
  apiUrl: '/api',
  production: false,
};
