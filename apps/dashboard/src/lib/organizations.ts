import type { Payload } from 'payload';

import type { OrganizationMember } from '@/payload-types';

/**
 * Get a user's role in a specific organization.
 * Returns null if the user is not a member.
 */
export const getUserOrgRole = async (
  payload: Payload,
  userId: string,
  orgId: string,
): Promise<'owner' | 'admin' | 'member' | null> => {
  const membership = await payload.find({
    collection: 'organization-members',
    where: {
      and: [{ organization: { equals: orgId } }, { user: { equals: userId } }],
    },
    limit: 1,
    depth: 0,
  });

  if (membership.totalDocs === 0) return null;

  const role = (membership.docs[0] as unknown as OrganizationMember).role;
  return role as 'owner' | 'admin' | 'member';
};

/**
 * Check if a user has one of the required roles in an organization.
 */
export const requireOrgRole = async (
  payload: Payload,
  userId: string,
  orgId: string,
  requiredRoles: Array<'owner' | 'admin' | 'member'>,
): Promise<{ allowed: boolean; role: 'owner' | 'admin' | 'member' | null }> => {
  const role = await getUserOrgRole(payload, userId, orgId);
  if (!role) return { allowed: false, role: null };
  return { allowed: requiredRoles.includes(role), role };
};
