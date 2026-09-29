export const environment = {
  /**
   * Same-origin by default: the dashboard is served next to the API, or
   * behind a proxy that maps /api to it. An absolute URL here also needs
   * the origin adding to the API's CORS_ORIGINS.
   */
  apiUrl: '/api',
  production: true,
};
