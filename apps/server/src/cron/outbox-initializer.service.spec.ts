import { describe, expect, it, vi } from 'vitest';

import { BULLMQ_DEFAULT_JOB_OPTIONS } from '../common/bullmq-connection.factory';
import { OutboxInitializerService } from './outbox-initializer.service';

describe('OutboxInitializerService', () => {
  // The processor runs every 5 seconds, 17 280 jobs a day: a finished one that stayed in Redis filled the shard of
  // `{outbox}` (RedisAPIMemoryHigh on staging and production, 2026-10-19)
  it('schedules the outbox jobs with the cleanup of finished jobs, whatever the defaults of the queue', async () => {
    const queue = {
      getJobSchedulers: vi.fn(async () => []),
      removeJobScheduler: vi.fn(),
      upsertJobScheduler: vi.fn(async () => undefined),
    };
    await new OutboxInitializerService(queue as never).onApplicationBootstrap();

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    for (const [, , template] of queue.upsertJobScheduler.mock.calls as unknown as [
      string,
      unknown,
      { opts?: object },
    ][]) {
      expect(template.opts).toMatchObject({ removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } });
      expect(template.opts).toEqual(BULLMQ_DEFAULT_JOB_OPTIONS);
    }
  });
});
