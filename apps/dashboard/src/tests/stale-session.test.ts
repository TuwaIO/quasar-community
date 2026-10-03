// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), cookie: undefined as string | undefined }));

vi.mock('@payload-config', () => ({ default: {} }));
vi.mock('payload', () => ({ getPayload: vi.fn(async () => ({ auth: mocks.auth })) }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers(mocks.cookie ? { cookie: mocks.cookie } : {})),
}));
vi.mock('@/lib/apiWrapper', () => ({ withRateLimit: (handler: unknown) => handler }));

import { GET } from '@/app/api/v1/users/me/route';

describe('GET /api/v1/users/me with a session that no longer authenticates', () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.cookie = undefined;
  });

  it('expires the payload-token cookie, so the proxy stops treating the browser as signed in', async () => {
    mocks.cookie = 'payload-token=stale.jwt.token';
    mocks.auth.mockResolvedValue({ user: null });

    const res = await (GET as unknown as () => Promise<Response>)();

    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toMatch(/^payload-token=;.*Max-Age=0/i);
  });

  it('sets no cookie when the browser sent none', async () => {
    mocks.auth.mockResolvedValue({ user: null });

    const res = await (GET as unknown as () => Promise<Response>)();

    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
