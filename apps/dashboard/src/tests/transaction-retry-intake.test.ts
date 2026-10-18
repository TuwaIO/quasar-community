// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  organization: { dataProcessing: 'scc', intakeClosesAt: null } as Record<string, unknown> | null,
  update: vi.fn(),
  add: vi.fn(async () => undefined),
}));

const tx = {
  id: 7,
  txKey: '0xabc',
  status: 'Failed',
  pending: false,
  localTimestamp: 1_700_000_000,
  owner: 'org_1',
  appId: 'app_1',
};
const chain = <T>(result: T) => {
  const query = {
    from: () => query,
    leftJoin: () => query,
    where: () => query,
    limit: async () => result,
  };
  return query;
};
const payload = {
  db: {
    drizzle: {
      select: () => chain([tx]),
      update: () => ({ set: (data: unknown) => ({ where: async () => h.update(data) }) }),
    },
  },
  findByID: vi.fn(async () => h.organization),
};

vi.mock('@/lib/apiWrapper', () => ({ withRateLimit: (handler: unknown) => handler }));
vi.mock('@/lib/auth-utils', () => ({
  authenticateRequest: async () => ({ payload, user: { id: 'u_1', roles: [] } }),
  verifyOrgAccessOrSystemAdmin: async () => ({ role: 'owner' }),
}));
vi.mock('@/lib/dataAccess', () => ({ recordAdminView: async () => undefined }));
vi.mock('@/lib/redis', () => ({
  getQueue: () => ({ add: h.add }),
  redisApi: { del: async () => 1 },
}));

import { POST } from '@/app/api/v1/organizations/[orgId]/transactions/[txId]/retry/route';
import { EDITION } from '@/constants/edition';

const retry = () =>
  (POST as unknown as (req: Request, ctx: unknown) => Promise<Response>)(
    new Request('http://localhost/api/v1/organizations/org_1/transactions/7/retry', { method: 'POST' }),
    { params: Promise.resolve({ orgId: 'org_1', txId: '7' }) },
  );

// The engine refuses a retry of an organization whose intake is closed (`RequiresDataProcessing`); the dashboard's own
// retry of a stored transaction answers the same, so a closed intake has no other door
describe('retrying a transaction from the dashboard', () => {
  beforeEach(() => {
    h.update.mockClear();
    h.add.mockClear();
  });

  it('re-tracks it while the intake of the organization is open', async () => {
    h.organization = { dataProcessing: 'scc', intakeClosesAt: null };
    expect((await retry()).status).toBe(200);
    expect(h.add).toHaveBeenCalledTimes(1);
  });

  // A Community Edition node does not check the status of an organization
  it.runIf(EDITION === 'cloud')('is refused while the intake is closed, and changes nothing', async () => {
    for (const organization of [
      { dataProcessing: 'pending', intakeClosesAt: null },
      { dataProcessing: 'scc', intakeClosesAt: '2026-01-01T00:00:00.000Z' },
    ]) {
      h.organization = organization;
      const res = await retry();
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('data_processing_required');
    }
    expect(h.update).not.toHaveBeenCalled();
    expect(h.add).not.toHaveBeenCalled();
  });
});

describe('the intake rule of the dashboard', () => {
  it('follows the engine: own always, agreed until a version takes effect, a bad time closes, Community never checks', async () => {
    const { isDataIntakeOpen } = await import('@/lib/dataIntake');
    const now = new Date('2026-10-17T12:00:00.000Z');
    expect(isDataIntakeOpen({ dataProcessing: 'own', intakeClosesAt: '2026-01-01T00:00:00.000Z' }, now, 'cloud')).toBe(
      true,
    );
    expect(isDataIntakeOpen({ dataProcessing: 'not_required' }, now, 'cloud')).toBe(true);
    expect(isDataIntakeOpen({ dataProcessing: 'scc', intakeClosesAt: '2026-10-18T00:00:00.000Z' }, now, 'cloud')).toBe(
      true,
    );
    expect(isDataIntakeOpen({ dataProcessing: 'scc', intakeClosesAt: 'soon' }, now, 'cloud')).toBe(false);
    expect(isDataIntakeOpen(null, now, 'cloud')).toBe(false);
    expect(isDataIntakeOpen({ dataProcessing: 'pending' }, now, 'community')).toBe(true);
  });
});
