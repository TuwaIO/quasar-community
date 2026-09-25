import crypto from 'crypto';
import { NextResponse } from 'next/server';
import type { PayloadRequest } from 'payload';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import { verifyTwoFactor } from '@/lib/two-factor-lock';

export const runtime = 'nodejs';

/**
 * POST: Rotate/roll a webhook's signing secret
 * Scoped by organization and requires Admin/Owner role.
 */
export const POST = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; webhookId: string }> }) => {
    try {
      const { orgId, webhookId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

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

      // 1. Verify role access
      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin']);
      if (access instanceof NextResponse) return access;

      // 2. Fetch the Webhook
      const webhook = await payload.findByID({
        collection: 'webhook-endpoints',
        id: webhookId,
        depth: 1,
        overrideAccess: true,
      });

      if (!webhook) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

      // 3. Verify organization scope
      const webhookOrgId =
        typeof webhook.app === 'object'
          ? typeof webhook.app.organization === 'object'
            ? webhook.app.organization.id
            : webhook.app.organization
          : null;

      if (webhookOrgId !== orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // 4. Generate new signing secret
      const newSigningSecret = `whsec_${crypto.randomBytes(32).toString('hex')}`;

      // 5. Update Webhook record (collection hook will encrypt it automatically)
      await payload.update({
        collection: 'webhook-endpoints',
        id: webhookId,
        data: {
          signingSecret: newSigningSecret,
        },
        overrideAccess: true,
      });

      return NextResponse.json({ signingSecret: newSigningSecret });
    } catch (error: unknown) {
      console.error('[Org Webhook Roll] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
