// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ find: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/apiWrapper', () => ({ withRateLimit: (fn: unknown) => fn }));
vi.mock('@/lib/auth-utils', () => ({
  authenticateRequest: async () => ({ payload: { find: h.find, create: h.create }, user: { id: 'u_owner' } }),
  verifyOrgAccess: async () => ({ allowed: true, role: 'owner' }),
}));

import { POST } from '@/app/api/v1/organizations/[orgId]/members/route';

// The whole record the Local API populates at its default depth: never the body of the answer
const victim = {
  id: 'u_victim',
  email: 'victim@example.test',
  name: 'Victim',
  roles: ['admin'],
  twoFactorEnabled: true,
  twoFactorSecret: 'qenc:secret',
  backupCode: 'qenc:hash',
  sessions: [{ id: 's1', createdAt: '2026-10-24', expiresAt: '2026-10-25' }],
  _verified: true,
};

beforeEach(() => {
  // What the lookup selects of the user
  h.find.mockReset().mockImplementation(async ({ select }: { select?: Record<string, true> }) => ({
    docs: [Object.fromEntries(Object.entries(victim).filter(([key]) => key === 'id' || (select ? select[key] : true)))],
    totalDocs: 1,
  }));
  h.create.mockReset().mockImplementation(async ({ depth }: { depth?: number }) => ({
    id: 'm_new',
    organization: 'org_1',
    user: depth === 0 ? victim.id : victim,
    role: 'member',
    createdAt: '2026-10-24T10:00:00.000Z',
  }));
});

const add = () =>
  (POST as unknown as (req: Request, ctx: { params: Promise<{ orgId: string }> }) => Promise<Response>)(
    new Request('http://localhost/api/v1/organizations/org_1/members', {
      method: 'POST',
      body: JSON.stringify({ email: victim.email, role: 'member' }),
    }),
    { params: Promise.resolve({ orgId: 'org_1' }) },
  );

// Audit 2026-10-24: adding a member answered with the user's whole record (2FA secret and backup code ciphertexts,
// sessions, roles) to whoever added them, which is anyone who owns an organization
describe('adding a member to an organization', () => {
  it('creates the membership without populating the user', async () => {
    await add();
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ depth: 0 }));
  });

  it('answers with the membership and the name and email of the member only', async () => {
    const res = await add();
    expect(res.status).toBe(201);
    const body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/twoFactor|backupCode|sessions|roles|qenc/);
    expect(JSON.parse(body).member).toEqual({
      id: 'm_new',
      role: 'member',
      user: { id: victim.id, name: victim.name, email: victim.email },
      joinedAt: '2026-10-24T10:00:00.000Z',
    });
  });
});
