import { describe, expect, it } from 'vitest';

import { createPartitionSql, monthlyPartition, monthlyPartitionsBetween } from './partitions';

describe('monthly partitions', () => {
  it('names the UTC calendar month of a date and bounds it by the first days of that month and the next', () => {
    expect(monthlyPartition('transactions', new Date('2026-10-15T12:00:00Z'))).toEqual({
      table: 'transactions',
      name: 'transactions_y2026_m10',
      from: '2026-10-01',
      to: '2026-11-01',
    });
  });

  it('takes the UTC month at the edges of a month', () => {
    expect(monthlyPartition('webhook_deliveries', new Date('2026-10-31T23:30:00Z')).name).toBe(
      'webhook_deliveries_y2026_m10',
    );
    expect(monthlyPartition('transactions', new Date('2026-12-31T23:59:59.999Z')).to).toBe('2027-01-01');
    expect(monthlyPartition('transactions', new Date('2027-01-01T00:00:00Z')).name).toBe('transactions_y2027_m01');
  });

  it('lists every month between two dates, both included', () => {
    expect(
      monthlyPartitionsBetween('transactions', new Date('2026-11-20T00:00:00Z'), new Date('2027-02-01T00:00:00Z')).map(
        (partition) => partition.name,
      ),
    ).toEqual(['transactions_y2026_m11', 'transactions_y2026_m12', 'transactions_y2027_m01', 'transactions_y2027_m02']);
    expect(
      monthlyPartitionsBetween('transactions', new Date('2026-10-02T00:00:00Z'), new Date('2026-10-30T00:00:00Z')),
    ).toHaveLength(1);
    expect(
      monthlyPartitionsBetween('transactions', new Date('2026-10-02T00:00:00Z'), new Date('2026-09-30T00:00:00Z')),
    ).toEqual([]);
  });

  it('builds an idempotent CREATE statement', () => {
    expect(createPartitionSql(monthlyPartition('transactions', new Date('2026-10-15T00:00:00Z')))).toBe(
      `CREATE TABLE IF NOT EXISTS "transactions_y2026_m10" PARTITION OF "transactions" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01')`,
    );
  });

  it('refuses a table that is not partitioned by month', () => {
    expect(() => monthlyPartition('users' as never, new Date())).toThrow('not partitioned by month');
  });
});
