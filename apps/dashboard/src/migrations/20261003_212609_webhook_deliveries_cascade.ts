import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Deleting a webhook endpoint deletes its deliveries in the database.
//
// Payload gives every relationship column `ON DELETE set null`, and the
// required `endpoint` of a delivery is also NOT NULL, so Postgres could never
// carry out the action: deleting an endpoint that still had a delivery failed
// with a not-null violation. WebhookEndpoints.beforeDelete deleted the
// deliveries first, through the Local API, one row at a time, with every row
// loaded into memory; the engine writes deliveries meanwhile, and one recorded
// between that hook and the endpoint's DELETE failed the whole deletion. With
// the cascade, the endpoint's DELETE removes its deliveries in the same
// statement, and the hook is gone.
//
// Payload cannot express the cascade in the config, so the JSON snapshot is
// kept as generated: the next migrate:create diffs against the config and does
// not undo this. A squash regenerates the init migration with `set null`;
// scripts/transform-init-migration.ts restores the cascade there, and
// src/tests/migrations-cascades.test.ts fails if neither does.
//
// Adding the constraint on the partitioned parent adds it to every partition
// and checks the existing rows, which all satisfy it already: the old key was
// valid. Both statements run in the migration's transaction, so there is no
// moment without the key.
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk";
  ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk";
  ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE set null ON UPDATE no action;`)
}
