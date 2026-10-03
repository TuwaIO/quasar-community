import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

// Matches header and query parameter names that carry the client's IP address or identity
const IDENTITY_KEYS = ['forwarded', '-ip', 'remote-', 'via', '-user'];

Sentry.init({
  dsn: process.env.SENTRY_NEST_DSN,
  enabled: process.env.NODE_ENV === 'production',
  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,

  integrations: [nodeProfilingIntegration()],

  // Free plan: conservative sampling
  tracesSampleRate: 0.05,
  // Profiles 10% of the processes, while a sampled span is running
  profileSessionSampleRate: 0.1,
  profileLifecycle: 'trace',

  // Selective PII: no auto-collection, manual context only. Sentry 11 collects everything by default: this is the
  // `sendDefaultPii: false` baseline of its migration guide, plus no queue job arguments and no local variables
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { deny: IDENTITY_KEYS }, response: { deny: IDENTITY_KEYS } },
    httpBodies: [],
    urlQueryParams: { deny: IDENTITY_KEYS },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    graphQL: { document: false, variables: false },
    queues: false,
    stackFrameVariables: false,
  },

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
