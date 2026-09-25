// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === 'production',
  environment: process.env.NODE_ENV,

  integrations: [
    Sentry.replayIntegration({
      // Selective PII: mask all text to prevent secrets from leaking
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
    Sentry.browserTracingIntegration(),
  ],

  // Free plan: conservative sampling (5%)
  tracesSampleRate: 0.05,
  enableLogs: true,

  // Session Replay: only capture on errors to conserve free plan quota (50 replays/month)
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  // Selective PII: don't auto-collect, attach manually via Sentry.setUser()
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
    // Wallet connection noise
    'User rejected the request',
    'User denied transaction',
  ],

  // Block errors from third-party scripts (browser extensions, analytics, etc.)
  denyUrls: [/extensions\//i, /^chrome:\/\//i, /^moz-extension:\/\//i],

  beforeSend(event) {
    // Strip cookies from breadcrumbs and request data
    if (event.request?.cookies) {
      delete event.request.cookies;
    }
    if (event.request?.headers) {
      delete event.request.headers['cookie'];
      delete event.request.headers['authorization'];
    }
    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
