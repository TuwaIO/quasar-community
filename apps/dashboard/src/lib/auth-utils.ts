import { NextResponse } from 'next/server';
import { getPayload, type Payload, type PayloadRequest } from 'payload';

import configObject from '@/payload.config';
import type { User } from '@/payload-types';

import { getUserOrgIds, requireOrgRole } from './organizations';

/**
 * Result of a successful authentication attempt
 */
export interface AuthResult {
  payload: Payload;
  user: User;
}

/**
 * Authenticates the current request and verifies the user has the 'admin' role.
 * Returns the user and payload instance, or a NextResponse error (401/403).
 */
export async function verifyAdmin(req: Request): Promise<AuthResult | NextResponse> {
  const auth = await authenticateRequest(req);
  if (auth instanceof NextResponse) return auth;

  if (!auth.user.roles?.includes('admin')) {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  return auth;
}

/**
 * Authenticates the current request via Payload CMS cookie.
 * Returns the user and payload instance, or a NextResponse error.
 */
export async function authenticateRequest(req: Request): Promise<AuthResult | NextResponse> {
  const payload = await getPayload({ config: configObject });
  const { user } = await payload.auth({
    req: req as unknown as PayloadRequest,
    headers: req.headers,
  });

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return { payload, user: user as unknown as User };
}

/**
 * Authenticates the current request via Payload CMS cookie (Optional).
 * Returns the user and payload instance. User will be null if not authenticated.
 */
export async function optionalAuthenticateRequest(
  req: Request,
): Promise<AuthResult | { payload: Payload; user: null }> {
  const payload = await getPayload({ config: configObject });
  const { user } = await payload.auth({
    req: req as unknown as PayloadRequest,
    headers: req.headers,
  });

  return { payload, user: (user as unknown as User) || null };
}

/**
 * Resolves the organization context for a resource.
 * Given a resource's organizationId, verifies the user is a member with required role.
 *
 * @returns The user's orgIds if successful, or a NextResponse error.
 */
export async function verifyOrgAccess(
  payload: Payload,
  userId: string,
  orgId: string,
  requiredRoles: Array<'owner' | 'admin' | 'member'> = ['owner', 'admin'],
): Promise<{ allowed: true; role: 'owner' | 'admin' | 'member' } | NextResponse> {
  const { allowed, role } = await requireOrgRole(payload, userId, orgId, requiredRoles);

  if (!allowed || !role) {
    return NextResponse.json({ error: 'Forbidden: Insufficient role' }, { status: 403 });
  }

  return { allowed: true, role };
}

/**
 * `verifyOrgAccess` that also admits a system admin (`roles` includes `'admin'`)
 * who is not a member of the organization.
 *
 * Only for the actions the Payload admin runs on a single document (retry,
 * receipt): an operator opens any tenant's transaction or delivery there and
 * must be able to act on it. It replaces the membership check only — the caller
 * must still prove the target resource belongs to `orgId`.
 */
export async function verifyOrgAccessOrSystemAdmin(
  payload: Payload,
  user: User,
  orgId: string,
  requiredRoles: Array<'owner' | 'admin' | 'member'> = ['owner', 'admin'],
): Promise<{ allowed: true } | NextResponse> {
  if (user.roles?.includes('admin')) return { allowed: true };
  return verifyOrgAccess(payload, user.id, orgId, requiredRoles);
}

/**
 * Fetches an app by ID, scoped to the user's organizations (BOLA protection).
 * Returns the app document and its orgId, or a 404 NextResponse.
 */
export async function fetchScopedApp(
  payload: Payload,
  userId: string,
  appId: string,
  select?: Record<string, boolean>,
) {
  const orgIds = await getUserOrgIds(payload, userId);

  if (orgIds.length === 0) {
    return { error: NextResponse.json({ error: 'No organizations found' }, { status: 403 }) };
  }

  const appResult = await payload.find({
    collection: 'apps',
    where: {
      and: [{ id: { equals: appId } }, { organization: { in: orgIds } }],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    ...(select ? { select } : {}),
  });

  if (appResult.totalDocs === 0) {
    return { error: NextResponse.json({ error: 'App not found' }, { status: 404 }) };
  }

  const app = appResult.docs[0];
  const orgId = typeof app.organization === 'object' ? (app.organization as any)?.id : (app.organization as string);

  return { app, orgId, orgIds };
}
