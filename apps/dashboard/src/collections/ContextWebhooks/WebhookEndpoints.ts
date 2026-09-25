import { createId } from '@tuwaio/shared/cuid';
import { encrypt } from '@tuwaio/shared/encryption';
import crypto from 'crypto';
import type { CollectionConfig } from 'payload';

/**
 * Generates a cryptographically secure webhook signing secret.
 * Prefix `whsec_` follows industry convention (Stripe-style).
 */
const generateSigningSecret = (): string => {
  const buffer = crypto.randomBytes(32);
  return `whsec_${buffer.toString('hex')}`;
};

import { isAdminFieldLevel, isAppOrgAdminOrOwner, isMemberOfAppOrganization } from '@/lib/access';
import { isLocalhostUrl } from '@/lib/webhook-utils';

/**
 * WebhookEndpoints Collection
 *
 * Stores destination URLs where the system dispatches HTTP POST callbacks
 * when subscribed events occur. Each endpoint is scoped to a specific API key
 * (project/tenant) and carries an HMAC signing secret for payload verification.
 */
export const WebhookEndpoints: CollectionConfig = {
  slug: 'webhook-endpoints',
  disableDuplicate: true,
  admin: {
    useAsTitle: 'url',
    group: 'Product',
    defaultColumns: ['url', 'app', 'events', 'isActive', 'isSystemWebhook', 'createdAt'],
    description:
      'URLs the engine POSTs to when a tracked transaction of an app changes state. Each endpoint gets its own ' +
      'auto-generated signing secret, so the receiver can verify the payload came from Quasar. Every delivery ' +
      'attempt costs quota and is logged under Webhook Deliveries. Production requires HTTPS; one localhost ' +
      'endpoint per organization is allowed for local development.',
  },
  access: {
    read: isMemberOfAppOrganization,
    create: isAppOrgAdminOrOwner,
    update: isAppOrgAdminOrOwner,
    delete: isAppOrgAdminOrOwner,
  },
  fields: [
    // First field on purpose: the switch an operator reaches for when an
    // endpoint starts misbehaving. It used to sit below the secret and the
    // event list, which is the wrong end of the form for a kill switch.
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      label: 'Active',
      admin: {
        description: 'Inactive endpoints are skipped by the dispatcher: no deliveries, no retries, no quota spent.',
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
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      required: true,
      hasMany: false,
      index: true,
      admin: {
        description: 'The App (tenant environment) this webhook endpoint belongs to.',
      },
    },
    {
      name: 'url',
      type: 'text',
      required: true,
      label: 'Endpoint URL',
      validate: (value: string | null | undefined) => {
        if (!value) return 'URL is required.';
        try {
          const parsed = new URL(value);
          const isLocalhost = isLocalhostUrl(value);

          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return 'URL must use HTTPS or HTTP.';
          }

          if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:' && !isLocalhost) {
            return 'Production webhooks must use HTTPS (HTTP is only permitted for localhost development endpoints).';
          }

          return true;
        } catch {
          return 'Must be a valid URL.';
        }
      },
      admin: {
        description:
          'The destination URL for webhook delivery. HTTPS required in production, except for single local development endpoint (localhost).',
      },
    },
    {
      name: 'signingSecret',
      type: 'text',
      required: true,
      unique: true,
      label: 'Signing Secret',
      admin: {
        readOnly: true,
        description:
          'HMAC signing secret (whsec_...). Auto-generated on creation. Reveal via password + 2FA step-up below.',
        components: {
          Field: '@/components/admin/WebhookSecretField',
        },
      },
    },
    {
      name: 'events',
      type: 'select',
      hasMany: true,
      required: true,
      defaultValue: ['*'],
      options: [
        { label: 'All Events', value: '*' },
        { label: 'Transaction: Success', value: 'transaction:success' },
        { label: 'Transaction: Failed', value: 'transaction:failed' },
        { label: 'Transaction: Replaced', value: 'transaction:replaced' },
      ],
      admin: {
        description: 'Events that trigger delivery to this endpoint. Use "*" to subscribe to all.',
      },
    },
    {
      name: 'isSystemWebhook',
      type: 'checkbox',
      defaultValue: false,
      label: 'System Webhook',
      // Community Edition has no system-webhook queue, so this can never
      // be turned on - see open-source-plans/09-server-audit.md.
      access: { read: isAdminFieldLevel, create: () => false, update: () => false },
      admin: {
        hidden: true,
        readOnly: true,
        description: 'Not available in Community Edition.',
      },
    },
    {
      name: 'description',
      type: 'text',
      label: 'Description',
      admin: {
        description: 'Optional human-readable label for this endpoint.',
      },
    },
    // Required, with `*` as the explicit "every type" value.
    //
    // It was optional, and leaving it blank was the trap: Payload stores an
    // untouched text field as NULL, while the dispatcher matches
    // `tx_type = <type> OR tx_type = ''` — and in SQL neither comparison is
    // true for NULL. An endpoint created through the admin without typing
    // anything here therefore received **nothing at all**, silently, while the
    // description promised the opposite. Forcing a value removes the state
    // that had no correct reading.
    {
      name: 'txType',
      type: 'text',
      required: true,
      defaultValue: '*',
      label: 'Transaction Type Filter',
      admin: {
        description:
          'Which transaction types reach this endpoint. Use * for all of them, or an exact type string — the ' +
          'same value the SDK sends as `type` on the transaction (e.g. "transfer"). Matching is exact, not a pattern.',
      },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || value.trim() === '') {
          return 'Required. Use * to receive every transaction type.';
        }
        return true;
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, req, operation, originalDoc }) => {
        const isGlobalAdmin = !req.user || Boolean(req.user.roles?.includes('admin'));
        if (
          !isGlobalAdmin &&
          ((operation === 'create' && data.isSystemWebhook === true) ||
            (operation !== 'create' &&
              data.isSystemWebhook !== undefined &&
              data.isSystemWebhook !== originalDoc?.isSystemWebhook))
        ) {
          throw new Error('Only global administrators can change system webhook status.');
        }

        if (operation === 'create') {
          // Enforce limit of 500 webhooks per app
          const appId = typeof data.app === 'object' ? data.app?.id : data.app;
          if (appId) {
            const existingWebhooksCount = await req.payload.count({
              collection: 'webhook-endpoints',
              where: {
                app: { equals: appId },
              },
            });
            if (existingWebhooksCount.totalDocs >= 500) {
              throw new Error('Maximum limit of 500 webhook endpoints per application has been reached.');
            }
          }

          // Auto-generate signing secret on creation
          if (!data.signingSecret) {
            data.signingSecret = generateSigningSecret();
          }
        }

        // Enforce maximum of 1 localhost webhook per organization
        const candidateUrl = data.url ?? originalDoc?.url;
        if (candidateUrl && isLocalhostUrl(candidateUrl)) {
          const targetAppId = typeof data.app === 'object' ? data.app?.id : data.app || originalDoc?.app;
          const currentEndpointId = originalDoc?.id || data.id;

          if (targetAppId) {
            const appDoc = await req.payload.findByID({
              collection: 'apps',
              id: typeof targetAppId === 'object' ? targetAppId.id : targetAppId,
              depth: 0,
            });

            const orgId = typeof appDoc?.organization === 'object' ? appDoc?.organization.id : appDoc?.organization;

            if (orgId) {
              const existingOrgWebhooks = await req.payload.find({
                collection: 'webhook-endpoints',
                where: {
                  'app.organization': { equals: orgId },
                },
                depth: 0,
                limit: 200,
              });

              const otherLocalhost = existingOrgWebhooks.docs.find((wh) => {
                if (wh.id === currentEndpointId) return false;
                return isLocalhostUrl(wh.url);
              });

              if (otherLocalhost) {
                throw new Error(
                  'Only one localhost webhook endpoint is allowed per organization. Delete or update the existing localhost webhook before adding a new one.',
                );
              }
            }
          }
        }

        // Encrypt secret for storage
        if (data.signingSecret && !data.signingSecret.startsWith('qenc:')) {
          data.signingSecret = encrypt(data.signingSecret);
        }

        return data;
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        try {
          // Cascade delete related WebhookDeliveries
          await req.payload.delete({
            collection: 'webhook-deliveries',
            where: {
              endpoint: { equals: id },
            },
            overrideAccess: true,
            req,
          });
        } catch (error) {
          req.payload.logger.error({ err: error }, `Failed to cascade delete webhook-deliveries for endpoint ${id}`);
        }
      },
    ],
  },
};
