/**
 * Monthly range partitions of `transactions` and `webhook_deliveries`.
 *
 * Months are UTC calendar months: PostgreSQL reads the date bounds in its own time zone, which is UTC on every Quasar
 * deployment. The engine's PartitionManagerService creates the current month and the two after it; the Cloud import
 * creates every month its data falls in.
 */

export const PARTITIONED_TABLES = ['transactions', 'webhook_deliveries'] as const;

export type PartitionedTable = (typeof PARTITIONED_TABLES)[number];

export interface MonthlyPartition {
  table: PartitionedTable;
  /** `<table>_y<YYYY>_m<MM>` */
  name: string;
  /** First day of the month, `YYYY-MM-DD`, inclusive */
  from: string;
  /** First day of the next month, `YYYY-MM-DD`, exclusive */
  to: string;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** The partition of `table` that holds rows created at `date`. */
export function monthlyPartition(table: PartitionedTable, date: Date): MonthlyPartition {
  if (!(PARTITIONED_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Table ${table} is not partitioned by month`);
  }
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const month = String(start.getUTCMonth() + 1).padStart(2, '0');
  return { table, name: `${table}_y${start.getUTCFullYear()}_m${month}`, from: isoDate(start), to: isoDate(end) };
}

/** The partitions of `table` for every month from `from` to `to`, both included; empty when `to` is earlier. */
export function monthlyPartitionsBetween(table: PartitionedTable, from: Date, to: Date): MonthlyPartition[] {
  const partitions: MonthlyPartition[] = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor <= last) {
    partitions.push(monthlyPartition(table, cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return partitions;
}

/**
 * `CREATE TABLE IF NOT EXISTS … PARTITION OF …` for a partition from {@link monthlyPartition}. Every part of it comes
 * from the table allow-list and a computed date, never from input. It still fails if another partition overlaps the
 * month under a different name.
 */
export function createPartitionSql(partition: MonthlyPartition): string {
  return `CREATE TABLE IF NOT EXISTS "${partition.name}" PARTITION OF "${partition.table}" FOR VALUES FROM ('${partition.from}') TO ('${partition.to}')`;
}

/** The `_y<YYYY>_m<MM>` suffix of {@link monthlyPartition}, with the year and month captured. */
const MONTH_SUFFIX = /^_y(\d{4})_m(0[1-9]|1[0-2])$/;

/** `<table>_y<YYYY>_m<MM>` of {@link monthlyPartition}: the first day of its month. */
function partitionMonth(table: PartitionedTable, name: string): Date | undefined {
  const match = name.startsWith(table) ? MONTH_SUFFIX.exec(name.slice(table.length)) : null;
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : undefined;
}

/**
 * The monthly partitions of `table`, among `names`, whose rows have all reached the retention period: those whose first
 * day is `keepMonths` months or more before `now`. No row is kept longer than `keepMonths` months, and the rows of a
 * partition go together, so some go earlier. Names that are not monthly partitions of `table` are ignored.
 */
export function expiredMonthlyPartitions(
  table: PartitionedTable,
  names: readonly string[],
  now: Date,
  keepMonths: number,
): string[] {
  return names.filter((name) => {
    const start = partitionMonth(table, name);
    if (!start) return false;
    const expiresAt = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + keepMonths, 1);
    return now.getTime() >= expiresAt;
  });
}

/**
 * Statements that detach a monthly partition from `table` and drop it. The name must be a monthly partition of the table,
 * as {@link expiredMonthlyPartitions} returns, so no input reaches the SQL.
 */
export function dropPartitionSql(table: PartitionedTable, name: string): string[] {
  if (!(PARTITIONED_TABLES as readonly string[]).includes(table) || !partitionMonth(table, name)) {
    throw new Error(`${name} is not a monthly partition of ${table}`);
  }
  return [`ALTER TABLE "${table}" DETACH PARTITION "${name}"`, `DROP TABLE IF EXISTS "${name}"`];
}
