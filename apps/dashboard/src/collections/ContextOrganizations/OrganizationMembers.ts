import { createId } from '@tuwaio/shared/cuid';
import type { CollectionConfig } from 'payload';

import { isMemberOfOrganization } from '@/lib/access';
import type { Organization, User } from '@/payload-types';

import { ORG_MEMBER_DELETION_COOLDOWN_HOURS } from '../../../constants';

export const OrganizationMembers: CollectionConfig = {
  slug: 'organization-members',
  disableDuplicate: true,
  admin: {
    group: 'Organizations',
    useAsTitle: 'role',
    defaultColumns: ['organization', 'user', 'role'],
    description:
      'Read-only in Community Edition. An organization here has exactly one member: the single administrator who ' +
      'created it, added automatically as owner. Membership cannot be granted or revoked because this edition has ' +
      'no second account to grant it to — no sign-up, no invitations, no email.',
  },
  indexes: [
    {
      fields: ['organization', 'user'],
      unique: true,
    },
  ],
  access: {
    read: isMemberOfOrganization,
    // Single-admin node: the only account that exists is already the
    // owner of every organization it creates, and there is no second
    // account to add. Writes are closed rather than merely refused so
    // the admin panel stops offering actions that cannot succeed.
    //
    // Provisioning is unaffected: every code path that writes a
    // membership — Organizations.afterChange, the Personal Workspace
    // hook in Users.afterChange, and both delete cascades — passes
    // overrideAccess: true explicitly, which never consults these gates.
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'id',
      type: 'text',
      unique: true,
      required: true,
      defaultValue: () => createId(),
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      options: [
        { label: 'Owner', value: 'owner' },
        { label: 'Admin', value: 'admin' },
        { label: 'Member', value: 'member' },
      ],
      defaultValue: 'member',
      validate: async (val: any, options: any) => {
        const { req, operation, id } = options;
        if (req.context?.skipAuthCheck) return true;
        if (operation === 'create' || operation === 'update') {
          if (val === 'owner') {
            const user = req.user as User | null;
            if (!user) return 'You must be logged in to assign roles.';

            // Global admins can do anything
            if (user.roles?.includes('admin')) return true;

            // Resolve organization context
            let orgId: string | undefined;

            if (operation === 'update' && id) {
              const doc = await req.payload.findByID({
                collection: 'organization-members',
                id: id as string,
                depth: 0,
              });
              orgId = typeof doc.organization === 'object' ? doc.organization.id : doc.organization;
            } else if (req.body && typeof req.body === 'object' && 'organization' in req.body) {
              orgId = req.body.organization as string;
            }

            if (!orgId) return 'Organization context missing';

            // Check if requester is an owner of the target organization
            const requesterMembership = await req.payload.find({
              collection: 'organization-members',
              where: {
                and: [
                  { organization: { equals: orgId } },
                  { user: { equals: user.id } },
                  { role: { equals: 'owner' } },
                ],
              },
              limit: 1,
              depth: 0,
            });

            if (requesterMembership.totalDocs === 0) {
              return 'Only the organization owner can assign the Owner role.';
            }
          }
        }
        return true;
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, req, operation }) => {
        if (operation === 'create') {
          const organizationId = data.organization;
          const userId = data.user;

          if (organizationId && userId) {
            // 1. Ensure uniqueness of [org, user] tuple
            const existing = await req.payload.find({
              collection: 'organization-members',
              where: {
                and: [{ organization: { equals: organizationId } }, { user: { equals: userId } }],
              },
              limit: 1,
            });

            if (existing.totalDocs > 0) {
              throw new Error('User is already a member of this organization.');
            }

            // 2. Check 24-hour cooldown after previous deletion
            const cooldownLimit = new Date();
            cooldownLimit.setHours(cooldownLimit.getHours() - ORG_MEMBER_DELETION_COOLDOWN_HOURS);

            const recentDeletion = await req.payload.find({
              collection: 'deleted-organization-members',
              where: {
                and: [
                  { organization: { equals: organizationId } },
                  { user: { equals: userId } },
                  { deletedAt: { greater_than_equal: cooldownLimit.toISOString() } },
                ],
              },
              limit: 1,
            });

            if (recentDeletion.totalDocs > 0) {
              throw new Error(
                `Policy Violation: This participant was recently removed. You can re-add them after ${ORG_MEMBER_DELETION_COOLDOWN_HOURS} hours.`,
              );
            }
          }
        }
        return data;
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        try {
          // Resolve IDs and Email for Audit Log and Email
          const oId = typeof doc.organization === 'object' ? (doc.organization as Organization).id : doc.organization;
          const uId = typeof doc.user === 'object' ? (doc.user as User).id : doc.user;

          let userEmail = '';

          // Fetch user details for audit and email
          const u = await req.payload.findByID({ collection: 'users', id: uId, depth: 0 });
          if (u) {
            userEmail = u.email;
          }


          // 1. Record in Audit Log
          if (userEmail && oId) {
            await req.payload.create({
              collection: 'deleted-organization-members',
              data: {
                organization: oId,
                user: uId,
                email: userEmail,
                deletedAt: new Date().toISOString(),
              },
              overrideAccess: true,
              req,
            });
          }

        } catch (e) {
          console.warn('Membership deletion cleanup failed:', e);
        }
      },
    ],
  },
};
