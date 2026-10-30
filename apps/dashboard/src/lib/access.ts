import type { Access, CollectionBeforeChangeHook, FieldAccess } from 'payload';
import { APIError } from 'payload';

export const isAdmin: Access = ({ req: { user } }) => {
  // Safe check for admin role
  return Boolean(user?.roles?.includes('admin'));
};

export const isAdminFieldLevel: FieldAccess = ({ req: { user } }) => {
  return Boolean(user?.roles?.includes('admin'));
};

/** Field access for the fields that say whose a row is: written on create, never on an update. */
export const neverOnUpdate: FieldAccess = () => false;

const relationId = (value: unknown): string | null | undefined =>
  typeof value === 'object' && value !== null ? String((value as { id: unknown }).id) : (value as string | null);

/**
 * A `beforeChange` hook that refuses an update moving a row to another owner (an organization, an account, an app).
 * Payload applies the where-query of an access function to the stored row, never to the data an update writes, so an
 * organization-scoped update once moved a membership with its role into any organization (security report
 * 2026-10-30). The field access {@link neverOnUpdate} strips these fields for REST callers; this hook also holds for
 * the Local API with `overrideAccess`, where field access is skipped.
 *
 * @param fields - The relationship fields that must keep the value they were created with.
 * @returns The hook; it throws a 403 `APIError` when an update changes one of the fields.
 */
export const keepOwnerFields =
  (fields: string[]): CollectionBeforeChangeHook =>
  ({ data, operation, originalDoc }) => {
    if (operation !== 'update' || !originalDoc || !data) return data;
    for (const field of fields) {
      if (!(field in data) || data[field] === undefined) continue;
      if (relationId(data[field]) !== relationId(originalDoc[field])) {
        throw new APIError(`The ${field} of this record cannot be changed.`, 403);
      }
    }
    return data;
  };

export const isAuthenticated: Access = ({ req: { user } }) => {
  return Boolean(user);
};

export const isAdminOrOwner =
  (field: string = 'user'): Access =>
  ({ req: { user } }) => {
    if (!user) return false;
    if (user.roles?.includes('admin')) return true;

    return {
      [field]: {
        equals: user.id,
      },
    };
  };

/**
 * Request-cached utility to fetch all organization memberships of a user.
 * Bypasses the 1000 limit entirely via pagination: false.
 */
export async function getUserMemberships(req: any, payload: any, userId: string): Promise<any[]> {
  if (!req.userMemberships) {
    const res = await payload.find({
      collection: 'organization-members',
      where: {
        user: {
          equals: userId,
        },
      },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    });
    req.userMemberships = res.docs || [];
  }
  return req.userMemberships;
}

/**
 * Access control for Organizations.
 * Allows access if:
 * 1. User is a global Admin
 * 2. User is a member of the organization (via organization-members collection)
 */
export const isOrgMemberOrAdmin: Access = async ({ req }) => {
  const { user, payload } = req;
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;

  // Find all organizations where this user is a member
  const memberships = await getUserMemberships(req, payload, user.id);
  const orgIds = memberships.map((m) => (typeof m.organization === 'object' ? m.organization.id : m.organization));

  if (orgIds.length === 0) return false;

  return {
    id: {
      in: orgIds,
    },
  };
};

/**
 * Generic access control for any collection with an 'organization' field.
 */
export const isMemberOfOrganization: Access = async ({ req }) => {
  const { user, payload } = req;
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;

  const memberships = await getUserMemberships(req, payload, user.id);
  const orgIds = memberships.map((m) => (typeof m.organization === 'object' ? m.organization.id : m.organization));

  if (orgIds.length === 0) return false;

  return {
    organization: {
      in: orgIds,
    },
  };
};

/**
 * Access control for collections linked to an App (which is linked to an Org).
 * Example: Webhooks, Transactions (if they have an 'app' field).
 */
export const isMemberOfAppOrganization: Access = async ({ req }) => {
  const { user, payload } = req;
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;

  const memberships = await getUserMemberships(req, payload, user.id);
  const orgIds = memberships.map((m) => (typeof m.organization === 'object' ? m.organization.id : m.organization));

  if (orgIds.length === 0) return false;

  return {
    'app.organization': {
      in: orgIds,
    },
  };
};

/**
 * Access control for WebhookDeliveries.
 * Checks depth: endpoint -> app -> organization
 */
export const isMemberOfEndpointOrganization: Access = async ({ req }) => {
  const { user, payload } = req;
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;

  const memberships = await getUserMemberships(req, payload, user.id);
  const orgIds = memberships.map((m) => (typeof m.organization === 'object' ? m.organization.id : m.organization));

  if (orgIds.length === 0) return false;

  return {
    'endpoint.app.organization': {
      in: orgIds,
    },
  };
};

/**
 * Access control for Organization Admins and Owners.
 * Used to restrict sensitive operations like member management.
 */
export const isOrgAdminOrOwner: Access = async ({ req }) => {
  const { user, payload } = req;
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;

  // Find organizations where the current user is an admin or owner
  const memberships = await getUserMemberships(req, payload, user.id);
  const orgIds = memberships
    .filter((m) => m.role === 'admin' || m.role === 'owner')
    .map((m) => (typeof m.organization === 'object' ? m.organization.id : m.organization));

  if (orgIds.length === 0) return false;

  return {
    organization: {
      in: orgIds,
    },
  };
};

/**
 * Access control scoped to the `organization` field.
 * Restricts writes to members with the 'owner' role only.
 * Use for sensitive tenant collections like AppAcceptedPayments.
 */
export const isOrgOwner: Access = async ({ req }) => {
  const { user, payload } = req;
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;

  const memberships = await getUserMemberships(req, payload, user.id);
  const orgIds = memberships
    .filter((m) => m.role === 'owner')
    .map((m) => (typeof m.organization === 'object' ? m.organization.id : m.organization));

  if (orgIds.length === 0) return false;

  return {
    organization: {
      in: orgIds,
    },
  };
};

export const isOrgOwnerForOrg: Access = async ({ req }) => {
  const { user, payload } = req;
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;

  const memberships = await getUserMemberships(req, payload, user.id);
  const orgIds = memberships
    .filter((m) => m.role === 'owner')
    .map((m) => (typeof m.organization === 'object' ? m.organization.id : m.organization));

  if (orgIds.length === 0) return false;

  return {
    id: {
      in: orgIds,
    },
  };
};

export const isOrgAdminOrOwnerForOrg: Access = async ({ req }) => {
  const { user, payload } = req;
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;

  const memberships = await getUserMemberships(req, payload, user.id);
  const orgIds = memberships
    .filter((m) => m.role === 'admin' || m.role === 'owner')
    .map((m) => (typeof m.organization === 'object' ? m.organization.id : m.organization));

  if (orgIds.length === 0) return false;

  return {
    id: {
      in: orgIds,
    },
  };
};

export const isAppOrgAdminOrOwner: Access = async ({ req }) => {
  const { user, payload } = req;
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;

  const memberships = await getUserMemberships(req, payload, user.id);
  const orgIds = memberships
    .filter((m) => m.role === 'admin' || m.role === 'owner')
    .map((m) => (typeof m.organization === 'object' ? m.organization.id : m.organization));

  if (orgIds.length === 0) return false;

  return {
    'app.organization': {
      in: orgIds,
    },
  };
};
