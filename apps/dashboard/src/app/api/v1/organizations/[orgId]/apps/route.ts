import { decrypt } from '@tuwaio/shared/encryption';
import { maskKey } from '@tuwaio/shared/utils';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import { getUserOrgRole } from '@/lib/organizations';
import type { App } from '@/payload-types';

// Validation Schema
const CreateAppSchema = z.object({
  name: z.string().min(1).max(50),
  organizationId: z.string().min(1),
  environment: z.enum(['live', 'test']).default('test'),
  kind: z.enum(['basic', 'payments']).default('basic'),
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

export const GET = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const authResult = await authenticateRequest(req);
    if (authResult instanceof NextResponse) return authResult;

    const { payload, user } = authResult;

    // Single Org Mode: Verify membership
    const role = await getUserOrgRole(payload, user.id, orgId);

    if (!role) {
      return NextResponse.json({ error: 'Access denied to this organization' }, { status: 403 });
    }
    const targetOrgs = [orgId];

    // 3. Fetch Apps for the target organizations
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search');
    const environment = searchParams.get('environment');

    const whereClause: any = {
      organization: { in: targetOrgs },
    };

    if (search) {
      whereClause.name = { contains: search };
    }

    if (environment) {
      whereClause.environment = { equals: environment };
    }

    const apps = await payload.find({
      collection: 'apps',
      where: whereClause,
      page,
      limit,
      sort: '-createdAt',
      depth: 0,
    });

    // Sanitize Response (NEVER return secretKey in lists)
    const sanitizedApps = apps.docs.map((app) => {
      const a = app as unknown as App;
      // Mask: sk_live_1234...5678
      const decryptedSecret = decrypt(a.secretKey);
      const masked = maskKey(decryptedSecret);

      return {
        id: a.id,
        name: a.name,
        publicKey: a.publicKey,
        maskedSecretKey: masked,
        isActive: a.isActive,
        environment: a.environment,
        kind: a.kind,
        paymentSettings: a.paymentSettings
          ? {
              ...a.paymentSettings,
              goPlusApiKey: a.paymentSettings.goPlusApiKey
                ? maskKey(decrypt(a.paymentSettings.goPlusApiKey))
                : undefined,
              goPlusApiSecret: a.paymentSettings.goPlusApiSecret
                ? maskKey(decrypt(a.paymentSettings.goPlusApiSecret))
                : undefined,
            }
          : null,
        ipWhitelist: a.ipWhitelist?.map((i: any) => i.ip) || [],
        domainsWhitelist: a.domainsWhitelist?.map((d: any) => d.domain) || [],
        alchemyApiKey: a.alchemyApiKey ? maskKey(decrypt(a.alchemyApiKey)) : undefined,
        quickNodeApiKey: a.quickNodeApiKey ? maskKey(decrypt(a.quickNodeApiKey)) : undefined,
        quickNodeAppName: a.quickNodeAppName,
        gelatoApiKey: a.gelatoApiKey ? maskKey(decrypt(a.gelatoApiKey)) : undefined,
        pimlicoApiKey: a.pimlicoApiKey ? maskKey(decrypt(a.pimlicoApiKey)) : undefined,
        rpcConfigs:
          (a.rpcConfigs as any[])?.map((r: any) => ({
            chainId: r.chainId,
            rpcUrl: maskKey(decrypt(r.rpcUrl)),
          })) || [],
        createdAt: a.createdAt,
      };
    });

    return NextResponse.json({
      docs: sanitizedApps,
      totalDocs: apps.totalDocs,
      totalPages: apps.totalPages,
    });
  } catch (error: any) {
    console.error('[Dashboard] List Apps Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});

export const POST = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const authResult = await authenticateRequest(req);
    if (authResult instanceof NextResponse) return authResult;

    const { payload, user } = authResult;

    const body = await req.json();
    const validation = CreateAppSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid input', details: validation.error.format() }, { status: 400 });
    }

    const { name, environment, kind } = validation.data;

    if (kind === 'payments') {
      return NextResponse.json(
        { error: 'Active development of this module is underway, currently not available' },
        { status: 403 },
      );
    }

    // Verify user is Admin/Owner of the Org
    const access = await verifyOrgAccess(payload, user.id, orgId);
    if (access instanceof NextResponse) return access;

    // Create App
    const newApp = await payload.create({
      collection: 'apps',
      data: {
        name,
        environment,
        kind,
        organization: orgId,
        ipWhitelist: validation.data.ipWhitelist?.map((ip) => ({ ip })) || [],
        domainsWhitelist: validation.data.domainsWhitelist?.map((domain) => ({ domain })) || [],
        alchemyApiKey: validation.data.alchemyApiKey,
        quickNodeApiKey: validation.data.quickNodeApiKey,
        quickNodeAppName: validation.data.quickNodeAppName,
        gelatoApiKey: validation.data.gelatoApiKey,
        pimlicoApiKey: validation.data.pimlicoApiKey,
        rpcConfigs: validation.data.rpcConfigs?.map((r) => ({ chainId: r.chainId, rpcUrl: r.rpcUrl })) || [],
        isActive: true,
      },
    });

    const a = newApp as unknown as App;

    return NextResponse.json(
      {
        id: a.id,
        name: a.name,
        publicKey: a.publicKey,
        secretKey: decrypt(a.secretKey), // Returned ONLY ONCE here
        environment: a.environment,
        kind: a.kind,
      },
      { status: 201 },
    );
  } catch (error: any) {
    // Payload errors carry their status. The Apps collection answers 400 for a rejected RPC URL
    // or QuickNode endpoint, and the message says which one.
    if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[Dashboard] Create App Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
