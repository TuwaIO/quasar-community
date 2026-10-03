// @vitest-environment node
// Signing runs on the server: under jsdom, jose rejects the Uint8Array of the jsdom realm
import { randomBytes } from 'node:crypto';

import jwt from 'jsonwebtoken';
import { JWT_AUTH_VERSION } from 'payload';
import { describe, expect, it, vi } from 'vitest';

import { generateSignToken } from '@/lib/signInLibs';
import type { User } from '@/payload-types';

// Generated, not a literal: Semgrep p/default (the Community Edition gate) blocks a string
// literal passed to jwt.verify as hardcoded-jwt-secret.
const SECRET = randomBytes(32).toString('hex');

vi.mock('@payload-config', () => ({ default: {} }));

vi.mock('payload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('payload')>()),
  getPayload: vi.fn(async () => ({
    secret: SECRET,
    collections: {
      users: {
        config: {
          slug: 'users',
          fields: [
            { name: 'email', type: 'email' },
            { name: 'roles', type: 'select', hasMany: true, saveToJWT: true },
            { name: 'name', type: 'text' },
          ],
        },
      },
    },
  })),
}));

describe('session token of the custom login routes', () => {
  const user = { id: 'user-1', email: 'admin@example.com', roles: ['admin'], name: 'Admin' } as unknown as User;

  it('carries the auth version header that Payload requires since 3.90', async () => {
    const token = await generateSignToken(user, 'session-1');

    expect(jwt.decode(token, { complete: true })?.header).toMatchObject({
      alg: 'HS256',
      authVersion: JWT_AUTH_VERSION,
    });
  });

  it('is signed with the Payload secret and names the user, the collection and the session', async () => {
    const token = await generateSignToken(user, 'session-1');

    const claims = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    expect(claims).toMatchObject({
      id: 'user-1',
      collection: 'users',
      email: 'admin@example.com',
      sid: 'session-1',
      roles: ['admin'],
    });
    expect(claims).not.toHaveProperty('name');
  });
});
