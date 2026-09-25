import config from '@payload-config';
import { NextResponse } from 'next/server';
import { getPayload } from 'payload';

import { withRateLimit } from '@/lib/apiWrapper';
import { verifyTwoFactor } from '@/lib/two-factor-lock';

export const POST = withRateLimit(async (req: Request) => {
  const payload = await getPayload({ config });

  try {
    const { token, password, twoFactorCode } = await req.json();

    if (!token || !password) {
      return NextResponse.json({ message: 'Token and password are required' }, { status: 400 });
    }

    const users = await payload.find({
      collection: 'users',
      where: {
        resetPasswordToken: {
          equals: token,
        },
      },
      limit: 1,
      overrideAccess: true,
      showHiddenFields: true,
    });

    const user = users.docs[0];

    // Check if user exists and if the token has expired
    if (!user || !user.resetPasswordExpiration || new Date(user.resetPasswordExpiration).getTime() < Date.now()) {
      return NextResponse.json({ message: 'Invalid or expired reset token' }, { status: 400 });
    }

    if (user.twoFactorEnabled) {
      if (!twoFactorCode) {
        return NextResponse.json(
          { message: '2FA code is required to reset password', requires_2fa: true },
          { status: 403 },
        );
      }

      const verification = await verifyTwoFactor({ userId: user.id, code: twoFactorCode, userDoc: user });
      if (!verification.isValid) {
        return NextResponse.json({ message: verification.error || 'Invalid 2FA code' }, { status: 401 });
      }
    }

    await payload.update({
      collection: 'users',
      id: user.id,
      data: {
        password,
        resetPasswordToken: null,
        resetPasswordExpiration: null,
      },
      overrideAccess: true,
    });


    return NextResponse.json({ message: 'Password reset successfully' }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Reset failed';
    console.error('Reset Password API Error:', error);
    return NextResponse.json({ message }, { status: 500 });
  }
});
