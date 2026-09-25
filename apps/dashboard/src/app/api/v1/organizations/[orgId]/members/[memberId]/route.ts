import { NextResponse } from 'next/server';
import { getPayload, type PayloadRequest } from 'payload';
import { z } from 'zod';

import { withRateLimit } from '@/lib/apiWrapper';
import configObject from '@/payload.config';
import type { OrganizationMember } from '@/payload-types';

const UpdateRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

// DELETE: Remove Member
export const DELETE = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; memberId: string }> }) => {
    try {
      const { orgId, memberId } = await params;
      const payload = await getPayload({ config: configObject });
      const { user } = await payload.auth({ req: req as unknown as PayloadRequest, headers: req.headers });

      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      // 1. Get Caller Role
      const callerMem = await payload.find({
        collection: 'organization-members',
        where: { and: [{ organization: { equals: orgId } }, { user: { equals: user.id } }] },
        depth: 0,
      });
      if (callerMem.totalDocs === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const callerRole = (callerMem.docs[0] as unknown as OrganizationMember).role;

      // 2. Get Target Membership
      const targetMem = await payload.findByID({
        collection: 'organization-members',
        id: memberId,
        depth: 0,
      });
      if (!targetMem) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      const targetMember = targetMem as unknown as OrganizationMember;
      const targetUserId = typeof targetMember.user === 'object' ? targetMember.user.id : targetMember.user;

      // 3. Logic Checks
      // Members can ONLY remove themselves (leaving)
      if (callerRole === 'member' && targetUserId !== user.id) {
        return NextResponse.json({ error: 'Members can only remove themselves' }, { status: 403 });
      }
      // Validate target is in correct org
      const targetOrgId =
        typeof targetMember.organization === 'object' ? targetMember.organization.id : targetMember.organization;
      if (targetOrgId !== orgId) return NextResponse.json({ error: 'Mismatch' }, { status: 400 });

      // 3. Logic Checks
      // Cannot remove yourself as owner
      if (targetUserId === user.id && callerRole === 'owner') {
        return NextResponse.json({ error: 'Owners cannot leave. Transfer ownership or delete org.' }, { status: 400 });
      }

      // Admins cannot remove other Admins or Owner (but CAN remove themselves/leave)
      if (
        callerRole === 'admin' &&
        targetUserId !== user.id &&
        (targetMember.role === 'admin' || targetMember.role === 'owner')
      ) {
        return NextResponse.json({ error: 'Admins cannot remove peers or owners' }, { status: 403 });
      }

      // 4. Delete
      await payload.delete({
        collection: 'organization-members',
        id: memberId,
        overrideAccess: true,
        req: req as unknown as PayloadRequest,
      });

      return NextResponse.json({ success: true });
    } catch (error: any) {
      console.error('[Remove Member] Error:', error);
      let message = error?.message || 'Internal Server Error';
      if (error?.errors && Array.isArray(error.errors)) {
        message = error.errors.map((err: any) => err.message).join(', ');
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
  },
);

// PATCH: Update Role
export const PATCH = withRateLimit(
  async (req: Request, { params }: { params: Promise<{ orgId: string; memberId: string }> }) => {
    try {
      const { orgId, memberId } = await params;
      const payload = await getPayload({ config: configObject });
      const { user } = await payload.auth({ req: req as unknown as PayloadRequest, headers: req.headers });

      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      // 1. Caller must be Owner (Only owners can promote/demote admins)
      // Or maybe Admins can promote Members? Let's stick to Owner for safety.
      const callerMem = await payload.find({
        collection: 'organization-members',
        where: { and: [{ organization: { equals: orgId } }, { user: { equals: user.id } }] },
        depth: 0,
      });
      if (callerMem.totalDocs === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      const callerRole = (callerMem.docs[0] as unknown as OrganizationMember).role;
      if (callerRole !== 'owner') return NextResponse.json({ error: 'Only owners can change roles' }, { status: 403 });

      const body = await req.json();
      const validation = UpdateRoleSchema.safeParse(body);
      if (!validation.success) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      const { role } = validation.data;

      // 2. Fetch Target
      const targetMem = await payload.findByID({ collection: 'organization-members', id: memberId });
      if (!targetMem) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const targetMember = targetMem as unknown as OrganizationMember;

      // Validate target is in correct org (BOLA protection)
      const targetOrgId =
        typeof targetMember.organization === 'object' ? targetMember.organization.id : targetMember.organization;
      if (targetOrgId !== orgId) return NextResponse.json({ error: 'Mismatch' }, { status: 400 });

      const targetUserId = typeof targetMember.user === 'object' ? targetMember.user.id : targetMember.user;

      // Cannot change own role
      if (targetUserId === user.id) return NextResponse.json({ error: 'Cannot change own role' }, { status: 400 });

      // Update
      await payload.update({
        collection: 'organization-members',
        id: memberId,
        data: { role },
        overrideAccess: true,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('[Update Role] Error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
);
