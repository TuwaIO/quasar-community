import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Columns that Payload 3.90 adds to existing collections; the 3.90 code reads both, so the dashboard fails with
// "column does not exist" until this migration runs.
//
// 1. users.reset_password_requested_at — Payload auth now records when a password reset was last requested.
// 2. media._objectkey — @payloadcms/storage-s3 stores the object key of each upload.
//
// Both are nullable, so existing rows need no backfill. Neither table is partitioned.
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_password_requested_at" timestamp(3) with time zone;
  ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "_objectkey" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" DROP COLUMN IF EXISTS "reset_password_requested_at";
  ALTER TABLE "media" DROP COLUMN IF EXISTS "_objectkey";`)
}
