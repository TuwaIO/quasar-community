import { describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', () => {
  class Redis {
    constructor(readonly url: string) {}
  }
  class Cluster {}
  return { default: Redis, Redis, Cluster };
});

import { BULLMQ_DEFAULT_JOB_OPTIONS, bullRootOptions } from './bullmq-connection.factory';

describe('bullRootOptions', () => {
  // Every module registers the shared BullMQ config, and whichever registration wins sets the defaults of every queue:
  // they all carry the same cleanup, so no queue keeps its finished jobs in Redis forever
  it('gives every queue the cleanup of finished jobs, with the connection', () => {
    const config = { get: (key: string) => (key === 'REDIS_API_URL' ? 'redis://localhost:6379' : undefined) };
    const options = bullRootOptions(config as never);

    expect(options.connection).toBeDefined();
    expect(options.defaultJobOptions).toEqual(BULLMQ_DEFAULT_JOB_OPTIONS);
    expect(BULLMQ_DEFAULT_JOB_OPTIONS).toEqual({
      removeOnComplete: { age: 3600, limit: 1000 },
      removeOnFail: { age: 86400, limit: 1000 },
    });
  });

  // BullMQ trims by `count` in one Lua script without a limit: on a set with a backlog the first finished job deletes
  // all of it at once, Redis answers BUSY for minutes and the cluster may fail the shard over (staging, 2026-10-19).
  // By `age` it removes at most `limit` jobs per finished job, so a backlog drains in small steps.
  it('trims finished jobs by age in bounded steps, never by count', () => {
    for (const keep of [BULLMQ_DEFAULT_JOB_OPTIONS.removeOnComplete, BULLMQ_DEFAULT_JOB_OPTIONS.removeOnFail]) {
      expect(keep).not.toHaveProperty('count');
      expect(keep).toMatchObject({ age: expect.any(Number), limit: expect.any(Number) });
      expect((keep as { limit: number }).limit).toBeLessThanOrEqual(1000);
    }
  });
});
