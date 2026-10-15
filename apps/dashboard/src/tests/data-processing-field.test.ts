import { DATA_PROCESSING } from '@tuwaio/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Organizations } from '@/collections/ContextOrganizations/Organizations';
import { EDITION } from '@/constants/edition';
import { seedWorkspace } from '@/payload/seed';

// The engine refuses the transactions of a Cloud organization until data processing is set up for it
// (apps/server/src/common/data-processing.ts). Until the Data Processing page exists, only a system admin changes the
// status, to mark the organizations of the operator itself; nobody else may open the intake, not even by creating an
// organization with the field already set.
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

type FieldAccessFn = (args: { req: { user: unknown } }) => boolean | Promise<boolean>;

const field = Organizations.fields.find((f) => 'name' in f && f.name === 'dataProcessing') as
  | {
      type: string;
      defaultValue: unknown;
      required: boolean;
      options: { value: string }[];
      access: { create: FieldAccessFn; update: FieldAccessFn };
      admin: { condition?: () => boolean };
    }
  | undefined;

const admin = { id: 'u_admin', roles: ['admin'] };
const owner = { id: 'u_owner', roles: ['user'] };

describe('Organizations: data processing status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMocks.background = [];
  });

  it('starts as pending, so a new organization cannot send transactions', () => {
    expect(field?.type).toBe('select');
    expect(field?.defaultValue).toBe(DATA_PROCESSING.PENDING);
    expect(field?.required).toBe(true);
    expect(field?.options.map((option) => option.value)).toEqual([DATA_PROCESSING.PENDING, DATA_PROCESSING.OWN]);
  });

  it.each(['create', 'update'] as const)('lets only a system admin set it on %s', async (operation) => {
    expect(await field!.access[operation]({ req: { user: admin } })).toBe(true);
    expect(await field!.access[operation]({ req: { user: owner } })).toBe(false);
    expect(await field!.access[operation]({ req: { user: null } })).toBe(false);
  });

  // The codemod switches EDITION in the Community Edition, where the engine does not check the status
  it('is shown in the Cloud edition only', () => {
    expect(field?.admin.condition).toBeTypeOf('function');
    expect(field!.admin.condition!()).toBe(EDITION === 'cloud');
  });

  it('drops the cached app metadata when the status changes', async () => {
    const afterChange = Organizations.hooks?.afterChange?.[0];
    await afterChange!({
      doc: { id: 'org_1', rpsLimit: 5, dataProcessing: DATA_PROCESSING.OWN },
      previousDoc: { id: 'org_1', rpsLimit: 5, dataProcessing: DATA_PROCESSING.PENDING },
      operation: 'update',
      req: { payload: { logger: { info: vi.fn(), error: vi.fn() } }, context: {} },
      context: {},
      collection: Organizations,
    } as any);
    await Promise.all(redisMocks.background);

    expect(redisMocks.invalidateOrganizationAppMetadata).toHaveBeenCalledWith(expect.anything(), 'org_1');
  });

  it('leaves the cache alone when the status is unchanged', async () => {
    const afterChange = Organizations.hooks?.afterChange?.[0];
    await afterChange!({
      doc: { id: 'org_1', rpsLimit: 5, dataProcessing: DATA_PROCESSING.PENDING },
      previousDoc: { id: 'org_1', rpsLimit: 5, dataProcessing: DATA_PROCESSING.PENDING },
      operation: 'update',
      req: { payload: { logger: { info: vi.fn(), error: vi.fn() } }, context: {} },
      context: {},
      collection: Organizations,
    } as any);
    await Promise.all(redisMocks.background);

    expect(redisMocks.invalidateOrganizationAppMetadata).not.toHaveBeenCalled();
  });

  // The seed creates the workspace of the deployment's admin, which belongs to the operator itself
  it("marks the admin's seeded workspace as an organization of the operator", async () => {
    const payload = {
      find: vi.fn().mockResolvedValue({ docs: [], totalDocs: 0 }),
      create: vi.fn().mockResolvedValue({ id: 'org_1' }),
      logger: { info: vi.fn(), error: vi.fn() },
    };

    await seedWorkspace(payload as any, { id: 'u_admin' });

    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'organizations',
        data: expect.objectContaining({ dataProcessing: DATA_PROCESSING.OWN }),
      }),
    );
  });

  // Users.afterChange creates the admin's Personal Workspace (pending by default) before the seed looks for it
  it("marks the admin's existing workspace as an organization of the operator", async () => {
    const payload = {
      find: vi
        .fn()
        .mockResolvedValue({ docs: [{ id: 'org_1', dataProcessing: DATA_PROCESSING.PENDING }], totalDocs: 1 }),
      update: vi.fn().mockResolvedValue({ id: 'org_1' }),
      create: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn() },
    };

    await seedWorkspace(payload as any, { id: 'u_admin' });

    expect(payload.create).not.toHaveBeenCalled();
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'organizations',
        id: 'org_1',
        data: { dataProcessing: DATA_PROCESSING.OWN },
        overrideAccess: true,
      }),
    );
  });

  it('leaves a workspace that is already an organization of the operator untouched', async () => {
    const payload = {
      find: vi.fn().mockResolvedValue({ docs: [{ id: 'org_1', dataProcessing: DATA_PROCESSING.OWN }], totalDocs: 1 }),
      update: vi.fn(),
      create: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn() },
    };

    await seedWorkspace(payload as any, { id: 'u_admin' });

    expect(payload.update).not.toHaveBeenCalled();
  });
});
