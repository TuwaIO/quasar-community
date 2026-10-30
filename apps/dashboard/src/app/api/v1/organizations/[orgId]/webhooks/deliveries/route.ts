import { NextResponse } from 'next/server';

import { WEBHOOK_DELIVERY_POPULATE } from '@/collections/ContextWebhooks/WebhookEndpoints';
import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import { parsePagination } from '@/lib/pagination';

export const runtime = 'nodejs';

/**
 * GET: Fetch delivery logs for an organization, optionally filtered by appId or webhookId
 */
export const GET = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
    if (access instanceof NextResponse) return access;

    const { searchParams } = new URL(req.url);
    const appId = searchParams.get('appId');
    const webhookId = searchParams.get('webhookId');
    const { page, limit } = parsePagination(searchParams, 50);
    const search = searchParams.get('search');

    const where: any = {
      'endpoint.app.organization': { equals: orgId },
    };

    if (webhookId) {
      where.endpoint = { equals: webhookId };
    } else if (appId) {
      where['endpoint.app'] = { equals: appId };
    }

    if (search) {
      where.or = [{ 'endpoint.url': { contains: search } }, { eventType: { contains: search } }];
    }

    const deliveries = await payload.find({
      collection: 'webhook-deliveries',
      where,
      limit,
      page,
      sort: '-createdAt',
      // Depth 2 for the endpoint's app; only what the delivery history shows (WEBHOOK_DELIVERY_POPULATE)
      depth: 2,
      populate: WEBHOOK_DELIVERY_POPULATE,
      overrideAccess: true,
    });

    return NextResponse.json(deliveries);
  } catch (error: unknown) {
    console.error('[Org Deliveries List] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
