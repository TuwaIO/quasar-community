import type { Payload } from 'payload';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyOrgAccessOrSystemAdmin } from '@/lib/auth-utils';
import type { User } from '@/payload-types';

const { mockRequireOrgRole } = vi.hoisted(() => ({
  mockRequireOrgRole: vi.fn(),
}));

vi.mock('@/payload.config', () => ({
  default: {},
}));

vi.mock('@/lib/organizations', () => ({
  getUserOrgIds: vi.fn(),
  requireOrgRole: mockRequireOrgRole,
}));

const payload = {} as Payload;
const asUser = (roles: string[]) => ({ id: 'usr_1', roles }) as unknown as User;

describe('verifyOrgAccessOrSystemAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admits a system admin who is not a member, without looking up membership', async () => {
    const result = await verifyOrgAccessOrSystemAdmin(payload, asUser(['admin']), 'org_1', ['owner', 'admin']);

    expect(result).toEqual({ allowed: true });
    expect(mockRequireOrgRole).not.toHaveBeenCalled();
  });

  it('refuses a regular user who is not a member', async () => {
    mockRequireOrgRole.mockResolvedValue({ allowed: false, role: null });

    const result = await verifyOrgAccessOrSystemAdmin(payload, asUser(['user']), 'org_1', ['owner', 'admin']);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(mockRequireOrgRole).toHaveBeenCalledWith(payload, 'usr_1', 'org_1', ['owner', 'admin']);
  });

  it('refuses a member whose role is not in the list', async () => {
    mockRequireOrgRole.mockResolvedValue({ allowed: false, role: 'member' });

    const result = await verifyOrgAccessOrSystemAdmin(payload, asUser(['user']), 'org_1', ['owner', 'admin']);

    expect((result as Response).status).toBe(403);
  });

  it('admits a member with a listed role', async () => {
    mockRequireOrgRole.mockResolvedValue({ allowed: true, role: 'owner' });

    const result = await verifyOrgAccessOrSystemAdmin(payload, asUser(['user']), 'org_1', ['owner', 'admin']);

    expect(result).toEqual({ allowed: true, role: 'owner' });
  });
});
