import configPromise from '@payload-config';
import { desc, eq, lt } from 'drizzle-orm';
import { getFieldsToSign, getPayload, jwtSign, type PayloadRequest } from 'payload';

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

/**
 * Signs the `payload-token` of a session made by {@link createPayloadSession}, as Payload's own login does: the
 * `saveToJWT` fields of the users collection, the session ID, and the `authVersion` protected header that Payload
 * checks since 3.90 (a token without it authenticates nobody). Signed with `payload.secret`.
 */
export const generateSignToken = async (user: User, sid: string): Promise<string> => {
  const payload = await getPayload({ config: configPromise });
  const { token } = await jwtSign({
    fieldsToSign: getFieldsToSign({
      collectionConfig: payload.collections.users.config,
      email: user.email,
      sid,
      user: { ...user, collection: 'users' } as PayloadRequest['user'],
    }),
    secret: payload.secret,
    tokenExpiration: TOKEN_EXPIRATION,
  });
  return token;
};
