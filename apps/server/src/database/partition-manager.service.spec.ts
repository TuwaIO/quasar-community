import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PartitionManagerService } from './partition-manager.service';

const originalTimeZone = process.env.TZ;

/** Runs one partition check at `now` and returns the partitions it asked for, as [name, from, to]. */
async function partitionsCreatedAt(now: string): Promise<string[][]> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));

  const statements: string[] = [];
  const db = {
    execute: vi.fn(async (query: SQL) => {
      statements.push(new PgDialect().sqlToQuery(query).sql);
    }),
  };
  const redlock = { using: vi.fn(async (_keys: string[], _ttl: number, run: () => Promise<void>) => run()) };

  await new PartitionManagerService(db as never, redlock as never).ensurePartitions();

  return statements.flatMap((statement) => {
    const match = /'(transactions_y\d{4}_m\d{2})',\s*'transactions',\s*'([\d-]+)',\s*'([\d-]+)'/.exec(statement);
    return match ? [[match[1], match[2], match[3]]] : [];
  });
}

describe('PartitionManagerService', () => {
  afterEach(() => {
    process.env.TZ = originalTimeZone;
    vi.useRealTimers();
  });

  it.each(['UTC', 'Europe/Kyiv', 'America/New_York', 'Asia/Tokyo'])(
    'creates calendar-month partitions in UTC when the process runs in %s',
    async (timeZone) => {
      process.env.TZ = timeZone;

      expect(await partitionsCreatedAt('2026-10-15T12:00:00Z')).toEqual([
        ['transactions_y2026_m10', '2026-10-01', '2026-11-01'],
        ['transactions_y2026_m11', '2026-11-01', '2026-12-01'],
        ['transactions_y2026_m12', '2026-12-01', '2027-01-01'],
      ]);
    },
  );

  it('names the months by UTC on the evening of the last day of a month', async () => {
    // 23:30 UTC on 31 October is already 1 November in Kyiv
    process.env.TZ = 'Europe/Kyiv';

    expect((await partitionsCreatedAt('2026-10-31T23:30:00Z'))[0]).toEqual([
      'transactions_y2026_m10',
      '2026-10-01',
      '2026-11-01',
    ]);
  });
});
