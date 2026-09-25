import type { Access, FieldAccess } from 'payload';

export const isAdmin: Access = ({ req: { user } }) => {
  // Safe check for admin role
  return Boolean(user?.roles?.includes('admin'));
};

export const isAdminFieldLevel: FieldAccess = ({ req: { user } }) => {
  return Boolean(user?.roles?.includes('admin'));
};

export const isAuthenticated: Access = ({ req: { user } }) => {
  return Boolean(user);
};

export const anyone: Access = () => true;

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

export const isAdminOrSelf: Access = ({ req: { user } }) => {
  if (!user) return false;
  if (user.roles?.includes('admin')) return true;

  return {
    id: {
      equals: user.id,
    },
  };
};

/**
 * Request-cached utility to fetch all organization memberships of a user.
 * Bypasses the 1000 limit entirely via pagination: false.
 */
async function getUserMemberships(req: any, payload: any, userId: string): Promise<any[]> {
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
