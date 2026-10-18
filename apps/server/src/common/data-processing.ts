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
 * Whether a version of the Data Processing Addendum that needs acceptance has taken effect for an organization that
 * has not accepted it. The dashboard stores the time it takes effect with the organization when a system admin decides
 * the version (`organizations.intake_closes_at`), and clears it when an owner accepts; the engine compares it with the
 * clock on every request, so the intake closes at that time even while an older cache entry of the app is in use.
 *
 * @param intakeClosesAt - The cached time, or nothing when no such version is waiting.
 * @param now - The time of the request.
 * @returns `true` from that time on, and for a time that does not parse (fails closed).
 */
export function intakeClosedByVersion(intakeClosesAt: string | null | undefined, now: Date): boolean {
  if (!intakeClosesAt) return false;
  const closesAt = Date.parse(intakeClosesAt);
  return Number.isNaN(closesAt) || now.getTime() >= closesAt;
}

/**
 * The statuses an organization reaches in the dashboard: the clauses signed by both parties, or TUWA's review that
 * they are not needed. Each of them closes at {@link intakeClosedByVersion}.
 */
const AGREED: ReadonlySet<string> = new Set<string>([DATA_PROCESSING.SCC, DATA_PROCESSING.NOT_REQUIRED]);

/**
 * @param edition - The edition of this build.
 * @param status - The data processing status of the organization, as cached with its app; missing on an entry cached
 *   before the status existed.
 * @param intakeClosesAt - When a version of the DPA that the organization has not accepted takes effect, as cached
 *   with its app.
 * @param now - The time of the request.
 * @returns Whether the engine may take the organization's transactions. `own` is always open (the operator accepts no
 *   agreement with itself); any other status keeps the intake closed.
 */
export function isDataIntakeOpen(
  edition: typeof EDITION,
  status: string | null | undefined,
  intakeClosesAt?: string | null,
  now: Date = new Date(),
): boolean {
  if (edition === 'community' || status === DATA_PROCESSING.OWN) return true;
  return !!status && AGREED.has(status) && !intakeClosedByVersion(intakeClosesAt, now);
}
