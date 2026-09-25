import configPromise from '@payload-config';
import { headers as getHeaders } from 'next/headers';
import { NextResponse } from 'next/server';
import { getPayload } from 'payload';

import { withRateLimit } from '@/lib/apiWrapper';

// GET /api/v1/users/me — Get current authenticated user
export const GET = withRateLimit(async () => {
  try {
    const payload = await getPayload({ config: configPromise });
    const headerStore = await getHeaders();
    const { user } = await payload.auth({ headers: headerStore });

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name || null,
        telegramUsername: user.telegramUsername || null,
        discordUsername: user.discordUsername || null,
        twoFactorEnabled: !!(user as unknown as Record<string, unknown>).twoFactorEnabled,
        roles: user.roles,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

// PATCH /api/v1/users/me — Update current authenticated user
export const PATCH = withRateLimit(async (req: Request) => {
  try {
    const payload = await getPayload({ config: configPromise });
    const headerStore = await getHeaders();
    const { user } = await payload.auth({ headers: headerStore });

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const updateData: Record<string, unknown> = {};

    // Allow updating name
    if (body.name !== undefined) {
      updateData.name = body.name;
    }

    if (body.telegramUsername !== undefined) {
      updateData.telegramUsername = body.telegramUsername;
    }

    if (body.discordUsername !== undefined) {
      updateData.discordUsername = body.discordUsername;
    }

    // Allow updating password (requires currentPassword verification)
    if (body.password) {
      if (!body.currentPassword) {
        return NextResponse.json({ error: 'Current password is required' }, { status: 400 });
      }

      // Verify current password by attempting login
      try {
        await payload.login({
          collection: 'users',
          data: { email: user.email, password: body.currentPassword },
          req: { context: { twoFactorVerified: true } } as unknown as import('payload').PayloadRequest,
        });
      } catch {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
      }

      updateData.password = body.password;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await payload.update({
      collection: 'users',
      id: user.id,
      data: updateData,
    });

    return NextResponse.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name || null,
        telegramUsername: updated.telegramUsername || null,
        discordUsername: updated.discordUsername || null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
