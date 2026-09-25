import { createId } from '@tuwaio/shared/cuid';
import { encrypt } from '@tuwaio/shared/encryption';
import type { CollectionConfig } from 'payload';
import { APIError } from 'payload';

import { MAX_LOGIN_ATTEMPTS } from '@/constants';
import { isAdminOrOwner } from '@/lib/access';
import { verifyTwoFactor } from '@/lib/two-factor-lock';
import type { User } from '@/payload-types';

import { ACCOUNT_DELETION_COOLDOWN_DAYS, TOKEN_EXPIRATION } from '../../../constants';

export const Users: CollectionConfig = {
  slug: 'users',
  disableDuplicate: true,
  auth: {
    tokenExpiration: TOKEN_EXPIRATION,
    maxLoginAttempts: MAX_LOGIN_ATTEMPTS,
    lockTime: 600 * 1000,
    cookies: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
    },
  },
  hooks: {
    beforeValidate: [
      async ({ data, originalDoc }) => {
        // Guard against enabling 2FA without a verified TOTP secret. Without
        // this, checking "2FA Enabled" directly in the admin (bypassing the
        // /api/v1/auth/2fa/generate -> enable flow) would set
        // twoFactorEnabled=true with an empty twoFactorSecret, and the next
        // login attempt (beforeLogin below) would demand an OTP code that
        // can never exist - a permanent, unrecoverable lockout, especially
        // dangerous in community edition (single admin, no email fallback).
        if (data?.twoFactorEnabled === true) {
          const hasSecret = Boolean(data?.twoFactorSecret) || Boolean((originalDoc as any)?.twoFactorSecret);
          if (!hasSecret) {
            throw new APIError(
              'Cannot enable 2FA without a verified TOTP secret. Use the 2FA setup flow (Settings > Security), ' +
                'not this checkbox directly - it never persists a secret on its own.',
              400,
            );
          }
        }
        return data;
      },
    ],
    beforeLogin: [
      async ({ req, user: userDoc }) => {
        const user = userDoc as unknown as User;
        if (req.context?.twoFactorVerified) return;
        if (user && user.twoFactorEnabled === true) {
          const otp = req.data?.otp || req.data?.twoFactorCode || req.headers?.get?.('x-quasar-2fa');
          if (!otp) throw new APIError('2FA_REQUIRED', 401);

          const res = await verifyTwoFactor({ userId: user.id, code: otp, userDoc: user });
          if (!res.isValid) {
            throw new APIError(res.error || 'INVALID_2FA_CODE', 401);
          }
        }
      },
    ],
    beforeChange: [
      async ({ data }) => {
        if (data.twoFactorSecret) data.twoFactorSecret = encrypt(data.twoFactorSecret);
        if (data.backupCode) data.backupCode = encrypt(data.backupCode);
        return data;
      },
      async ({ data, req, operation }) => {
        if (operation === 'create' && data?.email) {
          const cooldownLimit = new Date();
          cooldownLimit.setDate(cooldownLimit.getDate() - ACCOUNT_DELETION_COOLDOWN_DAYS);
          const recentDeletion = await req.payload.find({
            collection: 'deleted-accounts',
            where: {
              and: [
                { email: { equals: data.email } },
                { deletedAt: { greater_than_equal: cooldownLimit.toISOString() } },
              ],
            },
            limit: 1,
            overrideAccess: true,
          });
          if (recentDeletion.totalDocs > 0) {
            throw new Error(
              `Policy Violation: Cannot re-register within ${ACCOUNT_DELETION_COOLDOWN_DAYS} day${ACCOUNT_DELETION_COOLDOWN_DAYS > 1 ? 's' : ''} of account deletion.`,
            );
          }
        }
        return data;
      },
    ],
    afterChange: [
      async ({ doc, operation, req }) => {
        if (operation === 'create' && doc.id) {
          const startTime = Date.now();
          req.payload.logger.info(`[Users] Starting post-registration for ${doc.email} (${doc.id})...`);
          try {
            const org = await req.payload.create({
              collection: 'organizations',
              data: {
                name: 'Personal Workspace',
                slug: `personal-${doc.id}`,
                createdBy: doc.id,
                quotaBalance: 100,
                rpsLimit: 5,
                rpsPaidLimit: 5,
                quotaUsed: 0,
              },
              overrideAccess: true,
              req,
              context: { skipAuthCheck: true },
            });
            req.payload.logger.info(`[Users] Created Personal Workspace: ${org.id} (+${Date.now() - startTime}ms)`);

            const exists = await req.payload.find({
              collection: 'organization-members',
              where: {
                and: [{ organization: { equals: org.id } }, { user: { equals: doc.id } }],
              },
              limit: 1,
            });

            if (exists.totalDocs === 0) {
              await req.payload.create({
                collection: 'organization-members',
                data: {
                  organization: org.id,
                  user: doc.id,
                  role: 'owner',
                },
                overrideAccess: true,
                req,
                context: { skipAuthCheck: true },
              });
              req.payload.logger.info(`[Users] Created Owner Membership (+${Date.now() - startTime}ms)`);
            }
          } catch (err) {
            req.payload.logger.error(`[Users] Failed to auto-configure Personal Workspace: ${(err as Error).message}`);
            throw err;
          }
          req.payload.logger.info(
            `[Users] Post-registration complete for ${doc.id} (Total: ${Date.now() - startTime}ms)`,
          );
        }
      },
    ],
    beforeDelete: [
      async ({ req, id }) => {
        const doc = await req.payload.findByID({
          collection: 'users',
          id: id as string,
          depth: 0,
          req,
        });

        if (!doc) return;

        // 0. Protect Admins
        if (doc.roles?.includes('admin')) {
          throw new APIError(
            'Admins cannot delete their own accounts. Please demote the account to a standard user first.',
            403,
          );
        }

        // Set context to skip "last organization" check
        req.context.deletingUser = true;

        if (doc.email) {
          try {
            await req.payload.create({
              collection: 'deleted-accounts',
              data: {
                email: doc.email,
                originalId: doc.id,
                deletedAt: new Date().toISOString(),
              },
              overrideAccess: true,
              req,
            });
          } catch (err) {
            console.error('Failed to record deleted account:', err);
          }
        }

        try {
          const ownedMemberships = await req.payload.find({
            collection: 'organization-members',
            where: {
              and: [{ user: { equals: doc.id } }, { role: { equals: 'owner' } }],
            },
            limit: 100,
            depth: 0,
            req,
          });

          for (const membership of ownedMemberships.docs) {
            const orgId =
              typeof membership.organization === 'object' ? membership.organization.id : membership.organization;
            await req.payload.delete({
              collection: 'organizations',
              id: orgId,
              overrideAccess: true,
              req,
            });
          }

          await req.payload.delete({
            collection: 'organization-members',
            where: { user: { equals: doc.id } },
            overrideAccess: true,
            req,
          });
        } catch (err) {
          console.error('Failed to cascade delete user data:', err);
        }
      },
    ],
  },
  admin: {
    useAsTitle: 'email',
    group: 'User Management',
    defaultColumns: ['email', 'name', 'roles'],
    description:
      'This node runs on a single administrator account — the one created by the seed. Creating users is disabled: ' +
      'there is no sign-up form, no verification email and no password reset in this edition, so a second account ' +
      'would be unrecoverable the moment its password was lost. Change the email or password of the existing ' +
      'account instead.',
  },
  access: {
    read: isAdminOrOwner('id'),
    update: isAdminOrOwner('id'),
    delete: isAdminOrOwner('id'),
    // Community Edition is a single-admin node: the account the seed
    // creates is the only one, and there is no self-registration form,
    // no verification email and no password reset to support a second.
    create: () => false,
    admin: ({ req: { user } }) => user?.roles?.includes('admin') ?? false,
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
      label: 'Name',
    },
    {
      name: 'telegramUsername',
      type: 'text',
      label: 'Telegram Username',
      required: false,
    },
    {
      name: 'discordUsername',
      type: 'text',
      label: 'Discord Username',
      required: false,
    },
    {
      name: 'twoFactorEnabled',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Managed via the TOTP setup flow below - the checkbox itself is display-only.',
        components: {
          Field: '@/components/admin/TwoFactorSetupField',
        },
      },
    },
    {
      name: 'twoFactorSecret',
      type: 'text',
      admin: { hidden: true },
      access: {
        read: () => false,
      },
    },
    {
      name: 'backupCode',
      type: 'text',
      admin: { hidden: true },
      access: {
        read: () => false,
      },
    },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'User', value: 'user' },
      ],
      defaultValue: ['user'],
      required: true,
      saveToJWT: true,
      access: {
        update: ({ req: { user } }) => Boolean(user?.roles?.includes('admin')),
      },
    },
  ],
};
