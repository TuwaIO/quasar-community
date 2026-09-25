import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';

export const runtime = 'nodejs';

/**
 * GET: List transactions for an organization
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
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status');
    const chainId = searchParams.get('chainId');
    const type = searchParams.get('type');
    const appId = searchParams.get('appId');

    const where: any = {
      owner: { equals: orgId },
    };

    if (appId) {
      where.app = { equals: appId };
    }

    if (status) {
      if (status === 'pending') {
        where.pending = { equals: true };
      } else if (status === 'success') {
        where.and = [{ pending: { equals: false } }, { status: { equals: 'Success' } }];
      } else if (status === 'error') {
        where.or = [{ status: { equals: 'Failed' } }, { isError: { equals: true } }];
      }
    }

    if (chainId) {
      where.chainId = { equals: chainId };
    }

    if (type) {
      where.type = { contains: type };
    }

    const transactions = await payload.find({
      collection: 'transactions',
      where,
      page,
      limit,
      sort: '-localTimestamp',
      depth: 1,
      overrideAccess: true,
      context: { skipOwnerFilter: true },
    });

    return NextResponse.json(transactions);
  } catch (error: unknown) {
    console.error('[Org Transactions List] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
