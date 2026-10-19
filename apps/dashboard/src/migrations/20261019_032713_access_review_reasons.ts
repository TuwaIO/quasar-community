import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres';

// The weekly access review: finer reasons for an SSH session, each within the four the DPA names (deployments and
// migrations, backups and restores, incidents, work the admin panel cannot do), what was done in it, and the hash of
// its connection that the answer of its sign-in prompt is matched by.

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_access_reviews_server_sessions_reason" ADD VALUE 'config' BEFORE 'restore';
  ALTER TYPE "public"."enum_access_reviews_server_sessions_reason" ADD VALUE 'server_update' BEFORE 'admin_cannot';
  ALTER TYPE "public"."enum_access_reviews_server_sessions_reason" ADD VALUE 'checks' BEFORE 'admin_cannot';
  ALTER TABLE "access_reviews_server_sessions" ADD COLUMN "connection" varchar;
  ALTER TABLE "access_reviews_server_sessions" ADD COLUMN "work" varchar;`);
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "access_reviews_server_sessions" ALTER COLUMN "reason" SET DATA TYPE text;
  UPDATE "access_reviews_server_sessions" SET "reason" = CASE "reason" WHEN 'config' THEN 'migration' WHEN 'server_update' THEN 'admin_cannot' WHEN 'checks' THEN 'admin_cannot' ELSE "reason" END;
  DROP TYPE "public"."enum_access_reviews_server_sessions_reason";
  CREATE TYPE "public"."enum_access_reviews_server_sessions_reason" AS ENUM('migration', 'restore', 'incident', 'admin_cannot');
  ALTER TABLE "access_reviews_server_sessions" ALTER COLUMN "reason" SET DATA TYPE "public"."enum_access_reviews_server_sessions_reason" USING "reason"::"public"."enum_access_reviews_server_sessions_reason";
  ALTER TABLE "access_reviews_server_sessions" DROP COLUMN "connection";
  ALTER TABLE "access_reviews_server_sessions" DROP COLUMN "work";`);
}
