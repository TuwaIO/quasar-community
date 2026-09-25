import configPromise from '@payload-config';
import crypto from 'crypto';
import { desc, eq, lt } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { getPayload } from 'payload';

import { users_sessions } from '@/payload-generated-schema';
import type { User } from '@/payload-types';

import { TOKEN_EXPIRATION } from '../../constants';

export const createPayloadSession = async (user: User, sid: string) => {
  const payload = await getPayload({ config: configPromise });

  // Access Drizzle DB directly for high-perf session creation
  const db = payload.db.drizzle;

  const now = new Date();
  const expirationDate = new Date(now.getTime() + TOKEN_EXPIRATION * 1000);

  try {
    await db.transaction(async (tx) => {
      // 1. Clean up expired sessions to keep the table clean
      await tx.delete(users_sessions).where(lt(users_sessions.expiresAt, now.toISOString()));

      // 2. Find last order with locking to prevent concurrent collision
      const lastSession = await tx
        .select({ order: users_sessions._order })
        .from(users_sessions)
        .where(eq(users_sessions._parentID, user.id))
        .orderBy(desc(users_sessions._order))
        .limit(1)
        .for('update');

      const nextOrder = (lastSession[0]?.order || 0) + 1;

      // 3. Insert new session
      await tx.insert(users_sessions).values({
        id: sid,
        _parentID: user.id,
        _order: nextOrder,
        createdAt: now.toISOString(),
        expiresAt: expirationDate.toISOString(),
      });
    });
  } catch (e) {
    console.error('Failed to create payload session:', e);
    throw new Error('Session creation failed', { cause: e });
  }
};

const secret = crypto
  .createHash('sha256')
  .update(process.env.PAYLOAD_SECRET ?? '')
  .digest('hex')
  .slice(0, 32);

export const generateSignToken = (user: User, sid: string) => {
  return jwt.sign(
    {
      id: user.id,
      collection: 'users',
      email: user.email,
      sid, // Session ID is critical for revocation
      roles: user.roles,
    },
    secret,
    { expiresIn: TOKEN_EXPIRATION, algorithm: 'HS256' },
  );
};
