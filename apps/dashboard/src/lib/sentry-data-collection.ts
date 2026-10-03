import type { BrowserOptions } from '@sentry/nextjs';

// Matches header and query parameter names that carry the client's IP address or identity
const IDENTITY_KEYS = ['forwarded', '-ip', 'remote-', 'via', '-user'];

/**
 * Selective PII: Sentry collects no user data on its own, only the context attached manually (`Sentry.setUser()`).
 * Sentry 11 replaced `sendDefaultPii` with `dataCollection` and collects everything by default: this is the
 * `sendDefaultPii: false` baseline of its migration guide, plus no queue job arguments and no local variables of
 * stack frames. Shared by the browser, Node.js and edge configs.
 */
export const SENTRY_DATA_COLLECTION: NonNullable<BrowserOptions['dataCollection']> = {
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
};
