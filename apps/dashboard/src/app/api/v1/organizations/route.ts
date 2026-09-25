import { NextResponse } from 'next/server';
import { PayloadRequest } from 'payload';
import { z } from 'zod';

import { withRateLimit } from '@/lib/apiWrapper';
import { authenticateRequest } from '@/lib/auth-utils';
import { OrganizationMember } from '@/payload-types';

const CreateOrgSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50),
});

// POST: Create Organization
export const POST = withRateLimit(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    const body = await req.json();
    const validation = CreateOrgSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid input', details: validation.error.format() }, { status: 400 });
    }

    const { name } = validation.data;

    // Create Org
    // Hooks in Organizations.ts will handle:
    // 1. Slug generation
    // 2. Max 2 orgs limit check
    // 3. Cooldown check
    // 4. Auto-creating Owner membership
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const org = await (payload.create as any)({
      collection: 'organizations',
      data: {
        name: name.trim(),
        createdBy: user.id,
        quotaBalance: 100,
        rpsLimit: 5,
        rpsPaidLimit: 5,
        quotaUsed: 0,
      },
      req: req as unknown as PayloadRequest,
    });

    return NextResponse.json({ success: true, organization: org }, { status: 201 });
  } catch (error: any) {
    console.error('[Create Org] Error:', error);
    // Catch Policy Violations from Hooks
    if (error.message && error.message.includes('Policy Violation')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});

// GET: List My Organizations
export const GET = withRateLimit(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    if (auth instanceof NextResponse) return auth;
    const { payload, user } = auth;

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');

    // 1. Find all memberships for this user (to get the list of org IDs)
    // We fetch all memberships to allow sorting organizations by their own fields (like createdAt)
    const memberships = await payload.find({
      collection: 'organization-members',
      where: {
        user: { equals: user.id },
      },
      depth: 0,
      limit: 1000, // Reasonable limit for total organizations a user can be in
    });

    const orgIds = [
      ...new Set(
        memberships.docs.map((m) => (typeof m.organization === 'object' ? m.organization.id : m.organization)),
      ),
    ];

    if (orgIds.length === 0) {
      return NextResponse.json({
        organizations: [],
        totalDocs: 0,
        totalPages: 0,
        page,
        limit,
      });
    }

    // 2. Fetch Organizations details (Paginated)
    const orgs = await payload.find({
      collection: 'organizations',
      where: {
        id: { in: orgIds },
      },
      depth: 0,
      sort: '-createdAt',
      page,
      limit,
    });

    // Merge role and membership data into response
    const orgsWithMetadata = orgs.docs.map((org) => {
      const memberRecord = memberships.docs.find(
        (m) => (typeof m.organization === 'object' ? m.organization.id : m.organization) === org.id,
      ) as unknown as OrganizationMember;

      return {
        ...org,
        role: memberRecord?.role || 'member',
        membershipId: memberRecord?.id,
      };
    });

    return NextResponse.json({
      organizations: orgsWithMetadata,
      totalDocs: orgs.totalDocs,
      totalPages: orgs.totalPages,
      page: orgs.page,
      limit: orgs.limit,
    });
  } catch (error) {
    console.error('[List Orgs] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
});
