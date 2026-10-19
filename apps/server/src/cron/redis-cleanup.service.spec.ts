import { describe, expect, it, vi } from 'vitest';

import { RedisCleanupService } from './redis-cleanup.service';

/** A queue holding `completed` finished jobs older than the grace period, removed by `clean` up to its limit. */
function queueWith(completed: number, failed = 0) {
  const left = { completed, failed };
  return {
    left,
    clean: vi.fn(async (_grace: number, limit: number, type: 'completed' | 'failed') => {
      const removed = Math.min(limit, left[type]);
      left[type] -= removed;
      return Array.from({ length: removed }, (_, i) => `${type}-${i}`);
    }),
  };
}

/** The service with Redis and the database first, the outbox queue next and empty queues after it, however many. */
const serviceWith = (outbox: ReturnType<typeof queueWith>) => {
  const args = Array.from({ length: RedisCleanupService.length }, (_, i) =>
    i < 2 ? {} : i === 2 ? outbox : queueWith(0),
  );
  return new (RedisCleanupService as unknown as new (...deps: unknown[]) => RedisCleanupService)(...args);
};

describe('RedisCleanupService', () => {
  // `clean(grace, limit)` removes at most `limit` jobs: with 100 an hour it fell behind the outbox processor, which
  // finishes 720 jobs an hour, and the shard of `{outbox}` filled up
  it('removes every finished job past its grace period, in batches, not just 100 an hour', async () => {
    const outbox = queueWith(17_280 * 3, 1_200);
    await serviceWith(outbox).cleanupBullMQOrphans();

    expect(outbox.left).toEqual({ completed: 0, failed: 0 });
    for (const [grace, limit, type] of outbox.clean.mock.calls) {
      expect(limit).toBeLessThanOrEqual(1000);
      expect(grace).toBe(type === 'completed' ? 3600 * 1000 : 86400 * 1000);
    }
  });

  it('stops after 100 000 jobs of a queue in one run, so a large backlog never holds Redis for long', async () => {
    const outbox = queueWith(250_000);
    await serviceWith(outbox).cleanupBullMQOrphans();
    expect(outbox.left.completed).toBe(150_000);
  });
});
