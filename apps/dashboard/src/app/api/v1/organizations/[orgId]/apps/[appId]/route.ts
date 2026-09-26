import { decrypt } from '@tuwaio/shared/encryption';
import { maskKey } from '@tuwaio/shared/utils';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import type { App } from '@/payload-types';

const UpdateAppSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
  kind: z.enum(['basic', 'payments']).optional(),
  paymentSettings: z
    .object({
      amlEnabled: z.boolean().optional(),
      goPlusApiKey: z.string().nullable().optional(),
      goPlusApiSecret: z.string().nullable().optional(),
      appInvoiceTemplate: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .optional(),
  ipWhitelist: z.array(z.string()).optional(),
  domainsWhitelist: z.array(z.string()).optional(),
  alchemyApiKey: z.string().optional(),
  quickNodeApiKey: z.string().optional(),
  quickNodeAppName: z.string().optional(),
  gelatoApiKey: z.string().optional(),
  pimlicoApiKey: z.string().optional(),
  rpcConfigs: z
    .array(
      z.object({
        chainId: z.string(),
        rpcUrl: z.string(),
      }),
    )
    .optional(),
});

function sanitizeApp(a: App): any {
  return {
    id: a.id,
    name: a.name,
    publicKey: a.publicKey,
    maskedSecretKey: maskKey(decrypt(a.secretKey)),
    isActive: a.isActive,
    environment: a.environment,
    kind: a.kind,
    organization: typeof a.organization === 'object' ? a.organization.id : a.organization,
    ipWhitelist: a.ipWhitelist?.map((i: any) => i.ip) || [],
    domainsWhitelist: a.domainsWhitelist?.map((d: any) => d.domain) || [],
    alchemyApiKey: a.alchemyApiKey ? maskKey(decrypt(a.alchemyApiKey)) : undefined,
    quickNodeApiKey: a.quickNodeApiKey ? maskKey(decrypt(a.quickNodeApiKey)) : undefined,
    quickNodeAppName: a.quickNodeAppName,
    gelatoApiKey: a.gelatoApiKey ? maskKey(decrypt(a.gelatoApiKey)) : undefined,
    pimlicoApiKey: a.pimlicoApiKey ? maskKey(decrypt(a.pimlicoApiKey)) : undefined,
    paymentSettings: a.paymentSettings
      ? {
          amlEnabled: a.paymentSettings.amlEnabled,
          appInvoiceTemplate: a.paymentSettings.appInvoiceTemplate,
          goPlusApiKey: a.paymentSettings.goPlusApiKey ? maskKey(decrypt(a.paymentSettings.goPlusApiKey)) : undefined,
          goPlusApiSecret: a.paymentSettings.goPlusApiSecret
            ? maskKey(decrypt(a.paymentSettings.goPlusApiSecret))
            : undefined,
        }
      : null,
    rpcConfigs:
      (a.rpcConfigs as any[])?.map((r: any) => ({
        chainId: r.chainId,
        rpcUrl: maskKey(decrypt(r.rpcUrl)),
      })) || [],
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export const GET = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; appId: string }> }) => {
    try {
      const { orgId, appId } = await params;
      const authResult = await authenticateRequest(req);
      if (authResult instanceof NextResponse) return authResult;

      const { payload, user } = authResult;

      // 1. Verify Role (Admin/Owner) for the org
      const access = await verifyOrgAccess(payload, user.id, orgId);
      if (access instanceof NextResponse) return access;

      // 2. Fetch App
      const appData = await payload.findByID({ collection: 'apps', id: appId, overrideAccess: true });
      const organizationRef = typeof appData.organization === 'object' ? appData.organization.id : appData.organization;
      if (organizationRef !== orgId) {
        return NextResponse.json({ error: 'App not found in this organization' }, { status: 404 });
      }

      const a = appData as unknown as App;
      return NextResponse.json(sanitizeApp(a));
    } catch (error: any) {
      console.error('[Dashboard] Get App Error:', error);
      return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
  },
);

export const PATCH = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; appId: string }> }) => {
    try {
      const { orgId, appId } = await params;
      const authResult = await authenticateRequest(req);
      if (authResult instanceof NextResponse) return authResult;

      const { payload, user } = authResult;

      const body = await req.json();
      const validation = UpdateAppSchema.safeParse(body);

      if (!validation.success) {
        return NextResponse.json({ error: 'Invalid input', details: validation.error.format() }, { status: 400 });
      }

      // 1. Verify Role (Admin/Owner) for the org
      const access = await verifyOrgAccess(payload, user.id, orgId);
      if (access instanceof NextResponse) return access;

      // 2. Fetch App
      const appData = await payload.findByID({ collection: 'apps', id: appId, overrideAccess: true });
      const organizationRef = typeof appData.organization === 'object' ? appData.organization.id : appData.organization;
      if (organizationRef !== orgId) {
        return NextResponse.json({ error: 'App not found in this organization' }, { status: 404 });
      }

      // 3. Update App
      const updatedApp = await payload.update({
        collection: 'apps',
        id: appId,
        data: {
          ...validation.data,
          ipWhitelist: validation.data.ipWhitelist?.map((ip) => ({ ip })),
          domainsWhitelist: validation.data.domainsWhitelist?.map((domain) => ({ domain })),
          rpcConfigs: validation.data.rpcConfigs?.map((r) => ({ chainId: r.chainId, rpcUrl: r.rpcUrl })),
        },
      });

      const a = updatedApp as unknown as App;
      return NextResponse.json(sanitizeApp(a));
    } catch (error: any) {
      // Payload errors carry their status. The Apps collection answers 400 for a rejected RPC URL
      // or QuickNode endpoint, and the message says which one.
      if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      console.error('[Dashboard] Update App Error:', error);
      return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
  },
);

export const DELETE = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; appId: string }> }) => {
    try {
      const { orgId, appId } = await params;
      const authResult = await authenticateRequest(req);
      if (authResult instanceof NextResponse) return authResult;

      const { payload, user } = authResult;

      // 1. Verify Role (Admin/Owner) for the org
      const access = await verifyOrgAccess(payload, user.id, orgId);
      if (access instanceof NextResponse) return access;

      // 2. Fetch App
      const appData = await payload.findByID({ collection: 'apps', id: appId, overrideAccess: true });
      const organizationRef = typeof appData.organization === 'object' ? appData.organization.id : appData.organization;
      if (organizationRef !== orgId) {
        return NextResponse.json({ error: 'App not found in this organization' }, { status: 404 });
      }

      // 3. Permanently delete App (cascade: transactions, webhooks, redis cleanup)
      await payload.delete({
        collection: 'apps',
        id: appId,
      });


      return NextResponse.json({ success: true });
    } catch (error: any) {
      console.error('[Dashboard] Revoke App Error:', error);
      return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
  },
);
