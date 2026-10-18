import type { CollectionAfterOperationHook, Payload } from 'payload';
import { APIError } from 'payload';

/** The collections whose documents are customer data: each view of them in the admin panel is recorded. */
export const WATCHED_COLLECTIONS = [
  'transactions',
  'apps',
  'webhook-deliveries',
  'webhook-endpoints',
  'outbox_events',
  'app-invoices',
] as const;

export type WatchedCollection = (typeof WATCHED_COLLECTIONS)[number];

// A list keeps the ids of the records it showed, up to a page of the admin panel
const MAX_IDS = 100;

const idsOf = (docs: unknown[]) =>
  docs
    .map((d) => (d && typeof d === 'object' && 'id' in d ? String((d as { id: unknown }).id) : null))
    .filter((id): id is string => !!id)
    .slice(0, MAX_IDS);

type Viewer = { id: string; email?: string; roles?: string[] | null };

async function writeEntry(
  payload: Payload,
  entry: { user: Viewer; collection: WatchedCollection; list: boolean; records: string[]; total: number },
) {
  try {
    await payload.create({
      collection: 'data-access-log',
      overrideAccess: true,
      data: {
        viewedAt: new Date().toISOString(),
        user: entry.user.id,
        userEmail: entry.user.email ?? '',
        viewedCollection: entry.collection,
        operation: entry.list ? 'list' : 'record',
        records: entry.records,
        total: entry.total,
      },
    });
  } catch (err) {
    payload.logger.error({ err }, `[DataAccessLog] Could not record a view of ${entry.collection}`);
    throw new APIError('The view could not be recorded, so it is not shown. Try again.', 503);
  }
}

/**
 * Records that a system admin opened one record of customer data through an action of the admin panel that reads it
 * past access control, such as the receipt of a transaction or a retry. Anyone else is not logged.
 *
 * Side effects: writes `data-access-log`.
 *
 * @throws APIError 503 when the entry cannot be written; the action then does not run.
 */
export async function recordAdminView(
  payload: Payload,
  params: { user: Viewer | null | undefined; collection: WatchedCollection; id: string },
) {
  const { user, collection, id } = params;
  if (!user?.roles?.includes('admin')) return;
  await writeEntry(payload, { user, collection, list: false, records: [id], total: 1 });
}

/**
 * The hook that writes the data access log: each list or record of customer data that a system
 * admin opens with access control on becomes one entry: who, which collection, which records, when. That is how the
 * admin panel reads, both when it renders a view on the server through the Local API and through its REST calls.
 * Reads that override access control, which are the system's own, and reads of customers are not logged. A view that
 * cannot be recorded is refused, so the log holds every view it claims to.
 *
 * Side effects: writes `data-access-log`; the server deletes entries after 1 year (`RETENTION`).
 *
 * @param collection - The collection the hook is on.
 * @returns An `afterOperation` hook that passes the result on unchanged.
 * @throws APIError 503 when the entry cannot be written.
 */
export function recordDataAccess(collection: WatchedCollection): CollectionAfterOperationHook {
  return async ({ operation, overrideAccess, req, result }) => {
    if (operation !== 'find' && operation !== 'findByID') return result;
    const user = req.user as Viewer | null | undefined;
    if (!user?.roles?.includes('admin') || overrideAccess !== false) return result;

    const list = operation === 'find';
    const page = result as unknown as { docs?: unknown[]; totalDocs?: number };
    const records = list ? idsOf(page.docs ?? []) : idsOf([result]);
    await writeEntry(req.payload, {
      user,
      collection,
      list,
      records,
      total: list ? (page.totalDocs ?? records.length) : records.length,
    });
    return result;
  };
}
