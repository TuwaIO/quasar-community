import configPromise from '@payload-config';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getPayload, type PayloadRequest } from 'payload';

import { withRateLimit } from '@/lib/apiWrapper';
import { users_sessions } from '@/payload-generated-schema';

export const DELETE = withRateLimit(async (req: Request) => {
  try {
    const payload = await getPayload({ config: configPromise });
    const { user } = await payload.auth({ req: req as unknown as PayloadRequest, headers: req.headers });

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Guard: 2FA must be disabled
    if (user.twoFactorEnabled) {
      return NextResponse.json(
        { error: 'Please disable 2FA in security settings before deleting your account.' },
        { status: 403 },
      );
    }

    // 4. Guard: Must not have active Apps in owned Organizations
    const ownedOrgs = await payload.find({
      collection: 'organization-members',
      where: {
        and: [{ user: { equals: user.id } }, { role: { equals: 'owner' } }],
      },
      limit: 0,
      depth: 0,
      overrideAccess: true,
    });

    const ownedOrgIds = ownedOrgs.docs.map((m) =>
      typeof m.organization === 'object' ? m.organization.id : m.organization,
    );

    if (ownedOrgIds.length > 0) {
      const activeApps = await payload.find({
        collection: 'apps',
        where: {
          and: [{ organization: { in: ownedOrgIds } }, { isActive: { equals: true } }],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });

      if (activeApps.totalDocs > 0) {
        return NextResponse.json(
          { error: 'Please deactivate or delete all apps in organizations you own before deleting your account.' },
          { status: 403 },
        );
      }
    }

    // Delete account
    await payload.delete({
      collection: 'users',
      id: user.id,
      overrideAccess: true,
      req: req as unknown as PayloadRequest,
    });

    // Delete all user sessions from DB
    try {
      const db = payload.db.drizzle;
      await db.delete(users_sessions).where(eq(users_sessions._parentID, user.id));
    } catch (sessionError) {
      console.error('Failed to delete user sessions:', sessionError);
    }

    // Clear auth cookie
    const response = NextResponse.json({ success: true, message: 'Account deleted successfully' });
    response.cookies.set('payload-token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error('Delete account error:', error);

    const message = error instanceof Error && error.message ? error.message : 'Failed to delete account';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
