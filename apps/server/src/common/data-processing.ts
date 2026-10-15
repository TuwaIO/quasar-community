import { SetMetadata } from '@nestjs/common';
import { DATA_PROCESSING } from '@tuwaio/shared/constants';

import type { EDITION } from './edition';

/**
 * Whether an organization may send the data of its app users to the engine.
 *
 * The hosted edition processes that data on the organization's behalf, so it takes it only once the organization has
 * concluded the Data Processing Addendum (and the standard contractual clauses where they apply), or when the
 * organization belongs to the operator of the deployment (`organizations.data_processing`, `DATA_PROCESSING` of
 * `@tuwaio/shared/constants`). Until then `EngineGuard` refuses every route marked with {@link RequiresDataProcessing},
 * before the request counts towards the RPS limit or the quota. A Community Edition node is run by its own operator and
 * does not check the status.
 */

export const REQUIRES_DATA_PROCESSING_KEY = 'requiresDataProcessing';

/**
 * Marks a controller or a route that takes the data of an organization's app users (a transaction, its retry, the hash
 * of a batch), so `EngineGuard` refuses it for an organization without data processing.
 */
export const RequiresDataProcessing = () => SetMetadata(REQUIRES_DATA_PROCESSING_KEY, true);

const explanation =
  'Data processing is not set up for this organization. Transactions are accepted once an owner concludes the Data ' +
  'Processing Addendum, and the standard contractual clauses where they apply, in the Quasar dashboard.';

/** Body of the 403 response; `error` carries the explanation because `@tuwaio/quasar-sdk` puts it in its error message. */
export const DATA_PROCESSING_REQUIRED = {
  error: `Forbidden: ${explanation}`,
  message: explanation,
  code: 'data_processing_required',
} as const;

/**
 * @param edition - The edition of this build.
 * @param status - The data processing status of the organization, as cached with its app; missing on an entry cached
 *   before the status existed.
 * @returns Whether the engine may take the organization's transactions. Any status but `own` keeps the intake closed.
 */
export function isDataIntakeOpen(edition: typeof EDITION, status: string | null | undefined): boolean {
  return edition === 'community' || status === DATA_PROCESSING.OWN;
}
