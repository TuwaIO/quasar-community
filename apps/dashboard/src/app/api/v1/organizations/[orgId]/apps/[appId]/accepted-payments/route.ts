import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import type { AppAcceptedPayment } from '@/payload-types';

const CreateAcceptedPaymentSchema = z.object({
  name: z.string().min(1).max(50),
  walletAddressToReceivePayment: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Must be a valid hex address'),
  tokenAddress: z.string().refine((val) => val === 'native' || /^0x[a-fA-F0-9]+$/.test(val), {
    message: "Must be a valid hex address or 'native'",
  }),
  chainId: z.number(),
  symbol: z.string().min(1).max(10),
  decimals: z.number().int().min(0).max(36).default(18),
  markup: z.number().nonnegative().optional().default(0),
  discount: z.number().nonnegative().optional().default(0),
  priceFeedAddress: z.string().regex(/^0x[a-fA-F0-9]+$/, 'Must be a valid hex address'),
  isActive: z.boolean().optional().default(true),
});

const UpdateAcceptedPaymentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50).optional(),
  walletAddressToReceivePayment: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/, 'Must be a valid hex address')
    .optional(),
  tokenAddress: z
    .string()
    .refine((val) => val === 'native' || /^0x[a-fA-F0-9]+$/.test(val), {
      message: "Must be a valid hex address or 'native'",
    })
    .optional(),
  chainId: z.number().optional(),
  symbol: z.string().min(1).max(10).optional(),
  decimals: z.number().int().min(0).max(36).optional(),
  markup: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  priceFeedAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/, 'Must be a valid hex address')
    .optional(),
  isActive: z.boolean().optional(),
});

export const GET = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; appId: string }> }) => {
    try {
      const { orgId, appId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
      if (access instanceof NextResponse) return access;

      // Verify app belongs to organization
      const app = await payload.findByID({ collection: 'apps', id: appId, depth: 0, overrideAccess: true });
      if (!app || (typeof app.organization === 'object' ? app.organization.id : app.organization) !== orgId) {
        return NextResponse.json({ error: 'App not found in this organization' }, { status: 404 });
      }

      const results = await payload.find({
        collection: 'app-accepted-payments',
        where: {
          app: { equals: appId },
        },
        limit: 100,
        overrideAccess: true,
      });

      return NextResponse.json({
        docs: results.docs,
        totalDocs: results.totalDocs,
      });
    } catch (error: unknown) {
      console.error('[Accepted Payments List] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);

export const POST = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; appId: string }> }) => {
    try {
      const { orgId, appId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      // Access: owner or admin
      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin']);
      if (access instanceof NextResponse) return access;

      // Verify app belongs to organization
      const app = await payload.findByID({ collection: 'apps', id: appId, depth: 0, overrideAccess: true });
      if (!app || (typeof app.organization === 'object' ? app.organization.id : app.organization) !== orgId) {
        return NextResponse.json({ error: 'App not found in this organization' }, { status: 404 });
      }

      const body = await req.json();
      const validation = CreateAcceptedPaymentSchema.safeParse(body);

      if (!validation.success) {
        return NextResponse.json({ error: 'Invalid input', details: validation.error.format() }, { status: 400 });
      }

      const newPayment = await payload.create({
        collection: 'app-accepted-payments',
        data: {
          app: appId,
          organization: orgId,
          name: validation.data.name,
          walletAddressToReceivePayment: validation.data.walletAddressToReceivePayment,
          tokenAddress: validation.data.tokenAddress,
          chainId: validation.data.chainId,
          symbol: validation.data.symbol,
          decimals: validation.data.decimals,
          markup: validation.data.markup,
          discount: validation.data.discount,
          priceFeedAddress: validation.data.priceFeedAddress,
          isActive: validation.data.isActive,
        },
        overrideAccess: true,
      });

      return NextResponse.json(newPayment, { status: 201 });
    } catch (error: unknown) {
      console.error('[Accepted Payment Create] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);

export const PATCH = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; appId: string }> }) => {
    try {
      const { orgId, appId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin']);
      if (access instanceof NextResponse) return access;

      const body = await req.json();
      const validation = UpdateAcceptedPaymentSchema.safeParse(body);

      if (!validation.success) {
        return NextResponse.json({ error: 'Invalid input', details: validation.error.format() }, { status: 400 });
      }

      // Verify the payment config exists and belongs to this app
      const paymentConfig = (await payload.findByID({
        collection: 'app-accepted-payments',
        id: validation.data.id,
        depth: 0,
        overrideAccess: true,
      })) as unknown as AppAcceptedPayment;

      if (!paymentConfig) {
        return NextResponse.json({ error: 'Payment configuration not found' }, { status: 404 });
      }

      const paymentAppId = typeof paymentConfig.app === 'object' ? paymentConfig.app.id : paymentConfig.app;
      if (paymentAppId !== appId) {
        return NextResponse.json({ error: 'Forbidden: Payment config mismatch' }, { status: 403 });
      }

      const updated = await payload.update({
        collection: 'app-accepted-payments',
        id: validation.data.id,
        data: {
          name: validation.data.name,
          walletAddressToReceivePayment: validation.data.walletAddressToReceivePayment,
          tokenAddress: validation.data.tokenAddress,
          chainId: validation.data.chainId,
          symbol: validation.data.symbol,
          decimals: validation.data.decimals,
          markup: validation.data.markup,
          discount: validation.data.discount,
          priceFeedAddress: validation.data.priceFeedAddress,
          isActive: validation.data.isActive,
        },
        overrideAccess: true,
      });

      return NextResponse.json(updated);
    } catch (error: unknown) {
      console.error('[Accepted Payment Update] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);

export const DELETE = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; appId: string }> }) => {
    try {
      const { orgId, appId } = await params;
      const auth = await authenticateRequest(req);
      if (auth instanceof NextResponse) return auth;
      const { payload, user } = auth;

      // Delete requires owner or admin
      const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin']);
      if (access instanceof NextResponse) return access;

      const { searchParams } = new URL(req.url);
      const id = searchParams.get('id');

      if (!id) {
        return NextResponse.json({ error: 'Missing payment configuration id' }, { status: 400 });
      }

      // Verify the payment config exists and belongs to this app
      const paymentConfig = (await payload.findByID({
        collection: 'app-accepted-payments',
        id,
        depth: 0,
        overrideAccess: true,
      })) as unknown as AppAcceptedPayment;

      if (!paymentConfig) {
        return NextResponse.json({ error: 'Payment configuration not found' }, { status: 404 });
      }

      const paymentAppId = typeof paymentConfig.app === 'object' ? paymentConfig.app.id : paymentConfig.app;
      if (paymentAppId !== appId) {
        return NextResponse.json({ error: 'Forbidden: Payment config mismatch' }, { status: 403 });
      }

      await payload.delete({
        collection: 'app-accepted-payments',
        id,
        overrideAccess: true,
      });

      return NextResponse.json({ success: true });
    } catch (error: unknown) {
      console.error('[Accepted Payment Delete] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
