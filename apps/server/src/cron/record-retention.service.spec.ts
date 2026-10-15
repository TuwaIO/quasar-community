import { getTableName, SQL, Table } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecordRetentionService } from './record-retention.service';

/** Runs one purge at `now` and returns each delete as [table, cutoff]. */
async function purgedAt(now: string): Promise<string[][]> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));

  const deletes: string[][] = [];
  const db = {
    delete: vi.fn((table: Table) => ({
      where: vi.fn(async (condition: SQL) => {
        const query = new PgDialect().sqlToQuery(condition);
        expect(query.sql).toContain('"deleted_at" <');
        deletes.push([getTableName(table), String(query.params[0])]);
        return { rowCount: 0 };
      }),
    })),
  };
  const redlock = { using: vi.fn(async (_keys: string[], _ttl: number, run: () => Promise<void>) => run()) };

  await new RecordRetentionService(db as never, redlock as never).purgeExpiredRecords();
  expect(redlock.using).toHaveBeenCalledTimes(1);
  return deletes;
}

describe('RecordRetentionService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The Privacy Policy: the email of a deleted account blocks re-registration for 30 days; records of revoked
  // memberships and deleted organizations are kept for 12 months
  it('deletes the records past their retention periods', async () => {
    expect(await purgedAt('2026-10-14T03:00:00.000Z')).toEqual([
      ['deleted_accounts', '2026-09-14T03:00:00.000Z'],
      ['deleted_organization_members', '2025-10-14T03:00:00.000Z'],
      ['deleted_organizations', '2025-10-14T03:00:00.000Z'],
    ]);
  });
});
