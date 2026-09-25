import { decrypt } from '@tuwaio/shared/encryption';
import { NextResponse } from 'next/server';
import type { PayloadRequest } from 'payload';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import { verifyTwoFactor } from '@/lib/two-factor-lock';
import type { App } from '@/payload-types';

export const POST = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; appId: string }> }) => {
    try {
      const { orgId, appId } = await params;
      const authResult = await authenticateRequest(req);
      if (authResult instanceof NextResponse) return authResult;

      const { payload, user } = authResult;

      // STEP-UP AUTH: Verify Password
      const body = await req.json().catch(() => ({}));
      const { password, twoFactorCode } = body;

      if (!password) {
        return NextResponse.json(
          { error: 'Step-up authentication required. Please provide your password.' },
          { status: 401 },
        );
      }

      try {
        await payload.login({
          collection: 'users',
          data: { email: user.email, password },
          req: { context: { twoFactorVerified: true } } as unknown as PayloadRequest,
        });
      } catch {
        return NextResponse.json({ error: 'Invalid password for step-up authentication.' }, { status: 401 });
      }

      // STEP-UP AUTH: Verify Two-Factor Authentication (if enabled)
      if (user.twoFactorEnabled) {
        if (!twoFactorCode) {
          return NextResponse.json({ error: 'Two-factor authentication code is required.' }, { status: 401 });
        }

        const verification = await verifyTwoFactor({
          userId: user.id,
          code: twoFactorCode,
          userDoc: user,
        });

        if (!verification.isValid) {
          return NextResponse.json({ error: verification.error || 'Invalid 2FA verification code.' }, { status: 401 });
        }
      }

      // 1. Verify Role (Admin/Owner)
      const access = await verifyOrgAccess(payload, user.id, orgId);
      if (access instanceof NextResponse) return access;

      // 2. Fetch App
      const appData = await payload.findByID({ collection: 'apps', id: appId, overrideAccess: true });
      const organizationRef = typeof appData.organization === 'object' ? appData.organization.id : appData.organization;
      if (organizationRef !== orgId) {
        return NextResponse.json({ error: 'App not found in this organization' }, { status: 404 });
      }

      // 3. Return the full secret key
      const app = appData as unknown as App;
      return NextResponse.json({ secretKey: decrypt(app.secretKey) });
    } catch (error: any) {
      console.error('[Dashboard] Reveal App Key Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
