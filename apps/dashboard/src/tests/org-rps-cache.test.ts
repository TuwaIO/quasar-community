import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Organizations } from '@/collections/ContextOrganizations/Organizations';

// IronDomeGuard caches the organization's RPS limit inside each app's
// `{…}:meta` entry, so an organization whose limit changes has to drop those
// entries — or the engine keeps enforcing the old limit for up to 5 minutes.
const redisMocks = vi.hoisted(() => ({
  invalidateOrganizationAppMetadata: vi.fn().mockResolvedValue(undefined),
  background: [] as Promise<unknown>[],
}));

vi.mock('@/lib/redis', () => ({
  redisApi: { set: vi.fn().mockResolvedValue('OK') },
  executeRedisSafe: (operation: Promise<unknown>) => operation,
  getLimitKey: (orgId: string) => `{${orgId}}:limit`,
  getInternalSecret: vi.fn(),
  bgRedisSync: (_logger: unknown, _context: string, fn: () => Promise<unknown>) => {
    redisMocks.background.push(fn());
  },
  invalidateOrganizationAppMetadata: redisMocks.invalidateOrganizationAppMetadata,
}));

const payload = { logger: { info: vi.fn(), error: vi.fn() } };

const runAfterChange = async (
  operation: 'create' | 'update',
  doc: Record<string, unknown>,
  previousDoc?: Record<string, unknown>,
) => {
  const afterChange = Organizations.hooks?.afterChange?.[0];
  expect(afterChange).toBeDefined();
  await afterChange!({
    doc,
    previousDoc,
    operation,
    req: { payload, context: {} },
    context: {},
    collection: Organizations,
  } as any);
  await Promise.all(redisMocks.background);
};

describe('Organizations afterChange: RPS limit cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMocks.background = [];
  });

  it('drops the cached app metadata when the RPS limit changes', async () => {
    await runAfterChange('update', { id: 'org_1', quotaBalance: 100, rpsLimit: 50 }, { id: 'org_1', rpsLimit: 5 });

    expect(redisMocks.invalidateOrganizationAppMetadata).toHaveBeenCalledWith(payload, 'org_1');
  });

  it('leaves the cache alone when the RPS limit is unchanged', async () => {
    await runAfterChange('update', { id: 'org_1', quotaBalance: 200, rpsLimit: 5 }, { id: 'org_1', rpsLimit: 5 });

    expect(redisMocks.invalidateOrganizationAppMetadata).not.toHaveBeenCalled();
  });

  it('has nothing to drop for a new organization', async () => {
    await runAfterChange('create', { id: 'org_1', quotaBalance: 100, rpsLimit: 5 });

    expect(redisMocks.invalidateOrganizationAppMetadata).not.toHaveBeenCalled();
  });
});
