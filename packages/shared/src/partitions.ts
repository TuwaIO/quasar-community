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
