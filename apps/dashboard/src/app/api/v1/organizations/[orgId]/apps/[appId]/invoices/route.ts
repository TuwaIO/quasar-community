import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';

export const GET = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; appId: string }> }) => {
    try {
      const { orgId, appId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
      if (access instanceof NextResponse) return access;

      // Verify app belongs to organization
      const app = await payload.findByID({ collection: 'apps', id: appId, depth: 0, overrideAccess: true });
      if (!app || (typeof app.organization === 'object' ? app.organization.id : app.organization) !== orgId) {
        return NextResponse.json({ error: 'App not found in this organization' }, { status: 404 });
      }

      const { searchParams } = new URL(req.url);
      const page = parseInt(searchParams.get('page') || '1', 10);
      const limit = parseInt(searchParams.get('limit') || '10', 10);

      const results = await payload.find({
        collection: 'app-invoices',
        where: {
          app: { equals: appId },
        },
        page,
        limit,
        sort: '-createdAt',
        overrideAccess: true,
      });

      return NextResponse.json({
        docs: results.docs,
        totalDocs: results.totalDocs,
        totalPages: results.totalPages,
        page: results.page,
      });
    } catch (error: unknown) {
      console.error('[App Invoices List] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
