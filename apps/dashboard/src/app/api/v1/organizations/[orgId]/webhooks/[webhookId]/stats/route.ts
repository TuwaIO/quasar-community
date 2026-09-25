import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';

export const runtime = 'nodejs';

export const GET = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; webhookId: string }> }) => {
    try {
      const { orgId, webhookId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
      if (access instanceof NextResponse) return access;

      // Verify webhook belongs to the organization
      const webhook = await payload.findByID({
        collection: 'webhook-endpoints',
        id: webhookId,
        depth: 1, // To check app.organization
        overrideAccess: true,
      });

      if (!webhook) {
        return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
      }

      const webhookOrgId =
        typeof webhook.app === 'object'
          ? typeof webhook.app.organization === 'object'
            ? webhook.app.organization.id
            : webhook.app.organization
          : null;

      if (webhookOrgId !== orgId) {
        return NextResponse.json({ error: 'Forbidden: Webhook does not belong to this organization' }, { status: 403 });
      }

      // 1. Total Deliveries for this webhook
      const allDeliveries = await payload.find({
        collection: 'webhook-deliveries',
        where: {
          endpoint: { equals: webhookId },
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });

      // 2. Success Rate for this webhook
      const successfulDeliveries = await payload.find({
        collection: 'webhook-deliveries',
        where: {
          and: [{ endpoint: { equals: webhookId } }, { success: { equals: true } }],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });

      // 3. Average execution time
      // Payload doesn't support avg aggregation out of the box easily without raw queries or fetching docs.
      // For now, let's just fetch the last 100 docs and average them if we want to stay within Payload's API.
      // Or just skip it if it's too expensive.
      // Requirement says: "Returns specific metrics for a single webhook".
      // Let's stick to Deliveries, Success Rate, and maybe "Last 24h deliveries".

      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const deliveries24h = await payload.find({
        collection: 'webhook-deliveries',
        where: {
          and: [{ endpoint: { equals: webhookId } }, { createdAt: { greater_than_equal: last24h } }],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });

      const total = allDeliveries.totalDocs;
      const successful = successfulDeliveries.totalDocs;
      const successRate = total > 0 ? (successful / total) * 100 : 100;

      return NextResponse.json({
        totalDeliveries: total,
        successRate: Math.round(successRate * 10) / 10,
        deliveries24h: deliveries24h.totalDocs,
      });
    } catch (error: unknown) {
      console.error('[Individual Webhook Stats] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
