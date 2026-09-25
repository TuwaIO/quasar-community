import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import { transactions } from '@/payload-generated-schema';

export const GET = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; appId: string }> }) => {
    try {
      const { orgId, appId } = await params;
      const authResult = await authenticateRequest(req);
      if (authResult instanceof NextResponse) return authResult;

      const { payload, user } = authResult;

      // Verify membership
      const access = await verifyOrgAccess(payload, user.id, orgId);
      if (access instanceof NextResponse) return access;

      // Verify App exists and belongs to this organization
      const appData = await payload.findByID({ collection: 'apps', id: appId, overrideAccess: true });
      const organizationRef = typeof appData.organization === 'object' ? appData.organization.id : appData.organization;
      if (organizationRef !== orgId) {
        return NextResponse.json({ error: 'App not found in this organization' }, { status: 404 });
      }

      const [webhooksCount, transactionsCount] = await Promise.all([
        payload.count({
          collection: 'webhook-endpoints',
          where: {
            app: { equals: appId },
          },
        }),
        payload.count({
          collection: 'transactions',
          where: {
            owner: { equals: orgId },
            app: { equals: appId },
          },
          overrideAccess: true,
          context: { skipOwnerFilter: true },
        }),
      ]);

      // Unique Chains for this app (High-perf via Drizzle)
      const db = payload.db.drizzle;

      const chainsResult = await db
        .select({ chainId: transactions.chainId })
        .from(transactions)
        .where(eq(transactions.app, appId))
        .groupBy(transactions.chainId);

      const chains = chainsResult.map((r) => r.chainId).filter(Boolean);

      return NextResponse.json({
        webhooksCount: webhooksCount.totalDocs,
        transactionsCount: transactionsCount.totalDocs,
        chains,
      });
    } catch (error: any) {
      console.error('[Dashboard] Get App Detail Stats Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
