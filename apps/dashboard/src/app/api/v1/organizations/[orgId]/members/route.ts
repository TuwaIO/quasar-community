import { NextResponse } from 'next/server';
import { type PayloadRequest } from 'payload';
import { z } from 'zod';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest, verifyOrgAccess } from '@/lib/auth-utils';
import type { OrganizationMember, User } from '@/payload-types';

const AddMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']).default('member'),
});

// GET: List Members
export const GET = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    // Check membership (Any role can list members)
    const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin', 'member']);
    if (access instanceof NextResponse) return access;

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '10') || 10;
    const page = parseInt(searchParams.get('page') || '1') || 1;

    // Fetch all members with overrideAccess
    const members = await payload.find({
      collection: 'organization-members',
      where: { organization: { equals: orgId } },
      depth: 1, // Populate User
      limit,
      page,
      req: req as unknown as PayloadRequest,
      overrideAccess: true,
    });

    // Sanitize user data
    const sanitized = members.docs.map((m) => {
      const mem = m as unknown as OrganizationMember;
      const u = mem.user as User;

      // Defensive check: if user is not populated for some reason
      if (!u || typeof u === 'string') {
        return {
          id: mem.id,
          role: mem.role,
          user: {
            id: typeof u === 'string' ? u : 'unknown',
            email: 'Deleted User',
            name: 'Deleted User',
          },
          joinedAt: mem.createdAt,
        };
      }

      return {
        id: mem.id,
        role: mem.role,
        user: {
          id: u.id,
          name: u.name,
          email: u.email,
        },
        joinedAt: mem.createdAt,
      };
    });

    return NextResponse.json({
      members: sanitized,
      totalDocs: members.totalDocs,
      totalPages: members.totalPages,
      page: members.page,
      limit: members.limit,
      hasNextPage: members.hasNextPage,
      hasPrevPage: members.hasPrevPage,
    });
  } catch (error) {
    console.error('[List Members] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});

// POST: Add Member
export const POST = withRateLimit(async (req: Request, { params }: { params: Promise<{ orgId: string }> }) => {
  try {
    const { orgId } = await params;
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    // Check Permissions (Admin/Owner only)
    const access = await verifyOrgAccess(payload, user.id, orgId, ['owner', 'admin']);
    if (access instanceof NextResponse) return access;

    const body = await req.json();
    const validation = AddMemberSchema.safeParse(body);
    if (!validation.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

    const { email, role: newRole } = validation.data;

    // Find User by Email
    const targetUser = await payload.find({
      collection: 'users',
      where: { email: { equals: email } },
      limit: 1,
    });

    if (targetUser.totalDocs === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const targetUserId = targetUser.docs[0].id;

    // Create Membership (Hooks handle duplication check & email)
    const newMember = await payload.create({
      collection: 'organization-members',
      data: {
        organization: orgId,
        user: targetUserId,
        role: newRole,
      },
      req: req as unknown as PayloadRequest,
    });

    return NextResponse.json({ success: true, member: newMember }, { status: 201 });
  } catch (error: any) {
    console.error('[Add Member] Error:', error);
    if (error.message && error.message.includes('already a member')) {
      return NextResponse.json({ error: 'User is already a member' }, { status: 409 });
    }
    let message = error?.message || 'Internal Server Error';
    if (error?.errors && Array.isArray(error.errors)) {
      message = error.errors.map((err: any) => err.message).join(', ');
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
