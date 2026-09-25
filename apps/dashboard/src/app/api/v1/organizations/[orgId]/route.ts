import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';

const UpdateOrgSchema = z.object({
  name: z.string().min(2).max(50).optional(),
});

// GET: Single Org
export const GET = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
    if (access instanceof NextResponse) return access;

    const org = await payload.findByID({
      collection: 'organizations',
      id: orgId,
      depth: 0,
    });

    if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ organization: { ...org, role: access.role } });
  } catch (error: any) {
    console.error('[Get Org] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

// PATCH: Update
export const PATCH = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin']);
    if (access instanceof NextResponse) return access;

    const body = await req.json();
    const validation = UpdateOrgSchema.safeParse(body);
    if (!validation.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

    const updated = await payload.update({
      collection: 'organizations',
      id: orgId,
      data: validation.data,
      overrideAccess: true, // We checked role manually
    });

    return NextResponse.json({ success: true, organization: updated });
  } catch (error: any) {
    console.error('[Update Org] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

// DELETE: Remove
export const DELETE = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    // Only Owner can delete
    const access = await verifyOrgAccess(payload, user.id, orgId, ['owner']);
    if (access instanceof NextResponse) return access;

    await payload.delete({
      collection: 'organizations',
      id: orgId,
      overrideAccess: true,
      req: req as any, // Pass req for Audit Log & Email hooks
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Delete Org] Error:', error);
    let message = error?.message || 'Internal Server Error';
    if (error?.errors && Array.isArray(error.errors)) {
      message = error.errors.map((err: any) => err.message).join(', ');
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
