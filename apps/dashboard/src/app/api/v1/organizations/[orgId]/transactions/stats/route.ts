import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import { transactions } from '@/payload-generated-schema';

export const runtime = 'nodejs';

/**
 * GET: Stats for transactions in an organization
 */
export const GET = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
    if (access instanceof NextResponse) return access;

    // 1. Pending Transactions
    const pendingTransactions = await payload.find({
      collection: 'transactions',
      where: {
        and: [{ owner: { equals: orgId } }, { pending: { equals: true } }],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      context: { skipOwnerFilter: true },
    });

    // 2. Success Transactions
    const successTransactions = await payload.find({
      collection: 'transactions',
      where: {
        and: [{ owner: { equals: orgId } }, { pending: { equals: false } }, { status: { equals: 'Success' } }],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      context: { skipOwnerFilter: true },
    });

    // 3. Error Transactions
    const errorTransactions = await payload.find({
      collection: 'transactions',
      where: {
        and: [{ owner: { equals: orgId } }, { or: [{ status: { equals: 'Failed' } }, { isError: { equals: true } }] }],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      context: { skipOwnerFilter: true },
    });

    // 4. Unique Chains (High-perf via Drizzle)
    const db = payload.db.drizzle;

    // Get unique chainIds
    const chainsResult = await db
      .select({ chainId: transactions.chainId })
      .from(transactions)
      .where(eq(transactions.owner, orgId))
      .groupBy(transactions.chainId);

    const chains = chainsResult.map((r) => r.chainId).filter(Boolean);

    return NextResponse.json({
      pending: pendingTransactions.totalDocs,
      success: successTransactions.totalDocs,
      error: errorTransactions.totalDocs,
      chains,
    });
  } catch (error: unknown) {
    console.error('[Transactions Stats] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
