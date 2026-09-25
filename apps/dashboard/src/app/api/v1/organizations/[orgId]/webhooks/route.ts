import { decrypt } from '@tuwaio/shared/encryption';
import { maskKey } from '@tuwaio/shared/utils';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import { formatWebhookError, isLocalhostUrl } from '@/lib/webhook-utils';
import type { App, WebhookEndpoint } from '@/payload-types';

export const runtime = 'nodejs';

const CreateWebhookSchema = z.object({
  appId: z.string().min(1),
  url: z.string().url(),
  events: z.array(z.string()).min(1).default(['*']),
  description: z.string().max(200).optional(),
  txType: z.string().max(50).optional(),
});

/**
 * GET: List webhooks for an organization
 */
export const GET = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
    if (access instanceof NextResponse) return access;

    const { searchParams } = new URL(req.url);
    const appId = searchParams.get('appId');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    const where: any = {
      'app.organization': { equals: orgId },
    };

    if (appId) {
      where.app = { equals: appId };
    }

    if (search) {
      where.or = [{ url: { contains: search } }, { description: { contains: search } }];
    }

    const webhooks = await payload.find({
      collection: 'webhook-endpoints',
      where,
      limit,
      page,
      sort: '-createdAt',
      depth: 1,
      overrideAccess: true,
    });

    const isGlobalAdmin = Boolean(user.roles?.includes('admin'));
    const sanitizedDocs = webhooks.docs.map((doc) => {
      const wh = doc as unknown as WebhookEndpoint;
      const { isSystemWebhook, ...publicWebhook } = wh;
      return {
        ...publicWebhook,
        ...(isGlobalAdmin ? { isSystemWebhook } : {}),
        signingSecret: wh.signingSecret ? maskKey(decrypt(wh.signingSecret)) : undefined,
      };
    });

    return NextResponse.json({
      docs: sanitizedDocs,
      totalDocs: webhooks.totalDocs,
      totalPages: webhooks.totalPages,
    });
  } catch (error: unknown) {
    console.error('[Org Webhooks List] Error:', error);
    const { error: message, status } = formatWebhookError(error, 'Failed to retrieve webhooks');
    return NextResponse.json({ error: message }, { status });
  }
});

/**
 * POST: Create a webhook in an organization
 */
export const POST = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin']);
    if (access instanceof NextResponse) return access;

    const body = await req.json();
    const validation = CreateWebhookSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid input', details: validation.error.format() }, { status: 400 });
    }

    const { appId, url, events, description, txType } = validation.data;

    // Verify app belongs to the organization
    const app = (await payload.findByID({
      collection: 'apps',
      id: appId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as App;

    if (!app) return NextResponse.json({ error: 'App not found' }, { status: 404 });

    const appOrgId = typeof app.organization === 'object' ? app.organization.id : app.organization;
    if (appOrgId !== orgId) {
      return NextResponse.json({ error: 'Forbidden: App does not belong to this organization' }, { status: 403 });
    }

    // Enforce 1 localhost webhook per organization policy
    if (isLocalhostUrl(url)) {
      const existingWebhooks = await payload.find({
        collection: 'webhook-endpoints',
        where: {
          'app.organization': { equals: orgId },
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
              'Only one localhost webhook endpoint is allowed per organization. Delete or update the existing localhost webhook before adding a new one.',
            details: {
              existingWebhookId: existingLocalhost.id,
              url: existingLocalhost.url,
            },
          },
          { status: 400 },
        );
      }
    }

    const newWebhook = await payload.create({
      collection: 'webhook-endpoints',
      data: {
        app: appId,
        url,
        events: events as WebhookEndpoint['events'],
        description: description || '',
        txType: txType || '',
        isActive: true,
        signingSecret: '', // Overridden by hook
      },
      overrideAccess: true,
    });

    const wh = newWebhook as unknown as WebhookEndpoint;

    return NextResponse.json(
      {
        id: wh.id,
        url: wh.url,
        signingSecret: decrypt(wh.signingSecret), // Returned ONLY ONCE and decrypted
        events: wh.events,
        isActive: wh.isActive,
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error('[Org Webhook Create] Error:', error);
    const { error: message, status } = formatWebhookError(error, 'Failed to create webhook');
    return NextResponse.json({ error: message }, { status });
  }
});
