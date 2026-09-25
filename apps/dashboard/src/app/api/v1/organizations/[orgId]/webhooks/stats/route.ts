import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';

export const runtime = 'nodejs';

export const GET = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
    if (access instanceof NextResponse) return access;

    // 1. Total Active & Total Webhooks in Org
    const [activeEndpoints, totalEndpoints] = await Promise.all([
      payload.find({
        collection: 'webhook-endpoints',
        where: {
          and: [{ 'app.organization': { equals: orgId } }, { isActive: { equals: true } }],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'webhook-endpoints',
        where: {
          'app.organization': { equals: orgId },
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      }),
    ]);

    // 2. Total Deliveries in Org (Last 30 days or all time?)
    // The requirement just says "Total Deliveries".
    // Usually, we might want to limit to recent or just show total docs.
    const allDeliveries = await payload.find({
      collection: 'webhook-deliveries',
      where: {
        'endpoint.app.organization': { equals: orgId },
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    });

    // 3. Success Rate
    const successfulDeliveries = await payload.find({
      collection: 'webhook-deliveries',
      where: {
        and: [{ 'endpoint.app.organization': { equals: orgId } }, { success: { equals: true } }],
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
      successRate: Math.round(successRate * 10) / 10, // 99.9%
      activeWebhooks: activeEndpoints.totalDocs,
      totalWebhooks: totalEndpoints.totalDocs,
    });
  } catch (error: unknown) {
    console.error('[Webhooks Stats] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
