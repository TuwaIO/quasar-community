import { DATA_PROCESSING } from '@tuwaio/shared/constants';
import { createId } from '@tuwaio/shared/cuid';
import type { CollectionConfig } from 'payload';
import { APIError } from 'payload';

import {
  COMMUNITY_WORKSPACE_QUOTA_BALANCE,
  COMMUNITY_WORKSPACE_RPS_FOREVER,
  COMMUNITY_WORKSPACE_RPS_LIMIT,
} from '@/constants/community';
import { EDITION } from '@/constants/edition';
import {
  isAdminFieldLevel,
  isAuthenticated,
  isOrgAdminOrOwnerForOrg,
  isOrgMemberOrAdmin,
  isOrgOwnerForOrg,
} from '@/lib/access';
import { redisApi } from '@/lib/redis';
import type { User } from '@/payload-types';

import { ORG_DELETION_COOLDOWN_DAYS } from '../../../constants';

export const Organizations: CollectionConfig = {
  slug: 'organizations',
  disableDuplicate: true,
  admin: {
    group: 'Organizations',
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'createdAt'],
    description:
      'Workspaces that group apps under one quota balance and one RPS limit. The first is created together with the ' +
      'administrator account, and the administrator owns every organization created here. Quota and RPS are ' +
      'anti-runaway guard rails on this node, not billing: new organizations get the Community Edition limits, ' +
      'which are effectively unlimited and never expire. Deleting an organization removes its members, apps and ' +
      'transactions.',
  },
  access: {
    read: isOrgMemberOrAdmin,
    create: isAuthenticated,
    update: isOrgAdminOrOwnerForOrg,
    delete: isOrgOwnerForOrg,
  },
  hooks: {
    beforeValidate: [
      ({ data, operation }) => {
        if (operation === 'create' && data?.name && !data?.slug) {
          data.slug = data.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        }
        return data;
      },
    ],
    beforeChange: [
      async ({ data, req, operation }) => {
        if (operation === 'create') {
          // System creations (the seed, an import, the Personal Workspace of a new account) skip the limits of the
          // signed-in person: a system admin who creates an account in the admin panel is not its owner
          const userId = req.context?.skipAuthCheck ? undefined : req.user?.id;

          // Allow system/seed to create without user context, otherwise enforce
          if (!userId && !req.user && !req.context?.skipAuthCheck) throw new Error('Authentication required');

          if (userId) {
            // Check max 2 active orgs per user (as owner)
            const existingOrgs = await req.payload.find({
              collection: 'organization-members',
              where: {
                and: [{ user: { equals: userId } }, { role: { equals: 'owner' } }],
              },
              limit: 0,
            });

            if (existingOrgs.totalDocs >= 5) {
              throw new Error('Policy Violation: Maximum 5 organizations per account.');
            }

            // Check deletion cooldown
            const cooldownLimit = new Date();
            cooldownLimit.setDate(cooldownLimit.getDate() - ORG_DELETION_COOLDOWN_DAYS);

            const recentDeletions = await req.payload.find({
              collection: 'deleted-organizations',
              where: {
                and: [
                  { deletedBy: { equals: userId } },
                  { deletedAt: { greater_than_equal: cooldownLimit.toISOString() } },
                ],
              },
              limit: 1,
            });

            if (recentDeletions.totalDocs > 0) {
              throw new Error(
                `Policy Violation: Cannot create organization within ${ORG_DELETION_COOLDOWN_DAYS} day${ORG_DELETION_COOLDOWN_DAYS > 1 ? 's' : ''} of deleting one.`,
              );
            }

            // Auto-assign createdBy if not present
            if (!data.createdBy) {
              data.createdBy = userId;
            }
          }
        }
        return data;
      },
      // The statuses that open the intake after an agreement are set only by the data transfer workflow, with its
      // records; field access lets a system admin through, so the hook guards them
      ({ data, originalDoc, req }) => {
        const next = data?.dataProcessing;
        const byWorkflow = [DATA_PROCESSING.SCC, DATA_PROCESSING.NOT_REQUIRED] as string[];
        if (next && next !== originalDoc?.dataProcessing && byWorkflow.includes(next) && !req.context?.dataTransfer) {
          throw new APIError('Only the data transfer workflow sets this status.', 403);
        }
        return data;
      },
    ],
    afterChange: [
      async ({ doc, operation, previousDoc, req }) => {
        // Auto-create owner membership; a system creation names its owner itself
        if (operation === 'create' && req.user?.id && !req.context?.skipAuthCheck) {
          // Prevent recursion if this was triggered internally
          // Check if member already exists (double safety)
          const exists = await req.payload.find({
            collection: 'organization-members',
            where: {
              and: [{ organization: { equals: doc.id } }, { user: { equals: req.user.id } }],
            },
            limit: 1,
          });

          if (exists.totalDocs === 0) {
            await req.payload.create({
              collection: 'organization-members',
              data: {
                organization: doc.id,
                user: req.user.id,
                role: 'owner',
              },
              overrideAccess: true,
              req,
            });
          }

        }

        // --- Sync quotaBalance to Redis (Source of Truth) ---
        // Wrapped in executeRedisSafe with timeout: Redis instability must NEVER block the request pipeline.
        if (typeof doc.quotaBalance === 'number') {
          const { executeRedisSafe, getLimitKey } = await import('@/lib/redis');
          const balanceKey = getLimitKey(doc.id);

          await executeRedisSafe(
            redisApi.set(balanceKey, String(doc.quotaBalance), 'EX', 86400),
            2000,
            'Organizations-Sync',
          ).catch((err) => console.error('[Organizations] Redis sync failed:', (err as Error).message));
        }

        // --- RPS limit and data processing: EngineGuard caches them per app, not per organization ---
        // Covers an admin edit, the RPS adjust route and the seed raising a
        // workspace to its limits; without it the engine would keep the old
        // limit, or refuse or accept transactions, until each app's `{…}:meta`
        // entry expired.
        if (
          operation === 'update' &&
          (Number(previousDoc?.rpsLimit) !== Number(doc.rpsLimit) || previousDoc?.dataProcessing !== doc.dataProcessing)
        ) {
          const { bgRedisSync, invalidateOrganizationAppMetadata } = await import('@/lib/redis');
          bgRedisSync(req.payload.logger, 'Organizations-RpsSync', () =>
            invalidateOrganizationAppMetadata(req.payload, doc.id),
          );
        }
      },
    ],
    beforeDelete: [
      async ({ req, id }) => {
        // 0.1 Check if this is the user's last owned organization
        if (req.user?.id && !req.context?.skipAuthCheck) {
          // Find the membership for the current user and organization
          const currentMembership = await req.payload.find({
            collection: 'organization-members',
            where: {
              and: [{ organization: { equals: id } }, { user: { equals: req.user.id } }, { role: { equals: 'owner' } }],
            },
            limit: 1,
            req,
          });

          // Only proceed with the "last org" check if the user is an owner of THIS org
          if (currentMembership.totalDocs > 0) {
            const ownedOrgs = await req.payload.find({
              collection: 'organization-members',
              where: {
                and: [{ user: { equals: req.user.id } }, { role: { equals: 'owner' } }],
              },
              limit: 0,
              req,
            });

            if (ownedOrgs.totalDocs <= 1 && !req.context?.deletingUser) {
              throw new Error('You cannot delete your last organization. You must have at least one workspace.');
            }
          }
        }

        req.context = { ...req.context, cascadeDelete: true };

        // 1. Cascade delete all members
        await req.payload.delete({
          collection: 'organization-members',
          where: { organization: { equals: id } },
          overrideAccess: true,
          req,
        });

        // 2. Cascade delete Apps
        // (Hooks in Apps will handle related cascade deletions)
        await req.payload.delete({
          collection: 'apps',
          where: {
            organization: { equals: id },
          },
          overrideAccess: true,
          req,
        });

        // 5. Cascade delete transactions referencing this org directly
        await req.payload.delete({
          collection: 'transactions',
          where: { owner: { equals: id } },
          overrideAccess: true,
          req,
        });
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        // Safe userId extraction
        let userId: string | undefined;

        if (req.user) {
          userId = req.user.id;
        } else if (doc.createdBy) {
          const creator = doc.createdBy as User | string;
          userId = typeof creator === 'object' ? creator.id : creator;
        }

        // Record Audit Log
        if (userId) {
          await req.payload.create({
            collection: 'deleted-organizations',
            data: {
              deletedBy: userId,
              orgName: doc.name,
              originalId: doc.id, // CRITICAL: Store original ID
              deletedAt: new Date().toISOString(),
            },
            overrideAccess: true,
            req,
          });

        }

        // Cleanup Redis keys (limit and usage) upon organization deletion
        try {
          const { executeRedisSafe, getLimitKey } = await import('@/lib/redis');
          const balanceKey = getLimitKey(doc.id);
          const usageKey = `{${doc.id}}:usage`;

          await executeRedisSafe(
            Promise.all([redisApi.del(balanceKey), redisApi.del(usageKey)]),
            2000,
            'Organizations-Delete-Cleanup',
          );
        } catch (err) {
          console.error('[Organizations] Redis delete cleanup failed:', (err as Error).message);
        }
      },
    ],
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
      name: 'name',
      type: 'text',
      required: true,
      label: 'Organization Name',
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      label: 'URL Slug',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'createdBy',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'quotaBalance',
      type: 'number',
      defaultValue: COMMUNITY_WORKSPACE_QUOTA_BALANCE,
      required: true,
      access: {
        update: isAdminFieldLevel,
      },
      admin: {
        description: 'Available transaction quota for this organization.',
      },
    },
    {
      name: 'rpsLimit',
      type: 'number',
      defaultValue: COMMUNITY_WORKSPACE_RPS_LIMIT,
      required: true,
      access: {
        update: isAdminFieldLevel,
      },
      admin: {
        description: 'Global active requests per second (RPS) limit for all apps in this organization.',
      },
    },
    {
      name: 'rpsPaidLimit',
      type: 'number',
      defaultValue: COMMUNITY_WORKSPACE_RPS_LIMIT,
      required: true,
      access: {
        update: isAdminFieldLevel,
      },
      admin: {
        description: 'Maximum requests per second (RPS) limit the organization has paid for.',
      },
    },
    {
      name: 'rpsExpiresAt',
      type: 'date',
      access: {
        update: isAdminFieldLevel,
      },
      admin: {
        description: 'Unused in Community Edition: RPS never expires (rpsForever), and the expiration cron is not part of this edition.',
      },
    },
    {
      name: 'quotaUsed',
      type: 'number',
      defaultValue: 0,
      required: true,
      access: {
        update: isAdminFieldLevel,
      },
      admin: {
        description: 'Total quota consumed this billing cycle. Synced from Redis.',
      },
    },
    {
      name: 'rpsForever',
      type: 'checkbox',
      defaultValue: COMMUNITY_WORKSPACE_RPS_FOREVER,
      access: {
        update: isAdminFieldLevel,
      },
      admin: {
        description: 'If enabled, the RPS limit for this organization will never expire or reset.',
        position: 'sidebar',
      },
    },
    {
      // The engine refuses the organization's transactions while this is `pending` (Cloud edition only:
      // apps/server/src/common/data-processing.ts). Field access covers create as well, so nobody but a system admin
      // can open the intake by creating an organization with the field already set.
      name: 'dataProcessing',
      type: 'select',
      required: true,
      defaultValue: DATA_PROCESSING.PENDING,
      options: [
        { label: 'Pending: transactions are refused', value: DATA_PROCESSING.PENDING },
        { label: 'Own organization of the operator', value: DATA_PROCESSING.OWN },
        { label: 'Standard contractual clauses signed by both parties', value: DATA_PROCESSING.SCC },
        { label: 'Clauses not needed (reviewed)', value: DATA_PROCESSING.NOT_REQUIRED },
      ],
      access: {
        create: isAdminFieldLevel,
        update: isAdminFieldLevel,
      },
      admin: {
        position: 'sidebar',
        condition: () => EDITION === 'cloud',
        description:
          'Whether the apps of this organization may send transactions. Pending until the organization concludes the ' +
          'Data Processing Addendum, and the standard contractual clauses where they apply. Set "Own organization" ' +
          'only for organizations of the operator itself, which controls their data.',
      },
    },
    {
      // When a version of the Data Processing Addendum that the organization has not accepted takes effect; the engine
      // refuses its transactions from that time (apps/server/src/common/data-processing.ts). Written by the server
      // only, when a version is decided and when an owner accepts, so nobody sets it through the API.
      name: 'intakeClosesAt',
      type: 'date',
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        position: 'sidebar',
        readOnly: true,
        condition: () => EDITION === 'cloud',
        date: { pickerAppearance: 'dayAndTime' },
        description:
          'Set when a new version of the Data Processing Addendum that needs acceptance is decided, and cleared when ' +
          'an owner accepts it. From this time the apps of the organization cannot send transactions.',
      },
    },
    {
      name: 'keepWebhookResponses',
      type: 'checkbox',
      defaultValue: true,
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        position: 'sidebar',
        readOnly: true,
        condition: () => EDITION === 'cloud',
        description:
          'Whether the engine keeps the bodies of the responses of this organization’s webhook endpoints (up to ' +
          '1,000 characters, 3 months). Off when the clauses in force allow only the status of each response to be kept.',
      },
    },
  ],
};
