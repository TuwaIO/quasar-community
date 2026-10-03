import { withSentryConfig } from '@sentry/nextjs/config';
import { withPayload } from '@payloadcms/next/withPayload';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The workspace .env, for `next dev` and `next build` on a host. Variables already set win, and in containers, which
// get their environment from Compose, there is no file. Node's own loader: the `dotenv` package (18+) would also
// install a `dotenv` binary over the `dotenv-cli` one that the package scripts call.
try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env'));
} catch {
  // No .env file
}

const NEST_SERVER_URL = process.env.NEST_SERVER_URL || 'http://localhost:3001';

// Extract hostname from S3_ENDPOINT for Next.js Image remote patterns
const s3EndpointHostname = process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).hostname : '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      ...(s3EndpointHostname ? [{ protocol: 'https', hostname: s3EndpointHostname }] : []),
      { protocol: 'https', hostname: 'raw.githubusercontent.com' },
    ],
  },

  async rewrites() {
    const isProd = process.env.NODE_ENV === 'production';
    const apiRewrites = isProd
      ? []
      : [
          {
            source: '/v1/engine/:path*',
            destination: `${NEST_SERVER_URL}/v1/engine/:path*`,
          },
          {
            source: '/webhooks/quasar/:path*',
            destination: `${NEST_SERVER_URL}/webhooks/quasar/:path*`,
          },
          {
            source: '/webhooks/quasar',
            destination: `${NEST_SERVER_URL}/webhooks/quasar`,
          },
        ];

    return [
      ...apiRewrites,
      {
        source: '/index.html',
        destination: '/',
      },
    ];
  },

  devIndicators: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Content-Type',
            value: 'application/json',
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(withPayload(nextConfig, { devBundleServerPackages: false }), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  // No hardcoded fallback. These used to default to TUWA's own Sentry org and
  // project, which is wrong in both directions: it ships our internal slugs in
  // a public repository, and it points a self-hoster's very first source-map
  // upload at an organization they have no access to — failing with an auth
  // error that reads like a bad token. Unset is the honest default; the plugin
  // is inert anyway while SENTRY_AUTH_TOKEN is missing (see
  // disableSourceMapUpload below).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT_DASHBOARD,

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  tunnelRoute: "/monitoring",

  sourcemaps: {
    // No auth token (local dev, Community Edition): no browser source maps are generated at all
    disable: !process.env.SENTRY_AUTH_TOKEN,
    // CRITICAL: the uploaded .map files are deleted, so they are never served to clients
    deleteSourcemapsAfterUpload: true,
  },

  // Attach git commit SHA for release tracking
  release: {
    name: process.env.SENTRY_RELEASE,
  },

  webpack: {
    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});

