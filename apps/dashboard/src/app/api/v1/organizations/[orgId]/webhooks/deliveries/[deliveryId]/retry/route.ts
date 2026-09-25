import { constructWebhookPayload } from '@tuwaio/shared/utils';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccessOrSystemAdmin } from '@/lib/auth-utils';
import { getQueue } from '@/lib/redis';
import { canRetryWebhookDelivery } from '@/lib/webhook-utils';
import { apps, transactions, webhook_deliveries, webhook_endpoints } from '@/payload-generated-schema';

export const runtime = 'nodejs';

/**
 * POST /api/v1/organizations/[orgId]/webhooks/deliveries/[deliveryId]/retry
 * Manually retries a failed webhook delivery. Org owners/admins may call it,
 * and so may a system admin without membership, since the Payload admin
 * retries any tenant's delivery. The delivery is still scoped to `orgId`.
 */
export const POST = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; deliveryId: string }> }) => {
    try {
      const { orgId, deliveryId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      const access = await verifyOrgAccessOrSystemAdmin(payload, user, orgId, ['owner', 'admin']);
      if (access instanceof NextResponse) return access;

      const db = payload.db.drizzle;

      // 1. Fetch the webhook delivery and ensure it belongs to this organization
      const result = await db
        .select({
          id: webhook_deliveries.id,
          success: webhook_deliveries.success,
          requestPayload: webhook_deliveries.requestPayload,
          txKey: webhook_deliveries.txKey,
          eventType: webhook_deliveries.eventType,
          endpoint: {
            id: webhook_endpoints.id,
            url: webhook_endpoints.url,
            signingSecret: webhook_endpoints.signingSecret,
            isSystemWebhook: webhook_endpoints.isSystemWebhook,
            appId: apps.id,
          },
        })
        .from(webhook_deliveries)
        .innerJoin(webhook_endpoints, eq(webhook_deliveries.endpoint, webhook_endpoints.id))
        .innerJoin(apps, eq(webhook_endpoints.app, apps.id))
        .where(and(eq(webhook_deliveries.id, deliveryId), eq(apps.organization, orgId)))
        .limit(1);

      if (result.length === 0) {
        return NextResponse.json({ error: 'Webhook delivery not found or unauthorized' }, { status: 404 });
      }

      const delivery = result[0];

      if (!canRetryWebhookDelivery(delivery)) {
        return NextResponse.json({ error: 'Webhook was already delivered successfully' }, { status: 400 });
      }

      // Fetch original transaction to reconstruct unmasked payload
      const txResult = await db.select().from(transactions).where(eq(transactions.txKey, delivery.txKey)).limit(1);
      if (txResult.length === 0) {
        return NextResponse.json({ error: 'Transaction not found for retry' }, { status: 404 });
      }

      const tx = txResult[0];

      let originalAction = tx.status;
      if (typeof delivery.requestPayload === 'object' && delivery.requestPayload !== null) {
        originalAction = (delivery.requestPayload as any).action || tx.status;
      }

      const webhookPayload = constructWebhookPayload(tx, originalAction ?? undefined);

      const deliveryQueue = getQueue('{webhook-delivery}');

      await deliveryQueue.add(
        'deliver-webhook',
        {
              deliveryId: delivery.id,
              endpoint: {
                id: delivery.endpoint.id,
                url: delivery.endpoint.url,
                signingSecret: delivery.endpoint.signingSecret,
                organizationId: orgId,
              },
              payload: webhookPayload,
              txKey: delivery.txKey,
              txType: delivery.eventType,
              appId: delivery.endpoint.appId,
            },
        {
          attempts: 1, // Manual retry should just attempt once
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      return NextResponse.json({ success: true, message: 'Webhook retry scheduled' });
    } catch (error) {
      console.error('[Webhook Retry API] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
