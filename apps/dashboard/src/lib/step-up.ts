import { NextResponse } from 'next/server';
import type { Payload, PayloadRequest } from 'payload';

import { verifyTwoFactor } from '@/lib/two-factor-lock';
import type { User } from '@/payload-types';

/**
 * Step-up authentication for an action that hands out secrets: the user's password again, and a 2FA code when 2FA is
 * on. The same check the `reveal` routes run.
 *
 * @returns `null` when the user passed, otherwise the 401 response to send
 */
export async function verifyStepUp(
  payload: Payload,
  user: User,
  credentials: { password?: unknown; twoFactorCode?: unknown },
): Promise<NextResponse | null> {
  const { password, twoFactorCode } = credentials;
  if (typeof password !== 'string' || !password) {
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

  if (user.twoFactorEnabled) {
    if (typeof twoFactorCode !== 'string' || !twoFactorCode) {
      return NextResponse.json({ error: 'Two-factor authentication code is required.' }, { status: 401 });
    }
    const verification = await verifyTwoFactor({ userId: user.id, code: twoFactorCode, userDoc: user });
    if (!verification.isValid) {
      return NextResponse.json({ error: verification.error || 'Invalid 2FA verification code.' }, { status: 401 });
    }
  }

  return null;
}
