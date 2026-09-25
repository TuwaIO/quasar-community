import { createHash } from 'node:crypto';

import { Test, TestingModule } from '@nestjs/testing';
import { Redis } from 'ioredis';
import Redlock from 'redlock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, MockProxy } from 'vitest-mock-extended';

import { DRIZZLE } from '../database/database.module';
import { organizations } from '../database/schema';
import { REDIS, REDLOCK } from '../redis/redis.module';
import { SyncUsageService } from './sync-usage.service';

describe('SyncUsageService (Integration)', () => {
  let service: SyncUsageService;
  let redis: MockProxy<Redis>;
  let redlock: MockProxy<Redlock>;
  let db: MockProxy<any>;

  beforeEach(async () => {
    redis = mock<Redis>();
    redlock = mock<Redlock>();
    db = mock<any>();
    db.transaction.mockImplementation(async (callback: (trx: any) => Promise<unknown>) =>
      callback({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
        update: db.update,
      }),
    );

    // Mock redlock.using to execute the callback immediately
    (redlock as any).using = vi.fn().mockImplementation(async (_res: any, _ttl: any, cb: any) => {
      return cb({} as any);
    });

    // Force single-node path in scanStreamSafe (prevent cluster branch)
    (redis as any).nodes = undefined;

    // Mock Redis scanStream behavior for standard usage keys
    (redis.scanStream as any) = vi.fn().mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield ['{org_1}:usage'];
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncUsageService,
        { provide: REDIS, useValue: redis },
        { provide: REDLOCK, useValue: redlock },
        { provide: DRIZZLE, useValue: db },
        {
          provide: 'PROM_METRIC_QUOTA_NEGATIVE_OVERDRAFT_LIMIT_REACHED_TOTAL',
          useValue: {
            inc: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SyncUsageService>(SyncUsageService);
  });

  it('Test 1 (Shutdown Flush): Should flush all pending Redis usage on graceful shutdown', async () => {
    // Mock Lua eval for RENAME to return 1 (success)
    redis.eval.mockResolvedValue(1);
    redis.get.mockResolvedValue('75');

    const mockUpdateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ quotaBalance: '0' }]),
    };
    db.update.mockReturnValue(mockUpdateChain);

    await service.onApplicationShutdown();

    // Verify DB update logic occurred
    expect(db.update).toHaveBeenCalledWith(organizations);
    expect(redis.del).toHaveBeenCalledWith('{org_1}:sync', '{org_1}:sync:batch');
    expect(redis.del).toHaveBeenCalledWith('{org_1}:limit');
  });

  it('Test 2 (Reclamation on Failure): Should safely increment Redis usage back if database update fails', async () => {
    redis.eval.mockResolvedValue(1);
    redis.get.mockResolvedValue('120');

    // Make database update throw an error
    db.update.mockImplementation(() => {
      throw new Error('Database Connection Lost');
    });

    await service.syncUsageToDb();

    // Verify that the database error is caught, and usage is incremented back into Redis
    expect(redis.incrbyfloat).toHaveBeenCalledWith('{org_1}:usage', 120);

    // Verify that the temporary sync key is still cleaned up to avoid stalled sync conflicts
    expect(redis.del).toHaveBeenCalledWith('{org_1}:sync', '{org_1}:sync:batch');
  });

  it('Test 3 (Atomic Sync): Should deduct usage from DB and atomically reduce Redis bucket', async () => {
    // Stage initial conditions
    // 1. renamenx allows moving to syncing state
    redis.eval.mockResolvedValue(1);
    // 2. get reads from the sync key
    redis.get.mockResolvedValue('50');
    // 3. set NX allows acquiring the distributed lock
    redis.set.mockResolvedValue('OK');

    // Mock Drizzle update chain
    const mockUpdateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ quotaBalance: '0' }]),
    };
    db.update.mockReturnValue(mockUpdateChain);

    await service.syncUsageToDb();

    // Verify DB update logic
    expect(db.update).toHaveBeenCalledWith(organizations);
    expect(mockUpdateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        quotaBalance: expect.anything(), // sql template literal
      }),
    );

    // Verify atomic cleanup of the sync key
    expect(redis.del).toHaveBeenCalledWith('{org_1}:sync', '{org_1}:sync:batch');

    // Verify cache invalidation for hydration
    expect(redis.del).toHaveBeenCalledWith('{org_1}:limit');
  });

  it('Test 4 (Fractional Sync): Should handle fractional usage correctly', async () => {
    redis.eval.mockResolvedValue(1);
    redis.get.mockResolvedValue('50.75');

    const mockUpdateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ quotaBalance: '0' }]),
    };
    db.update.mockReturnValue(mockUpdateChain);

    await service.syncUsageToDb();

    // Verify DB update logic receives the float
    expect(db.update).toHaveBeenCalledWith(organizations);
    expect(redis.del).toHaveBeenCalledWith('{org_1}:usage', '{org_1}:sync:batch');
  });

  it('Test 5 (Rescue Stalled Syncs): Should automatically scan and rescue stalled sync keys', async () => {
    // Mock Redis scanStream to return sync key instead of usage
    (redis.scanStream as any) = vi.fn().mockImplementation(({ match }) => {
      return {
        async *[Symbol.asyncIterator]() {
          if (match === '{*}:sync') {
            yield ['{org_1}:sync'];
          } else {
            yield [];
          }
        },
      };
    });

    redis.get.mockResolvedValue('45');

    const mockUpdateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ quotaBalance: '0' }]),
    };
    db.update.mockReturnValue(mockUpdateChain);

    await service.syncUsageToDb();

    // Verify that sync process rescued the stalled key, updated DB and removed key
    expect(db.update).toHaveBeenCalledWith(organizations);
    expect(redis.del).toHaveBeenCalledWith('{org_1}:sync', '{org_1}:sync:batch');
  });

  it('Test 6 (Overdraft Floor Hit): Should increment overdraft metric when quotaBalance hits -10000', async () => {
    redis.eval.mockResolvedValue(1);
    redis.get.mockResolvedValue('15000');

    const mockUpdateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ quotaBalance: '-10000' }]),
    };
    db.update.mockReturnValue(mockUpdateChain);

    await service.syncUsageToDb();

    expect(db.update).toHaveBeenCalledWith(organizations);
    expect(service['overdraftCounter'].inc).toHaveBeenCalled();
  });

  it('Test 7 (Post-Commit Redis Failure): Should replay a committed batch without charging twice', async () => {
    redis.eval.mockResolvedValue(1);
    redis.get.mockResolvedValue('25');
    const contentDigest = createHash('sha256').update('org_1|25|usage|25').digest('hex');

    const mockUpdateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ quotaBalance: '75' }]),
    };
    db.update.mockReturnValue(mockUpdateChain);

    let transactionCount = 0;
    db.transaction.mockImplementation(async (callback: (trx: any) => Promise<unknown>) => {
      transactionCount += 1;
      return callback({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(
                transactionCount === 1
                  ? []
                  : [
                      {
                        organizationId: 'org_1',
                        amount: '25',
                        contentDigest,
                      },
                    ],
              ),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
        update: db.update,
      });
    });

    redis.del.mockImplementationOnce(async (...keys: any[]) => {
      if (keys.includes('{org_1}:sync')) throw new Error('Redis acknowledgement unavailable');
      return 1;
    });

    await service.syncSingleOrg('org_1');
    await service.syncSingleOrg('org_1');

    expect(transactionCount).toBe(2);
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});
