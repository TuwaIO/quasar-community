import { QUOTA_DEFAULTS } from '@tuwaio/shared/constants';
import { createId } from '@tuwaio/shared/cuid';
import { encrypt } from '@tuwaio/shared/encryption';
import { assertSafeOutboundUrl, outboundUrlPolicyFromEnv, UnsafeUrlError } from '@tuwaio/shared/ssrf';
import crypto from 'crypto';
import type { CollectionConfig } from 'payload';
import { APIError } from 'payload';

import { isMemberOfOrganization, isOrgAdminOrOwner } from '@/lib/access';
import { redisApi } from '@/lib/redis';
import type { App } from '@/payload-types';

// Dot-separated labels. The engine puts the name in front of `.quiknode.pro`, so any character
// that ends a host (`/`, `#`, `?`, `@`, `:`) would let it replace the host: `169.254.169.254#`
// sends the tracker to the cloud metadata service.
const QUICKNODE_APP_NAME = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i;

const generateKey = (prefix: string) => {
  const buffer = crypto.randomBytes(24);
  return `${prefix}${buffer.toString('hex')}`;
};

export const Apps: CollectionConfig = {
  slug: 'apps',
  disableDuplicate: true,
  admin: {
    useAsTitle: 'name',
    group: 'Product',
    defaultColumns: ['name', 'environment', 'organization', 'isActive'],
    description:
      'An app is one integration of an organization with the engine: it owns the API key pair (pk_/sk_) the SDK ' +
      'signs requests with, the IP/domain whitelists, and optional bring-your-own RPC keys. Transactions and ' +
      'webhook endpoints hang off an app, and deleting it removes them too. Environment sets the quota price per ' +
      'tracked transaction (test costs half of live) and, at creation, the key prefix. Up to 30 apps per ' +
      'organization.',
  },
  access: {
    read: isMemberOfOrganization,
    create: isOrgAdminOrOwner,
    update: isOrgAdminOrOwner,
    delete: isOrgAdminOrOwner,
  },
  fields: [
    // First field on purpose: it is the master switch for the whole app, and
    // the one an operator reaches for during an incident. Buried between the
    // RPC arrays it was the last thing visible on the form.
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      label: 'Active',
      index: true,
      admin: {
        description:
          'Master switch. While this is off the engine rejects every request signed with this app’s keys (HTTP 403 “App is disabled”): ' +
          'no transactions are tracked and no webhooks are dispatched. Existing data is kept untouched.',
      },
    },
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
      label: 'App Name',
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
    },
    {
      name: 'environment',
      type: 'select',
      required: true,
      defaultValue: 'test',
      options: [
        { label: 'Live', value: 'live' },
        { label: 'Test', value: 'test' },
      ],
      index: true,
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'basic',
      options: [
        { label: 'Basic', value: 'basic' },
        // TODO(payments): under active development. The option stays declared
        // so the generated types and the stored schema keep both values, but
        // it cannot be picked: AppKindField renders it as a disabled entry,
        // and the validator below rejects it for any caller that bypasses the
        // admin UI.
        { label: 'Payments (coming soon)', value: 'payments' },
      ],
      index: true,
      admin: {
        description: 'Determines the feature set enabled for this app.',
        components: {
          Field: '@/components/admin/AppKindField#AppKindField',
        },
      },
      validate: (value: unknown) => {
        if (value === 'payments') {
          return 'Active development of this module is underway, currently not available';
        }
        return true;
      },
    },
    {
      name: 'publicKey',
      type: 'text',
      unique: true,
      index: true,
      label: 'Public Key',
      admin: {
        readOnly: true,
        description: 'Safe to share (pk_live_...). Used for client-side identification.',
      },
    },
    {
      name: 'secretKey',
      type: 'text',
      unique: true,
      index: true,
      label: 'Secret Key',
      admin: {
        readOnly: true,
        description: 'CRITICAL: sk_live_... Reveal via password + 2FA step-up below.',
        components: {
          Field: '@/components/admin/SecretField',
        },
      },
    },
    {
      name: 'secretKeyHash',
      type: 'text',
      hidden: true,
      index: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'ipWhitelist',
      type: 'array',
      label: 'IP Whitelist',
      fields: [
        {
          name: 'ip',
          type: 'text',
          required: true,
        },
      ],
      admin: {
        description: 'Allow requests only from these IP addresses. Leave empty to allow all.',
      },
    },
    {
      name: 'domainsWhitelist',
      type: 'array',
      label: 'Domain Whitelist',
      fields: [
        {
          name: 'domain',
          type: 'text',
          required: true,
        },
      ],
      admin: {
        description: 'Allow requests only from these domains/origins. Leave empty to allow all.',
      },
    },
    {
      name: 'rpcConfigs',
      type: 'array',
      label: 'Custom RPC Configurations',
      admin: {
        readOnly: true,
      },
      fields: [
        {
          name: 'chainId',
          type: 'text',
          required: true,
        },
        {
          name: 'rpcUrl',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'alchemyApiKey',
      type: 'text',
      label: 'Alchemy API Key',
      admin: {
        description: 'Optional. Bring your own Alchemy key for this specific app.',
        components: {
          Field: {
            path: '@/components/admin/MaskedSecretField',
            clientProps: { label: 'Alchemy API Key', previewKey: 'alchemyApiKey' },
          },
        },
      },
    },
    {
      name: 'quickNodeApiKey',
      type: 'text',
      label: 'QuickNode API Key',
      admin: {
        description:
          'Optional. URL or token. Applied if Alchemy is not configured. ' +
          'A URL must point to a public host (https:// in production). ' +
          'A bare token also requires QuickNode App Name below — the endpoint URL is built from the two together.',
        components: {
          Field: {
            path: '@/components/admin/MaskedSecretField',
            clientProps: { label: 'QuickNode API Key', previewKey: 'quickNodeApiKey' },
          },
        },
      },
    },
    {
      name: 'quickNodeAppName',
      type: 'text',
      label: 'QuickNode App Name',
      admin: {
        description:
          'Required once a QuickNode API Key is set. The subdomain of your QuickNode endpoint — for ' +
          'https://my-app.quiknode.pro/<token>/ this is "my-app".',
      },
      // The engine builds the endpoint as `https://${appName}.quiknode.pro/${key}/`
      // and both tracker call sites gate on `key && appName`
      // (apps/server/src/tracking/trackers/{pimlico,solana}.ts). With only the
      // key filled in, QuickNode is skipped in silence: no error anywhere, the
      // app just falls through to the next RPC source, and the operator is left
      // believing they configured a provider that was never used.
      validate: (value: unknown, { siblingData }: { siblingData?: Record<string, unknown> }) => {
        if (typeof value === 'string' && value !== '' && !QUICKNODE_APP_NAME.test(value)) {
          return 'Letters, digits, hyphens, underscores and dots only: the part of your QuickNode endpoint before .quiknode.pro.';
        }
        const key = siblingData?.quickNodeApiKey;
        if (!key) return true;
        // A full URL carries its own host, so no subdomain is needed.
        if (typeof key === 'string' && key.startsWith('http')) return true;
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          return 'Required when a QuickNode API Key is set, unless the key is itself a full https:// endpoint URL.';
        }
        return true;
      },
    },
    {
      name: 'gelatoApiKey',
      type: 'text',
      label: 'Gelato API Key (System)',
      admin: {
        description: 'Optional. Used for Gelato relay tracking.',
        components: {
          Field: {
            path: '@/components/admin/MaskedSecretField',
            clientProps: { label: 'Gelato API Key (System)', previewKey: 'gelatoApiKey' },
          },
        },
      },
    },
    {
      name: 'pimlicoApiKey',
      type: 'text',
      label: 'Pimlico API Key',
      admin: {
        description: 'Optional. Used for Pimlico ERC-4337 bundler and paymaster tracking.',
        components: {
          Field: {
            path: '@/components/admin/MaskedSecretField',
            clientProps: { label: 'Pimlico API Key', previewKey: 'pimlicoApiKey' },
          },
        },
      },
    },
    {
      name: 'paymentSettings',
      type: 'group',
      label: 'Payment Settings',
      admin: {
        condition: (data) => data?.kind === 'payments',
        description: 'Configuration for the Payments app kind.',
      },
      fields: [
        {
          name: 'amlEnabled',
          type: 'checkbox',
          defaultValue: false,
          label: 'Enable AML Screening',
          admin: {
            description: 'If enabled, incoming payment transactions will be screened via GoPlus Labs.',
          },
        },
        {
          name: 'goPlusApiKey',
          type: 'text',
          label: 'GoPlus API Key (User)',
          admin: {
            condition: (data) => data?.paymentSettings?.amlEnabled === true,
            description: `Optional. Your own GoPlus Labs API Key. If blank, the system fallback key is used (+${QUOTA_DEFAULTS.FALLBACK_AML_WEIGHT} quota/tx).`,
            components: {
              Field: {
                path: '@/components/admin/MaskedSecretField',
                clientProps: { label: 'GoPlus API Key (User)', previewKey: 'paymentSettings.goPlusApiKey' },
              },
            },
          },
        },
        {
          name: 'goPlusApiSecret',
          type: 'text',
          label: 'GoPlus API Secret (User)',
          admin: {
            condition: (data) => data?.paymentSettings?.amlEnabled === true,
            description: 'Optional. Your own GoPlus Labs API Secret.',
            components: {
              Field: {
                path: '@/components/admin/MaskedSecretField',
                clientProps: { label: 'GoPlus API Secret (User)', previewKey: 'paymentSettings.goPlusApiSecret' },
              },
            },
          },
        },
        {
          name: 'appInvoiceTemplate',
          type: 'json',
          label: 'Invoice Template',
          validate: () => true,
          admin: {
            description: 'PDF template configuration for @pdfme/generator.',
          },
        },
      ],
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, req, operation, originalDoc }) => {
        const isMasked = (val?: string | null) => {
          if (!val) return false;
          return val.includes('...') || val === '********';
        };

        if (operation === 'update' && originalDoc) {
          if (isMasked(data.alchemyApiKey)) {
            data.alchemyApiKey = originalDoc.alchemyApiKey;
          }
          if (isMasked(data.quickNodeApiKey)) {
            data.quickNodeApiKey = originalDoc.quickNodeApiKey;
          }
          if (isMasked(data.gelatoApiKey)) {
            data.gelatoApiKey = originalDoc.gelatoApiKey;
          }
          if (isMasked(data.pimlicoApiKey)) {
            data.pimlicoApiKey = originalDoc.pimlicoApiKey;
          }
          // Preserve masked GoPlus payment credentials
          if (data.paymentSettings) {
            if (isMasked(data.paymentSettings.goPlusApiKey)) {
              data.paymentSettings.goPlusApiKey = originalDoc.paymentSettings?.goPlusApiKey;
            }
            if (isMasked(data.paymentSettings.goPlusApiSecret)) {
              data.paymentSettings.goPlusApiSecret = originalDoc.paymentSettings?.goPlusApiSecret;
            }
          }
          if (data.rpcConfigs && originalDoc.rpcConfigs) {
            data.rpcConfigs = data.rpcConfigs.map((config: any) => {
              let rpcUrl = config.rpcUrl;
              if (isMasked(rpcUrl)) {
                const existing = originalDoc.rpcConfigs.find((ex: any) => ex.chainId === config.chainId);
                if (existing) {
                  rpcUrl = existing.rpcUrl;
                }
              }
              return { ...config, rpcUrl };
            });
          }
        }

        if (operation === 'create') {
          // Enforce limit of 30 apps per organization
          const orgId = typeof data.organization === 'object' ? data.organization?.id : data.organization;
          if (orgId) {
            const existingAppsCount = await req.payload.count({
              collection: 'apps',
              where: {
                organization: { equals: orgId },
              },
            });
            if (existingAppsCount.totalDocs >= 30) {
              throw new Error('Maximum limit of 30 applications per organization has been reached.');
            }
          }

          const prefix = data.environment === 'live' ? 'live_' : 'test_';
          if (!data.publicKey) data.publicKey = generateKey(`pk_${prefix}`);
          if (!data.secretKey) data.secretKey = generateKey(`sk_${prefix}`);
        }

        // The engine sends JSON-RPC to these URLs from inside the cluster. Refuse private and
        // loopback hosts here, where the admin sees why, rather than leave the tracker to skip
        // them. A value that still starts with `qenc:` was kept from the stored document.
        const outboundPolicy = outboundUrlPolicyFromEnv();
        const assertPublicUrl = async (value: unknown, label: string) => {
          if (typeof value !== 'string' || value.startsWith('qenc:')) return;
          try {
            await assertSafeOutboundUrl(value, outboundPolicy);
          } catch (error) {
            if (error instanceof UnsafeUrlError) throw new APIError(`${label} rejected: ${error.message}.`, 400);
            throw error;
          }
        };
        for (const config of data.rpcConfigs ?? []) {
          await assertPublicUrl(config?.rpcUrl, `RPC URL for chain ${config?.chainId}`);
        }
        if (typeof data.quickNodeApiKey === 'string' && data.quickNodeApiKey.startsWith('http')) {
          await assertPublicUrl(data.quickNodeApiKey, 'QuickNode endpoint URL');
        }

        // Encrypt sensitive fields
        if (data.rpcConfigs) {
          data.rpcConfigs = data.rpcConfigs.map((config: any) => ({
            ...config,
            rpcUrl: encrypt(config.rpcUrl),
          }));
        }
        if (data.alchemyApiKey) data.alchemyApiKey = encrypt(data.alchemyApiKey);
        if (data.quickNodeApiKey) data.quickNodeApiKey = encrypt(data.quickNodeApiKey);
        if (data.gelatoApiKey) data.gelatoApiKey = encrypt(data.gelatoApiKey);
        if (data.pimlicoApiKey) data.pimlicoApiKey = encrypt(data.pimlicoApiKey);

        // Encrypt GoPlus payment credentials
        if (data.paymentSettings?.goPlusApiKey) {
          data.paymentSettings.goPlusApiKey = encrypt(data.paymentSettings.goPlusApiKey);
        }
        if (data.paymentSettings?.goPlusApiSecret) {
          data.paymentSettings.goPlusApiSecret = encrypt(data.paymentSettings.goPlusApiSecret);
        }

        // Protect Secret Key: Hash for lookup + Encrypt for storage
        if (data.secretKey && !data.secretKey.startsWith('qenc:')) {
          data.secretKeyHash = crypto.createHash('sha256').update(data.secretKey).digest('hex');
          data.secretKey = encrypt(data.secretKey);
        }

        return data;
      },
    ],
    afterRead: [
      async ({ doc }) => {
        // Sensitive fields are kept encrypted for security.
        // nest_server handles decryption internally.
        return doc;
      },
    ],
    afterChange: [
      async ({ doc, operation, req }) => {
        const appDoc = doc as unknown as App;

        if (operation === 'create' || operation === 'update') {
          const { bgRedisSync } = await import('@/lib/redis');
          const secretKeyHash = appDoc.secretKeyHash;
          const publicKey = appDoc.publicKey;

          bgRedisSync(req.payload.logger, 'Apps-Sync', async () => {
            const pipeline = redisApi.pipeline();

            // 1. Invalidate both Public and Secret key metadata cache
            if (secretKeyHash) pipeline.del(`{${secretKeyHash}}:meta`);
            if (publicKey) pipeline.del(`{${publicKey}}:meta`);

            // 2. Sync shared organizational quota
            const ownerId = typeof appDoc.organization === 'object' ? appDoc.organization?.id : appDoc.organization;
            if (ownerId) {
              const { getLimitKey } = await import('@/lib/redis');
              const org = await req.payload.findByID({
                collection: 'organizations',
                id: ownerId as string,
                depth: 0,
                req,
              });

              if (org && typeof org.quotaBalance === 'number') {
                pipeline.set(getLimitKey(ownerId as string), String(org.quotaBalance), 'EX', 86400);
              }
            }

            await pipeline.exec();
          });
        }


        return doc;
      },
    ],
    beforeDelete: [
      async ({ req, id }) => {
        // Cascade delete Transactions
        await req.payload.delete({
          collection: 'transactions',
          where: { app: { equals: id } },
          overrideAccess: true,
          req,
        });

        // Cascade delete WebhookEndpoints
        await req.payload.delete({
          collection: 'webhook-endpoints',
          where: { app: { equals: id } },
          overrideAccess: true,
          req,
        });

        // Cascade delete AppInvoices (Payments app kind)
        await req.payload.delete({
          collection: 'app-invoices',
          where: { app: { equals: id } },
          overrideAccess: true,
          req,
        });

        // Cascade delete AppAcceptedPayments (Payments app kind)
        await req.payload.delete({
          collection: 'app-accepted-payments',
          where: { app: { equals: id } },
          overrideAccess: true,
          req,
        });
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        const appDoc = doc as unknown as App;
        const secretKeyHash = appDoc.secretKeyHash;
        const publicKey = appDoc.publicKey;

        if (secretKeyHash || publicKey) {
          const { bgRedisSync } = await import('@/lib/redis');

          bgRedisSync(req.payload.logger, 'Apps-Cleanup', async () => {
            const pipeline = redisApi.pipeline();

            if (secretKeyHash) pipeline.del(`{${secretKeyHash}}:meta`);
            pipeline.del(`{${appDoc.id}}:notified_low_quota`);

            if (publicKey) {
              pipeline.del(`{${publicKey}}:meta`);
            }
            await pipeline.exec();
          });
        }

      },
    ],
  },
};
