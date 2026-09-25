import crypto from 'crypto';
import { NextResponse } from 'next/server';
import type { PayloadRequest } from 'payload';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import { redisApi } from '@/lib/redis';
import { verifyTwoFactor } from '@/lib/two-factor-lock';

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
      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin']);
      if (access instanceof NextResponse) return access;

      // 2. Fetch App and verify organization scope
      const appData = await payload.findByID({ collection: 'apps', id: appId, overrideAccess: true });
      if (!appData) {
        return NextResponse.json({ error: 'App not found' }, { status: 404 });
      }

      const organizationRef = typeof appData.organization === 'object' ? appData.organization.id : appData.organization;
      if (organizationRef !== orgId) {
        return NextResponse.json({ error: 'App not found in this organization' }, { status: 404 });
      }

      const oldSecretKeyHash = appData.secretKeyHash;

      // 3. Generate new secret key
      const prefix = appData.environment === 'live' ? 'sk_live_' : 'sk_test_';
      const newRawSecretKey = `${prefix}${crypto.randomBytes(24).toString('hex')}`;

      // 4. Update the App (collection hook will automatically encrypt & hash it)
      await payload.update({
        collection: 'apps',
        id: appId,
        data: {
          secretKey: newRawSecretKey,
        },
        overrideAccess: true,
      });

      // 5. Invalidate the old Secret Key cache in Redis
      if (oldSecretKeyHash) {
        await redisApi.del(`{${oldSecretKeyHash}}:meta`);
      }

      return NextResponse.json({ secretKey: newRawSecretKey });
    } catch (error: any) {
      console.error('[Dashboard] Roll App Key Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
