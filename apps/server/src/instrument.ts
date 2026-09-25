import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_NEST_DSN,
  enabled: process.env.NODE_ENV === 'production',
  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,

  integrations: [nodeProfilingIntegration()],

  // Free plan: conservative sampling
  tracesSampleRate: 0.05,
  profilesSampleRate: 0.1,

  enableLogs: true,

  // Selective PII: no auto-collection, manual context only
  sendDefaultPii: false,

  // Filter expected business-logic exceptions (not bugs)
  ignoreErrors: [
    'UnauthorizedException',
    'ForbiddenException',
    'NotFoundException',
    'BadRequestException',
    'ThrottlerException',
  ],

  beforeSend(event) {
    // Strip sensitive headers but preserve request metadata for debugging
    if (event.request?.headers) {
      delete event.request.headers['cookie'];
      delete event.request.headers['authorization'];
      delete event.request.headers['x-api-key'];
      delete event.request.headers['x-tuwa-secret-key'];
      delete event.request.headers['x-internal-secret'];
      delete event.request.headers['x-quasar-signature'];
    }
    return event;
  },
});
