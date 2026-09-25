import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackingService } from './tracking.service';

describe('TrackingService durability', () => {
  let service: TrackingService;
  let redis: any;
  let db: any;
  let redlock: any;
  let release: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    redis = {
      exists: vi.fn().mockResolvedValue(0),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };
    release = vi.fn().mockResolvedValue(undefined);
    redlock = {
      acquire: vi.fn().mockResolvedValue({ release }),
    };
    db = {
      transaction: vi.fn().mockImplementation(async (callback: (trx: any) => Promise<void>) =>
        callback({
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      ),
    };

    service = new TrackingService(db, redis, redlock);
  });

  it('writes terminal update synchronously to DB and sets Redis marker immediately without batch flush', async () => {
    const events: string[] = [];
    db.transaction.mockImplementation(async (callback: (trx: any) => Promise<void>) => {
      events.push('db-start');
      await callback({
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockImplementation(async () => {
            events.push('db-write');
          }),
        }),
      });
      events.push('db-commit');
    });
    redis.set.mockImplementation(async () => {
      events.push('redis-terminal-marker');
      return 'OK';
    });

    await service.updateDbTx('app-1', 'tx-1', 'org-1', { status: 'Success' } as any, true);

    expect(events).toEqual(['db-start', 'db-write', 'db-commit', 'redis-terminal-marker']);
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('app-1:tx-1'), '1', 'EX', expect.any(Number));
  });

  it('buffers non-terminal updates and only writes to DB during flushBatchBuffer', async () => {
    let updateCalled = false;
    db.transaction.mockImplementation(async (callback: (trx: any) => Promise<void>) => {
      await callback({
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockImplementation(async () => {
            updateCalled = true;
          }),
        }),
      });
    });

    await service.updateDbTx('app-1', 'tx-2', 'org-1', { confirmations: 5 } as any, false);

    expect(updateCalled).toBe(false);
    expect(redis.set).not.toHaveBeenCalled();

    await service.flushBatchBuffer();

    expect(updateCalled).toBe(true);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('fails immediately and does not set Redis terminal marker if DB transaction fails on terminal update', async () => {
    db.transaction.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.updateDbTx('app-1', 'tx-3', 'org-1', { status: 'Failed' } as any, true)).rejects.toThrow(
      'database unavailable',
    );

    expect(redis.set).not.toHaveBeenCalled();
  });
});
