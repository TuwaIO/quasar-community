import { decrypt } from '@tuwaio/shared/encryption';
import { maskKey } from '@tuwaio/shared/utils';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import { formatWebhookError, isLocalhostUrl } from '@/lib/webhook-utils';
import type { WebhookEndpoint } from '@/payload-types';

export const runtime = 'nodejs';

const UpdateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  description: z.string().max(200).optional(),
  txType: z.string().max(50).optional(),
  isActive: z.boolean().optional(),
});

/**
 * GET: Get individual webhook details
 */
export const GET = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; webhookId: string }> }) => {
    try {
      const { orgId, webhookId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
      if (access instanceof NextResponse) return access;

      const webhook = await payload.findByID({
        collection: 'webhook-endpoints',
        id: webhookId,
        depth: 1,
        overrideAccess: true,
      });

      if (!webhook) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

      const webhookOrgId =
        typeof webhook.app === 'object'
          ? typeof webhook.app.organization === 'object'
            ? webhook.app.organization.id
            : webhook.app.organization
          : null;

      if (webhookOrgId !== orgId) {
        return NextResponse.json({ error: 'Forbidden: Webhook does not belong to this organization' }, { status: 403 });
      }

      const webhookEndpoint = webhook as unknown as WebhookEndpoint;
      const isGlobalAdmin = Boolean(user.roles?.includes('admin'));
      const { isSystemWebhook, ...publicWebhook } = webhookEndpoint;
      const sanitizedWebhook = {
        ...publicWebhook,
        ...(isGlobalAdmin ? { isSystemWebhook } : {}),
        signingSecret: webhookEndpoint.signingSecret ? maskKey(decrypt(webhookEndpoint.signingSecret)) : undefined,
      };

      return NextResponse.json({ webhook: sanitizedWebhook });
    } catch (error: unknown) {
      console.error('[Org Webhook Detail] Error:', error);
      const { error: message, status } = formatWebhookError(error, 'Failed to retrieve webhook details');
      return NextResponse.json({ error: message }, { status });
    }
  },
);

/**
 * PATCH: Update a webhook
 */
export const PATCH = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; webhookId: string }> }) => {
    try {
      const { orgId, webhookId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin']);
      if (access instanceof NextResponse) return access;

      const body = await req.json();
      const validation = UpdateWebhookSchema.safeParse(body);
      if (!validation.success) {
        return NextResponse.json({ error: 'Invalid input', details: validation.error.format() }, { status: 400 });
      }

      // Verify ownership before update
      const existing = await payload.findByID({
        collection: 'webhook-endpoints',
        id: webhookId,
        depth: 1,
        overrideAccess: true,
      });

      if (!existing) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

      const existingOrgId =
        typeof existing.app === 'object'
          ? typeof existing.app.organization === 'object'
            ? existing.app.organization.id
            : existing.app.organization
          : null;

      if (existingOrgId !== orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // If updating to a localhost URL, ensure no OTHER webhook in this org is localhost
      if (validation.data.url && isLocalhostUrl(validation.data.url)) {
        const existingWebhooks = await payload.find({
          collection: 'webhook-endpoints',
          where: {
            and: [{ 'app.organization': { equals: orgId } }, { id: { not_equals: webhookId } }],
          },
          depth: 0,
          overrideAccess: true,
          limit: 200,
        });

        const existingLocalhost = existingWebhooks.docs.find((wh) => isLocalhostUrl(wh.url));
        if (existingLocalhost) {
          return NextResponse.json(
            {
              error:
                'Only one localhost webhook endpoint is allowed per organization. Another webhook in this organization already uses a localhost URL.',
              details: {
                existingWebhookId: existingLocalhost.id,
                url: existingLocalhost.url,
              },
            },
            { status: 400 },
          );
        }
      }

      const updated = await payload.update({
        collection: 'webhook-endpoints',
        id: webhookId,
        data: validation.data as WebhookEndpoint,
        overrideAccess: true,
      });

      const updatedEndpoint = updated as unknown as WebhookEndpoint;
      const isGlobalAdmin = Boolean(user.roles?.includes('admin'));
      const { isSystemWebhook, ...publicUpdatedWebhook } = updatedEndpoint;
      const sanitizedUpdated = {
        ...publicUpdatedWebhook,
        ...(isGlobalAdmin ? { isSystemWebhook } : {}),
        signingSecret: updatedEndpoint.signingSecret ? maskKey(decrypt(updatedEndpoint.signingSecret)) : undefined,
      };

      return NextResponse.json({ success: true, webhook: sanitizedUpdated });
    } catch (error: unknown) {
      console.error('[Org Webhook Update] Error:', error);
      const { error: message, status } = formatWebhookError(error, 'Failed to update webhook');
      return NextResponse.json({ error: message }, { status });
    }
  },
);

/**
 * DELETE: Permanently remove a webhook
 */
export const DELETE = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; webhookId: string }> }) => {
    try {
      const { orgId, webhookId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin']);
      if (access instanceof NextResponse) return access;

      // Verify ownership
      const existing = await payload.findByID({
        collection: 'webhook-endpoints',
        id: webhookId,
        depth: 1,
        overrideAccess: true,
      });

      if (!existing) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

      const existingOrgId =
        typeof existing.app === 'object'
          ? typeof existing.app.organization === 'object'
            ? existing.app.organization.id
            : existing.app.organization
          : null;

      if (existingOrgId !== orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      await payload.delete({
        collection: 'webhook-endpoints',
        id: webhookId,
        overrideAccess: true,
      });

      return NextResponse.json({ success: true });
    } catch (error: unknown) {
      console.error('[Org Webhook Delete] Error:', error);
      const { error: message, status } = formatWebhookError(error, 'Failed to delete webhook');
      return NextResponse.json({ error: message }, { status });
    }
  },
);
