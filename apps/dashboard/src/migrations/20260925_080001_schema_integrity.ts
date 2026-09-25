import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Brings the database back in line with the Payload config in two places.
//
// 1. webhook_endpoints.tx_type — `required: true, defaultValue: '*'` in
//    WebhookEndpoints.ts. Rows created before that hold NULL or '', and both
//    meant "every type" to the dispatcher, so they are backfilled to '*' first;
//    SET NOT NULL would fail on any database that still has them.
//
// 2. app_invoices.tx_hash — unique again (`unique: true` in AppInvoices.ts):
//    one on-chain payment settles one invoice. It used to be a hand-written
//    partial index (20260608_120000_app_invoices_unique_tx_hash) that the
//    2026-09-09 squash into the init migration dropped. NULLs stay distinct,
//    so unpaid invoices are unaffected. If two invoices already share a hash
//    the migration stops with the conflicting values instead of guessing which
//    record is the real one — resolve them by hand and rerun.
//
// `payload migrate:create` also emitted statements that drop the composite
// (id, created_at) primary keys of the partitioned `transactions` and
// `webhook_deliveries`, add single-column ones, restore foreign keys to them
// and rebuild `transactions_tx_key_idx` without `created_at`. They come from
// diffing the init snapshot, which scripts/transform-init-migration.ts
// rewrote for partitioning, against a config that knows nothing about
// partitions. They are not schema changes and were removed (AGENTS.md,
// "Creating a Payload migration"). This migration's JSON snapshot is kept as
// generated, so the next migrate:create diffs against the config and does not
// produce them again.
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   UPDATE "webhook_endpoints" SET "tx_type" = '*' WHERE "tx_type" IS NULL OR "tx_type" = '';
  ALTER TABLE "webhook_endpoints" ALTER COLUMN "tx_type" SET DEFAULT '*';
  ALTER TABLE "webhook_endpoints" ALTER COLUMN "tx_type" SET NOT NULL;
  DO $$
  DECLARE dup text;
  BEGIN
    SELECT string_agg(tx_hash, ', ') INTO dup FROM (
      SELECT tx_hash FROM "app_invoices" WHERE tx_hash IS NOT NULL GROUP BY tx_hash HAVING count(*) > 1
    ) d;
    IF dup IS NOT NULL THEN
      RAISE EXCEPTION 'app_invoices.tx_hash is shared by several invoices (%). One on-chain payment must settle one invoice: resolve these rows by hand, then rerun the migration.', dup;
    END IF;
  END $$;
  DROP INDEX "app_invoices_tx_hash_idx";
  CREATE UNIQUE INDEX "app_invoices_tx_hash_idx" ON "app_invoices" USING btree ("tx_hash");`)
}

// Restores the previous shape only. Backfilled rows keep '*', which the
// dispatcher reads exactly as it read NULL and ''.
export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "app_invoices_tx_hash_idx";
  CREATE INDEX "app_invoices_tx_hash_idx" ON "app_invoices" USING btree ("tx_hash");
  ALTER TABLE "webhook_endpoints" ALTER COLUMN "tx_type" DROP DEFAULT;
  ALTER TABLE "webhook_endpoints" ALTER COLUMN "tx_type" DROP NOT NULL;`)
}
