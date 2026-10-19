import { createHash, randomBytes } from 'node:crypto';

import { NextResponse } from 'next/server';
import type { Payload } from 'payload';

import { EDITION } from '@/constants/edition';
import { authenticateRequest } from '@/lib/auth-utils';
import { executeRedisSafe, redis } from '@/lib/redis';
import type { User } from '@/payload-types';

import { CloudTransferError } from '../errors';
import { ImportConflictError } from './run';

/**
 * Access to the import routes. They are left out of `proxy.ts`, because the proxy keeps only the first 10 MB of a
 * request body, so they repeat its same-origin rule here. Community Edition only, node admins only.
 */

const appOrigin = () => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
  return new URL(appUrl).origin;
};

function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const allowed = [appOrigin()];
  if (process.env.NODE_ENV === 'development') allowed.push('http://localhost:3000', 'http://127.0.0.1:3000');
  return allowed.includes(origin);
}

export async function authorizeImportRequest(req: Request): Promise<{ payload: Payload; user: User } | NextResponse> {
  if (EDITION !== 'community') return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  if (!isSameOrigin(req)) return NextResponse.json({ error: 'Forbidden: Unauthorized origin' }, { status: 403 });
  const auth = await authenticateRequest(req);
  if (auth instanceof NextResponse) return auth;
  if (!auth.user.roles?.includes('admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return auth;
}

const TOKEN_TTL_SECONDS = 300;
const tokenKey = (token: string) => `{cloud-import}:token:${createHash('sha256').update(token).digest('hex')}`;

/** A one-time token for `apply`, issued after step-up; valid for 5 minutes. */
export async function issueImportToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await executeRedisSafe(redis.set(tokenKey(token), userId, 'EX', TOKEN_TTL_SECONDS), 2000, 'CloudImport');
  return token;
}

export async function redeemImportToken(token: string | null, userId: string): Promise<boolean> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const owner = await executeRedisSafe(redis.getdel(tokenKey(token)), 2000, 'CloudImport');
  return owner === userId;
}

const RUNNING_KEY = '{cloud-import}:running';

/** One import at a time on a node; the lock expires after an hour if a process dies holding it. */
export async function acquireImportLock(): Promise<boolean> {
  return (await executeRedisSafe(redis.set(RUNNING_KEY, '1', 'EX', 3600, 'NX'), 2000, 'CloudImport')) === 'OK';
}

export async function releaseImportLock(): Promise<void> {
  await executeRedisSafe(redis.del(RUNNING_KEY), 2000, 'CloudImport').catch(() => undefined);
}

/** The JSON body of an import error: `code` lets the admin UI explain it */
export function importErrorBody(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof CloudTransferError) return { status: 400, body: { code: error.code, error: error.message } };
  if (error instanceof ImportConflictError) {
    return {
      status: 409,
      body: { code: 'conflict', error: 'The export collides with data on this node.', conflicts: error.conflicts },
    };
  }
  console.error('[CloudImport] Import failed:', error);
  return { status: 500, body: { code: 'internal', error: 'The import failed. The node logs have the details.' } };
}
