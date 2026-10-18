import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { QUEUE_FAST } from '@/../constants';
import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccessOrSystemAdmin } from '@/lib/auth-utils';
import { recordAdminView } from '@/lib/dataAccess';
import { DATA_PROCESSING_REQUIRED, isDataIntakeOpen } from '@/lib/dataIntake';
import { getQueue, redisApi } from '@/lib/redis';
import { canRetryTransaction } from '@/lib/transaction-retry';
import { apps, transactions } from '@/payload-generated-schema';

export const runtime = 'nodejs';

/**
 * POST /api/v1/organizations/[orgId]/transactions/[txId]/retry
 *
 * Manually re-triggers transaction tracking for a failed or stuck transaction.
 * - Verifies user authentication and organization membership (a system admin
 *   passes without membership — the Payload admin retries any tenant's record).
 * - Fetches the transaction and confirms it belongs to the organization (BOLA-safe).
 * - Refuses a transaction `canRetryTransaction` rules out: one that finished in
 *   Success, or one pending for less than the stuck threshold.
 * - Refuses it while the intake of the organization is closed, as the engine's
 *   own retry does (`isDataIntakeOpen`): 403 `data_processing_required`.
 * - Evicts the Redis terminal dedup key so the tracker will re-process it.
 * - Resets the DB record to Pending state.
 * - Enqueues the transaction into the {tracking-fast} BullMQ queue.
 */
export const POST = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; txId: string }> }) => {
    try {
      const { orgId, txId } = await params;

      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      const access = await verifyOrgAccessOrSystemAdmin(payload, user, orgId, ['owner', 'admin', 'member']);
      if (access instanceof NextResponse) return access;
      // A system admin opens customer data here past access control: the view is recorded
      await recordAdminView(payload, { user, collection: 'transactions', id: txId });

      const db = payload.db.drizzle;

      // 1. Fetch the transaction by Payload ID, scoped to the org via LEFT JOIN with apps
      const result = await db
        .select({
          id: transactions.id,
          txKey: transactions.txKey,
          status: transactions.status,
          pending: transactions.pending,
          localTimestamp: transactions.localTimestamp,
          owner: transactions.owner,
          appId: apps.id,
        })
        .from(transactions)
        .leftJoin(apps, eq(transactions.app, apps.id))
        .where(eq(transactions.id, Number(txId)))
        .limit(1);

      if (result.length === 0) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
      }

      const tx = result[0];

      // 2. BOLA protection: ensure the transaction belongs to the requested org
      if (tx.owner !== orgId) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
      }

      // 3. Same rule the dashboard and the admin button apply. Re-tracking a
      // successful transaction would reset it to pending and dispatch its
      // terminal webhooks to every subscribed endpoint a second time.
      if (!canRetryTransaction(tx)) {
        return NextResponse.json(
          { error: tx.pending ? 'Transaction is still being tracked' : 'Transaction was already tracked successfully' },
          { status: 400 },
        );
      }

      // 4. The same rule as the engine's retry: no re-tracking while the intake of the organization is closed
      const organization = (await payload
        .findByID({ collection: 'organizations', id: orgId, depth: 0, overrideAccess: true })
        .catch(() => null)) as { dataProcessing?: string | null; intakeClosesAt?: string | null } | null;
      if (!isDataIntakeOpen(organization)) return NextResponse.json(DATA_PROCESSING_REQUIRED, { status: 403 });

      const { txKey, appId } = tx;

      // 5. Evict the Redis terminal dedup key (best-effort, non-fatal)
      // Key format matches NestJS TrackingService: `tracking:finished:${appId}:${txKey}`
      if (appId) {
        const finishedKey = `tracking:finished:${appId}:${txKey}`;
        await redisApi.del(finishedKey).catch((err: unknown) => {
          console.warn('[Tx Retry] Failed to evict Redis terminal key:', err);
        });
      }

      // 6. Reset the DB record to Pending state
      await db
        .update(transactions)
        .set({
          status: null,
          pending: true,
          isError: false,
          error: null,
          finishedTimestamp: null,
          syncStatus: 'pending-sync',
        })
        .where(and(eq(transactions.id, Number(txId)), eq(transactions.owner, orgId)));

      // 7. Re-enqueue into {tracking-fast} BullMQ queue
      if (appId) {
        const fastQueue = getQueue(QUEUE_FAST);
        const jobId = `retry-dashboard-${appId}-${txKey}-${Date.now()}`;
        await fastQueue.add(
          'process-tx',
          { appId, ownerId: orgId, txKey },
          {
            jobId,
            removeOnComplete: true,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          },
        );
      }

      return NextResponse.json({
        success: true,
        txKey,
        message: 'Transaction tracking retry scheduled.',
      });
    } catch (error) {
      console.error('[Tx Retry API] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
