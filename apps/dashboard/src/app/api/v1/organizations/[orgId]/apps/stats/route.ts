import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';

export const runtime = 'nodejs';

export const GET = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const authResult = await authenticateRequest(req);
    if (authResult instanceof NextResponse) return authResult;

    const { payload, user } = authResult;

    // Verify Role (Admin/Owner/Member)
    const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
    if (access instanceof NextResponse) return access;

    // Fetch all apps for the organization to calculate stats
    const appsResult = await payload.find({
      collection: 'apps',
      where: {
        organization: { equals: orgId },
      },
      limit: 1000,
      depth: 0,
      pagination: false,
    });

    const apps = appsResult.docs;

    const totalApps = apps.length;
    let activeApps = 0;
    let pausedApps = 0;

    for (const app of apps) {
      if (app.isActive) {
        activeApps++;
      } else {
        pausedApps++;
      }
    }

    return NextResponse.json({
      totalApps,
      activeApps,
      needsAttention: pausedApps,
    });
  } catch (error: any) {
    console.error('[Dashboard] App Stats Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
