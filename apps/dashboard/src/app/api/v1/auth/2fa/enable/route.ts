import { NextResponse } from 'next/server';
import { verifySync } from 'otplib';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest } from '@/lib/auth-utils';
import { redis } from '@/lib/redis';
import { generateBackupCode } from '@/lib/two-factor-lock';

export const POST = withRateLimit(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    if (user.twoFactorEnabled) {
      return NextResponse.json({ error: '2FA is already enabled' }, { status: 400 });
    }

    const body = await req.json();
    const { code } = body;

    if (!code) {
      return NextResponse.json({ error: 'Verification code is required' }, { status: 400 });
    }

    // 1. Get Pending Secret from Redis
    const pendingSecret = await redis.get(`pending_2fa:${user.id}`);

    if (!pendingSecret) {
      return NextResponse.json(
        { error: 'Session expired or invalid. Please refresh the page and try again.' },
        { status: 400 },
      );
    }

    // 2. Verify Code
    const isValid = verifySync({ token: code, secret: pendingSecret }).valid;

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 });
    }

    // 3. Generate Backup Code (10 characters Base32, e.g. ABCDE-FGHIJ)
    const { formatted: formattedBackupCode, hash: backupCodeHash } = generateBackupCode();

    // 4. Update Database (Store the hash instead of plaintext)
    await payload.update({
      collection: 'users',
      id: user.id,
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: pendingSecret,
        backupCode: backupCodeHash,
      },
      overrideAccess: true,
    });

    // 5. Cleanup Redis
    await redis.del(`pending_2fa:${user.id}`);

    // 6. Send Email (Send plaintext recovery code to user)

    return NextResponse.json({
      success: true,
      message: '2FA enabled successfully',
      backupCode: formattedBackupCode,
    });
  } catch (error) {
    console.error('2FA Enable Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
