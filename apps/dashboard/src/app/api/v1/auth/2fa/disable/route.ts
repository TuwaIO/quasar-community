import { NextResponse } from 'next/server';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest } from '@/lib/auth-utils';
import { verifyTwoFactor } from '@/lib/two-factor-lock';

export const POST = withRateLimit(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    if (!user.twoFactorEnabled) {
      return NextResponse.json({ error: '2FA is already disabled' }, { status: 400 });
    }

    const body = await req.json();
    const { code } = body;

    if (!code) {
      return NextResponse.json({ error: 'Verification code or backup code is required' }, { status: 400 });
    }

    // Reuse the single verification path so disable supports TOTP, current
    // hashed recovery codes, and legacy recovery-code records consistently.
    // A recovery code is consumed by verifyTwoFactor before 2FA is disabled.
    const verification = await verifyTwoFactor({ userId: user.id, code, userDoc: user });
    if (!verification.isValid) {
      return NextResponse.json({ error: verification.error || 'Invalid verification code' }, { status: 400 });
    }

    // Update Database User
    await payload.update({
      collection: 'users',
      id: user.id,
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        backupCode: null,
      },
      overrideAccess: true,
    });

    // Notify user that 2FA was disabled for security

    return NextResponse.json({ success: true, message: '2FA disabled successfully' });
  } catch (error) {
    console.error('2FA Disable Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
