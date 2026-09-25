import configPromise from '@payload-config';
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getPayload } from 'payload';

import { MAX_LOGIN_ATTEMPTS } from '@/constants';
import { withRateLimit } from '@/lib/apiWrapper';
import { authAttemptsTotal } from '@/lib/metrics';
import { redis } from '@/lib/redis';
import { createPayloadSession, generateSignToken } from '@/lib/signInLibs';
import { verifyTwoFactor } from '@/lib/two-factor-lock';

import { TOKEN_EXPIRATION } from '../../../../../../../constants';

export const POST = withRateLimit(async (req: Request) => {
  try {
    const body = await req.json();
    const { interim_token, code } = body;

    if (!interim_token || !code) {
      authAttemptsTotal?.inc({ status: 'failure' });
      return NextResponse.json({ error: 'Missing token or verification code' }, { status: 400 });
    }

    // 1. Resolve Interim Token
    const userId = await redis.get(`interim_2fa:${interim_token}`);

    if (!userId) {
      authAttemptsTotal?.inc({ status: 'failure' });
      return NextResponse.json({ error: 'Session expired or invalid. Please try logging in again.' }, { status: 400 });
    }

    const payload = await getPayload({ config: configPromise });
    const user = await payload.findByID({
      collection: 'users',
      id: userId,
      overrideAccess: true,
    });

    if (!user) {
      authAttemptsTotal?.inc({ status: 'failure' });
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      authAttemptsTotal?.inc({ status: 'failure' });
      return NextResponse.json({ error: '2FA is not enabled for this account' }, { status: 400 });
    }

    // Per-interim-token attempt limiter (prevents brute-force per login session)
    const tokenAttemptsKey = `interim_2fa_attempts:${interim_token}`;
    const tokenAttempts = await redis.incr(tokenAttemptsKey);
    const lockTtl = parseInt(process.env.LOCKOUT_2FA_DURATION || '300');
    await redis.expire(tokenAttemptsKey, lockTtl); // Same TTL as the interim token (5 min)
    if (tokenAttempts > MAX_LOGIN_ATTEMPTS) {
      // Burn the interim token on excessive attempts
      await redis.del(`interim_2fa:${interim_token}`);
      await redis.del(tokenAttemptsKey);
      authAttemptsTotal?.inc({ status: 'failure' });
      return NextResponse.json({ error: 'Too many verification attempts. Please log in again.' }, { status: 429 });
    }

    // 2. Verification under distributed lock
    const verification = await verifyTwoFactor({ userId: user.id, code });
    if (!verification.isValid) {
      authAttemptsTotal?.inc({ status: 'failure' });
      return NextResponse.json({ error: verification.error || 'Invalid verification code' }, { status: 400 });
    }

    // 3. Clear Interim Token
    await redis.del(`interim_2fa:${interim_token}`);

    // If backup code used, might want to generate a new one, but for now we'll leave it
    // to the user to disable and re-enable.

    // 4. Create Session
    const cookieStore = await cookies();
    const sessionId = crypto.randomUUID();
    await createPayloadSession(user, sessionId);

    // 5. Finalize Login Cookie
    const token = generateSignToken(user, sessionId);
    cookieStore.set('payload-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: TOKEN_EXPIRATION,
    });

    authAttemptsTotal?.inc({ status: 'success' });
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      message: 'Logged in successfully',
    });
  } catch (error) {
    authAttemptsTotal?.inc({ status: 'failure' });
    console.error('2FA Verify Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
