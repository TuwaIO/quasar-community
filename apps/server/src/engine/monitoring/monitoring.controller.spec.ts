import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { isTransientDatabaseTermination, MonitoringController } from './monitoring.controller';

describe('the health check', () => {
  const persistence = (status: string) =>
    `rdb_last_bgsave_status:${status}\r\naof_enabled:1\r\naof_last_write_status:ok`;
  const controller = (status: string) => {
    const redis = {
      ping: async () => 'PONG',
      info: async (section: string) =>
        section === 'persistence' ? persistence(status) : 'used_memory:1\r\nmaxmemory:0\r\nmaxmemory_policy:noeviction',
    };
    const db = { execute: async () => [] };
    const queue = { getWaitingCount: async () => 0 };
    return new MonitoringController(redis as never, db as never, db as never, queue as never, queue as never);
  };
  const answerOf = async (promise: Promise<unknown>) => {
    try {
      return { status: 200, body: await promise };
    } catch (e) {
      if (!(e instanceof ServiceUnavailableException)) throw e;
      return { status: 503, body: e.getResponse() };
    }
  };

  it('is healthy while Redis answers and takes writes', async () => {
    expect(await answerOf(controller('ok').checkHealth({ headers: {} }))).toMatchObject({
      status: 200,
      body: { success: true, redis: 'ok' },
    });
  });

  it('fails while Redis answers PING but refuses writes, with the reason only for an internal caller', async () => {
    expect(await answerOf(controller('err').checkHealth({ headers: {} }))).toMatchObject({
      status: 503,
      body: { success: false, redis: 'error: the last snapshot to disk failed (MISCONF)' },
    });
    expect(
      await answerOf(controller('err').checkHealth({ headers: { 'x-forwarded-for': '203.0.113.1' } })),
    ).toMatchObject({ status: 503, body: { redis: 'error' } });
  });
});

describe('isTransientDatabaseTermination', () => {
  it.each(['57P01', '57P02', '57P03'])('recognizes PostgreSQL shutdown code %s', (code) => {
    expect(isTransientDatabaseTermination({ code })).toBe(true);
  });

  it('does not classify ordinary database errors as transient shutdowns', () => {
    expect(isTransientDatabaseTermination({ code: '23505' })).toBe(false);
    expect(isTransientDatabaseTermination(new Error('connection refused'))).toBe(false);
    expect(isTransientDatabaseTermination(null)).toBe(false);
  });
});
