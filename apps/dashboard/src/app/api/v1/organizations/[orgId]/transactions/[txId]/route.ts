import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';

export const runtime = 'nodejs';

/**
 * GET: Get a single transaction by ID
 */
export const GET = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; txId: string }> }) => {
    try {
      const { orgId, txId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
      if (access instanceof NextResponse) return access;

      const transaction = await payload.findByID({
        collection: 'transactions',
        id: txId,
        depth: 1,
        overrideAccess: true,
        context: { skipOwnerFilter: true },
      });

      if (
        !transaction ||
        (typeof transaction.owner === 'object' ? transaction.owner.id : transaction.owner) !== orgId
      ) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
      }

      return NextResponse.json(transaction);
    } catch (error: unknown) {
      console.error('[Transaction Detail] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
