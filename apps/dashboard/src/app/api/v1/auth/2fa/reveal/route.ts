import { NextResponse } from 'next/server';
import type { PayloadRequest } from 'payload';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest } from '@/lib/auth-utils';
import { generateBackupCode } from '@/lib/two-factor-lock';
import type { User } from '@/payload-types';

/**
 * POST: Regenerate the user's 2FA backup code (replaces reveal for security).
 * Requires step-up password authentication.
 */
export const POST = withRateLimit(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user: sessionUser } = auth;

    // STEP-UP AUTH: Verify Password
    const body = await req.json().catch(() => ({}));
    const { password } = body;

    if (!password) {
      return NextResponse.json(
        { error: 'Step-up authentication required. Please provide your password.' },
        { status: 401 },
      );
    }

    try {
      await payload.login({
        collection: 'users',
        data: { email: sessionUser.email, password },
        req: { context: { twoFactorVerified: true } } as unknown as PayloadRequest,
      });
    } catch {
      return NextResponse.json({ error: 'Invalid password for step-up authentication.' }, { status: 401 });
    }

    // Fetch the latest user data
    const user = (await payload.findByID({
      collection: 'users',
      id: sessionUser.id,
      depth: 0,
      overrideAccess: true,
    })) as unknown as User;

    if (!user.twoFactorEnabled) {
      return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 });
    }

    // 1. Generate a new high-entropy 10-character Base32 backup code
    const { formatted: formattedBackupCode, hash: backupCodeHash } = generateBackupCode();

    // 3. Update Database (Store the hash instead of plaintext)
    await payload.update({
      collection: 'users',
      id: user.id,
      data: {
        backupCode: backupCodeHash,
      },
      overrideAccess: true,
    });

    return NextResponse.json({
      backupCode: formattedBackupCode,
    });
  } catch (error) {
    console.error('[Auth 2FA Reveal] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
