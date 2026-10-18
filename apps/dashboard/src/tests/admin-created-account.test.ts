// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { Organizations } from '@/collections/ContextOrganizations/Organizations';

vi.mock('@/lib/redis', () => ({
  redisApi: { set: vi.fn().mockResolvedValue('OK') },
  executeRedisSafe: (operation: Promise<unknown>) => operation,
  getLimitKey: (orgId: string) => `{${orgId}}:limit`,
  getInternalSecret: vi.fn(),
  bgRedisSync: vi.fn(),
  invalidateOrganizationAppMetadata: vi.fn(),
}));

// A system admin creates an account in the admin panel; the Personal Workspace of the new account is checked against
// the limits of its owner (organizations per account, the cooldown after deleting one), not those of the admin.
type Hook = (args: Record<string, unknown>) => Promise<unknown>;
const beforeChange = Organizations.hooks!.beforeChange![0] as unknown as Hook;
const afterChange = Organizations.hooks!.afterChange![0] as unknown as Hook;

describe('Personal Workspace of an account created by a system admin', () => {
  it('is checked against the limits of the new account, not of the admin who creates it', async () => {
    // The admin deleted an organization today and owns a free one; the new account has nothing yet
    const find = vi.fn(async ({ collection, where }: { collection: string; where: unknown }) => {
      const byAdmin = JSON.stringify(where).includes('u_admin');
      if (collection === 'deleted-organizations') return { totalDocs: byAdmin ? 1 : 0, docs: [] };
      if (collection === 'organization-members' && byAdmin)
        return { totalDocs: 1, docs: [{ organization: 'org_admin', role: 'owner' }] };
      return { totalDocs: 0, docs: [] };
    });
    const req = { user: { id: 'u_admin', roles: ['admin'] }, payload: { find }, context: { skipAuthCheck: true } };

    await expect(
      beforeChange({
        operation: 'create',
        data: { name: 'Personal Workspace', createdBy: 'u_new' },
        req,
      }),
    ).resolves.toBeDefined();
    expect(JSON.stringify(find.mock.calls)).not.toContain('u_admin');
  });

  it("does not make the admin an owner of the new account's workspace", async () => {
    const create = vi.fn();
    const find = vi.fn(async () => ({ totalDocs: 0, docs: [] }));
    const req = {
      user: { id: 'u_admin', email: 'admin@example.com', roles: ['admin'] },
      payload: { find, create, logger: { info: vi.fn(), error: vi.fn() } },
      context: { skipAuthCheck: true },
    };

    await afterChange({ operation: 'create', doc: { id: 'org_new', createdBy: 'u_new' }, previousDoc: {}, req });

    expect(create).not.toHaveBeenCalledWith(expect.objectContaining({ collection: 'organization-members' }));
  });

  it('still applies the limits of the signed-in person to an organization they create', async () => {
    const find = vi.fn(async ({ collection }: { collection: string }) => ({
      totalDocs: collection === 'deleted-organizations' ? 1 : 0,
      docs: [],
    }));

    await expect(
      beforeChange({
        operation: 'create',
        data: { name: 'Team' },
        req: { user: { id: 'u_1', roles: ['user'] }, payload: { find }, context: {} },
      }),
    ).rejects.toThrow(/within 1 day of deleting one/);
  });
});
