import configPromise from '@payload-config';
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getPayload } from 'payload';

import { withRateLimit } from '@/lib/apiWrapper';
import { redis } from '@/lib/redis';
import { createPayloadSession, generateSignToken } from '@/lib/signInLibs';
import { User } from '@/payload-types';

import { TOKEN_EXPIRATION } from '../../../../../../constants';

export const runtime = 'nodejs';

import { getClientIp } from '@/lib/getIp';
import { authAttemptsTotal } from '@/lib/metrics';

const jsonError = (message: string, status: number) => {
  authAttemptsTotal?.inc({ status: 'failure' });
  return NextResponse.json({ error: message }, { status });
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error) {
    return error;
  }

  return '';
};

export const POST = withRateLimit(async (req: Request) => {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = body.email?.trim();
    const password = body.password;

    if (!email || !password) {
      return jsonError('Email and password are required', 400);
    }

    const normalizedEmail = email.toLowerCase().trim();
    const ip = await getClientIp(req);

    const emailKey = `login:email:${normalizedEmail}`;
    const ipEmailKey = `login:ip-email:${ip}:${normalizedEmail}`;

    const [emailAttempts, ipEmailAttempts] = await Promise.all([redis.get(emailKey), redis.get(ipEmailKey)]);

    const MAX_ATTEMPTS = 5;
    const ATTEMPTS_TTL = 300; // 5 minutes

    if (
      (emailAttempts && parseInt(emailAttempts) >= MAX_ATTEMPTS) ||
      (ipEmailAttempts && parseInt(ipEmailAttempts) >= MAX_ATTEMPTS)
    ) {
      return jsonError('Too many login attempts. Please try again in 5 minutes.', 429);
    }

    const incrementAttempts = async () => {
      await Promise.all([
        redis.incr(emailKey).then((val) => {
          if (Number(val) === 1) return redis.expire(emailKey, ATTEMPTS_TTL);
        }),
        redis.incr(ipEmailKey).then((val) => {
          if (Number(val) === 1) return redis.expire(ipEmailKey, ATTEMPTS_TTL);
        }),
      ]);
    };

    const clearAttempts = async () => {
      await Promise.all([redis.del(emailKey), redis.del(ipEmailKey)]);
    };

    const payload = await getPayload({ config: configPromise });

    let loginResult: Awaited<ReturnType<typeof payload.login>>;

    try {
      loginResult = await payload.login({
        collection: 'users',
        data: { email, password },
        overrideAccess: false,
      });
    } catch (error: unknown) {
      const message = getErrorMessage(error);

      if (message === '2FA_REQUIRED') {
        const userLookup = await payload.find({
          collection: 'users',
          where: {
            email: {
              equals: email,
            },
          },
          limit: 1,
          overrideAccess: true,
        });

        const user = userLookup.docs[0] as User | undefined;

        if (!user) {
          await incrementAttempts();
          return jsonError('Invalid email or password', 401);
        }

        await clearAttempts();

        const interimToken = crypto.randomUUID();
        await redis.set(`interim_2fa:${interimToken}`, user.id, 'EX', 300);

        authAttemptsTotal?.inc({ status: 'success' });
        return NextResponse.json(
          {
            requires_2fa: true,
            interim_token: interimToken,
          },
          { status: 200 },
        );
      }

      await incrementAttempts();

      if (message === 'INVALID_2FA_CODE') {
        return jsonError('Invalid verification code', 401);
      }

      if (message === '2FA_SECRET_MISSING') {
        return jsonError('2FA is misconfigured for this account', 500);
      }

      return jsonError('Invalid email or password', 401);
    }

    const user = loginResult.user as User | undefined;

    if (!user) {
      await incrementAttempts();
      return jsonError('Invalid email or password', 401);
    }

    await clearAttempts();

    const cookieStore = await cookies();
    const sessionId = crypto.randomUUID();

    await createPayloadSession(user, sessionId);

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
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    return jsonError('Internal Server Error', 500);
  }
});
