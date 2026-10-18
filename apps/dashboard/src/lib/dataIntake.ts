import { DATA_PROCESSING } from '@tuwaio/shared/constants';

import { EDITION } from '@/constants/edition';

const explanation =
  'Data processing is not set up for this organization. Transactions are accepted once an owner concludes the Data ' +
  'Processing Addendum, and the standard contractual clauses where they apply, in the Quasar dashboard.';

/** The body of the 403 the engine answers for an organization whose intake is closed (`DATA_PROCESSING_REQUIRED`). */
export const DATA_PROCESSING_REQUIRED = {
  error: `Forbidden: ${explanation}`,
  message: explanation,
  code: 'data_processing_required',
} as const;

const AGREED: ReadonlySet<string> = new Set<string>([DATA_PROCESSING.SCC, DATA_PROCESSING.NOT_REQUIRED]);

/**
 * Whether an organization's apps may send the data of their users now: the rule of the engine's `isDataIntakeOpen`
 * (`apps/server/src/common/data-processing.ts`), for the dashboard's own paths that process that data, such as a retry
 * of a stored transaction. The hosted edition takes it once the organization concluded its terms, until a version it
 * has not accepted takes effect (`intakeClosesAt`, failing closed on a time that does not parse); `own` is always open,
 * and a Community Edition node does not check the status.
 *
 * @param organization - The data processing status and the time the intake closes, as stored with the organization.
 * @param now - The time of the request.
 * @param edition - The edition of this build (tests).
 */
export function isDataIntakeOpen(
  organization: { dataProcessing?: string | null; intakeClosesAt?: string | null } | null | undefined,
  now: Date = new Date(),
  edition: 'cloud' | 'community' = EDITION,
): boolean {
  if (edition === 'community' || organization?.dataProcessing === DATA_PROCESSING.OWN) return true;
  if (!organization?.dataProcessing || !AGREED.has(organization.dataProcessing)) return false;
  if (!organization.intakeClosesAt) return true;
  const closesAt = Date.parse(organization.intakeClosesAt);
  return !Number.isNaN(closesAt) && now.getTime() < closesAt;
}
