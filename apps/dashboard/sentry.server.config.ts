// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === 'production',
  environment: process.env.NODE_ENV,

  // Free plan: keep sampling conservative to stay within 10K transactions/month
  tracesSampleRate: 0.05,
  enableLogs: true,

  // Selective PII: don't auto-collect IPs/cookies, but allow manual context attachment
  sendDefaultPii: false,

  // Filter noisy/irrelevant errors
  ignoreErrors: [
    // Browser extensions & network noise
    'ResizeObserver loop',
    'Network request failed',
    'Load failed',
    'Failed to fetch',
    'AbortError',
    // Next.js internal navigations
    'NEXT_NOT_FOUND',
    'NEXT_REDIRECT',
  ],

  beforeSend(event) {
    // Strip sensitive headers but preserve useful debug context
    if (event.request?.headers) {
      delete event.request.headers['cookie'];
      delete event.request.headers['authorization'];
      delete event.request.headers['x-api-key'];
      delete event.request.headers['x-tuwa-secret-key'];
      delete event.request.headers['x-internal-secret'];
    }
    return event;
  },
});
