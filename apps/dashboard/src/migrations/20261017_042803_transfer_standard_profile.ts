import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// The standard flow profile and TUWA's position as importer (open-source-plans/13-policies-production.md, 22.3, with
// the changes of 23.2 after the lawyer's second answer of 2026-10-17). A separate migration: 20261015_121329 is already
// applied on staging.
// - `importer_positions` holds TUWA's position as data importer in approved versions; new packages name the latest; a
//   withdrawn one says what it means for the clauses in force (`withdrawal_effect`);
// - `transfer_standing_offers` holds TUWA's standing offer for flows on the standard flow profile (Module Two), with
//   the versions it names, its conditions and its record (`policy_acceptances` of the new kind `tuwa_standing_offer`);
// - `data_transfers.importer_position` names the version of the position a package rests on;
// - `organizations.keep_webhook_responses` is off while the clauses rest on the profile: the engine keeps only the
//   status of each webhook response.

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_importer_positions_status" AS ENUM('approved', 'withdrawn');
  CREATE TYPE "public"."enum_importer_positions_withdrawal_effect" AS ENUM('new_packages', 'reassess', 'suspend');
  CREATE TYPE "public"."enum_transfer_standing_offers_status" AS ENUM('active', 'withdrawn');
  ALTER TYPE "public"."enum_policy_acceptances_kind" ADD VALUE 'tuwa_standing_offer' BEFORE 'authority_check';
  CREATE TABLE "importer_positions" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"version" varchar NOT NULL,
  	"scope" varchar NOT NULL,
  	"facts" varchar NOT NULL,
  	"conclusion" varchar NOT NULL,
  	"review_triggers" varchar NOT NULL,
  	"responsible" varchar NOT NULL,
  	"review_by" timestamp(3) with time zone NOT NULL,
  	"status" "enum_importer_positions_status" DEFAULT 'approved',
  	"withdrawn_reason" varchar,
  	"withdrawal_effect" "enum_importer_positions_withdrawal_effect",
  	"approved_on" timestamp(3) with time zone,
  	"approved_by_id" varchar,
  	"approved_by_email" varchar,
  	"text_sha256" varchar,
  	"withdrawn_at" timestamp(3) with time zone,
  	"withdrawn_by_email" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "transfer_standing_offers" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"confirmed" boolean,
  	"status" "enum_transfer_standing_offers_status" DEFAULT 'active',
  	"withdrawn_reason" varchar,
  	"offered_at" timestamp(3) with time zone,
  	"statement" varchar,
  	"assessment_version" varchar,
  	"scc_module2_id" varchar,
  	"assessment_id" varchar,
  	"dpa_id" varchar,
  	"importer_position" jsonb,
  	"conditions" jsonb,
  	"record_id" varchar,
  	"signatory_id" varchar,
  	"signatory_email" varchar,
  	"signatory_name" varchar,
  	"withdrawn_at" timestamp(3) with time zone,
  	"withdrawn_by_email" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "organizations" ADD COLUMN "keep_webhook_responses" boolean DEFAULT true;
  ALTER TABLE "data_transfers" ADD COLUMN "importer_position" jsonb;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "importer_positions_id" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "transfer_standing_offers_id" varchar;
  ALTER TABLE "importer_positions" ADD CONSTRAINT "importer_positions_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "transfer_standing_offers" ADD CONSTRAINT "transfer_standing_offers_scc_module2_id_policy_versions_id_fk" FOREIGN KEY ("scc_module2_id") REFERENCES "public"."policy_versions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "transfer_standing_offers" ADD CONSTRAINT "transfer_standing_offers_assessment_id_policy_versions_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."policy_versions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "transfer_standing_offers" ADD CONSTRAINT "transfer_standing_offers_dpa_id_policy_versions_id_fk" FOREIGN KEY ("dpa_id") REFERENCES "public"."policy_versions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "transfer_standing_offers" ADD CONSTRAINT "transfer_standing_offers_record_id_policy_acceptances_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."policy_acceptances"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "transfer_standing_offers" ADD CONSTRAINT "transfer_standing_offers_signatory_id_users_id_fk" FOREIGN KEY ("signatory_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "importer_positions_version_idx" ON "importer_positions" USING btree ("version");
  CREATE INDEX "importer_positions_status_idx" ON "importer_positions" USING btree ("status");
  CREATE INDEX "importer_positions_approved_on_idx" ON "importer_positions" USING btree ("approved_on");
  CREATE INDEX "importer_positions_approved_by_idx" ON "importer_positions" USING btree ("approved_by_id");
  CREATE INDEX "importer_positions_updated_at_idx" ON "importer_positions" USING btree ("updated_at");
  CREATE INDEX "importer_positions_created_at_idx" ON "importer_positions" USING btree ("created_at");
  CREATE INDEX "transfer_standing_offers_status_idx" ON "transfer_standing_offers" USING btree ("status");
  CREATE INDEX "transfer_standing_offers_offered_at_idx" ON "transfer_standing_offers" USING btree ("offered_at");
  CREATE INDEX "transfer_standing_offers_scc_module2_idx" ON "transfer_standing_offers" USING btree ("scc_module2_id");
  CREATE INDEX "transfer_standing_offers_assessment_idx" ON "transfer_standing_offers" USING btree ("assessment_id");
  CREATE INDEX "transfer_standing_offers_dpa_idx" ON "transfer_standing_offers" USING btree ("dpa_id");
  CREATE INDEX "transfer_standing_offers_record_idx" ON "transfer_standing_offers" USING btree ("record_id");
  CREATE INDEX "transfer_standing_offers_signatory_idx" ON "transfer_standing_offers" USING btree ("signatory_id");
  CREATE INDEX "transfer_standing_offers_updated_at_idx" ON "transfer_standing_offers" USING btree ("updated_at");
  CREATE INDEX "transfer_standing_offers_created_at_idx" ON "transfer_standing_offers" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_importer_positions_fk" FOREIGN KEY ("importer_positions_id") REFERENCES "public"."importer_positions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_transfer_standing_offers_fk" FOREIGN KEY ("transfer_standing_offers_id") REFERENCES "public"."transfer_standing_offers"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_importer_positions_id_idx" ON "payload_locked_documents_rels" USING btree ("importer_positions_id");
  CREATE INDEX "payload_locked_documents_rels_transfer_standing_offers_i_idx" ON "payload_locked_documents_rels" USING btree ("transfer_standing_offers_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // The references to the two tables go first: dropping a table with CASCADE removes them already
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_importer_positions_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_transfer_standing_offers_fk";
  DROP INDEX "payload_locked_documents_rels_importer_positions_id_idx";
  DROP INDEX "payload_locked_documents_rels_transfer_standing_offers_i_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "importer_positions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "transfer_standing_offers_id";
  ALTER TABLE "importer_positions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "transfer_standing_offers" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "importer_positions" CASCADE;
  DROP TABLE "transfer_standing_offers" CASCADE;
  ALTER TABLE "policy_acceptances" ALTER COLUMN "kind" SET DATA TYPE text;
  DROP TYPE "public"."enum_policy_acceptances_kind";
  CREATE TYPE "public"."enum_policy_acceptances_kind" AS ENUM('signup', 'account', 'organization_dpa', 'organization_scc', 'tuwa_scc', 'scc_evidence', 'transfer_review', 'authority_check');
  ALTER TABLE "policy_acceptances" ALTER COLUMN "kind" SET DATA TYPE "public"."enum_policy_acceptances_kind" USING "kind"::"public"."enum_policy_acceptances_kind";
  ALTER TABLE "organizations" DROP COLUMN "keep_webhook_responses";
  ALTER TABLE "data_transfers" DROP COLUMN "importer_position";
  DROP TYPE "public"."enum_importer_positions_status";
  DROP TYPE "public"."enum_importer_positions_withdrawal_effect";
  DROP TYPE "public"."enum_transfer_standing_offers_status";`)
}
