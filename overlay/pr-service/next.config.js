/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Error reporting is opt-in. Webpack resolves dynamic imports
      // statically, so without this an uninstalled @sentry/node fails the
      // build rather than being absent at runtime. Marking it external
      // leaves the import to Node, where lib/observability.js catches the
      // failure and carries on with structured logs only.
      config.externals = [...(config.externals || []), '@sentry/node'];
    }
    return config;
  },
};

export default nextConfig;
