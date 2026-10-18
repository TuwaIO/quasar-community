import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres';

// Acceptance of the Terms of Service and the Data Processing Addendum with records, new versions of them, and the
// standard contractual clauses (open-source-plans/13-policies-production.md, parts 2 and 3, 13.9).
// - `policy_versions` archives every publication of a policy shown for acceptance or signature (Terms, DPA, the clauses
//   of Modules Two and Three, the transfer assessment) as a numbered revision, its text here and its PDF in object
//   storage, with the decision on a later version;
// - `policy_acceptances` records who accepted or signed which versions, for which organization, with the exact text
//   confirmed, TUWA's decisions on the clauses and its checks of who may act for an organization (17.6);
// - `policy_notices` records the emails that told owners about a decided version;
// - `data_transfers` and `transfer_documents` hold the packages of clauses both parties sign, their evidence copies
//   and the reviews of the answers;
// - `organizations.intake_closes_at` is when a version the organization has not accepted closes its intake, and
//   `organizations.data_processing` gains `scc` and `not_required`, which open it.
// Round 10 (13 §20): `data_transfers` gains TUWA's conclusion on each flow (`flow_assessment`, statuses `assessment`,
// `refused`, `declined`), the owner's decline and the controller's address for notices; `policy_notices` gains the
// copies to a controller under Module Three and their delivery; `data_access_log` and `access_reviews` record each
// view of customer data in the admin panel and its monthly review.
// The hosted edition writes them; a Community Edition node has the tables but never uses them.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_policy_versions_changed_areas" AS ENUM('instructions', 'data', 'security', 'transfers', 'rights', 'terms', 'wording');
  CREATE TYPE "public"."enum_policy_versions_policy" AS ENUM('terms', 'dpa', 'scc-module-2', 'scc-module-3', 'transfer-assessment');
  CREATE TYPE "public"."enum_policy_versions_acceptance" AS ENUM('undecided', 'notice', 'required');
  CREATE TYPE "public"."enum_policy_acceptances_kind" AS ENUM('signup', 'account', 'organization_dpa', 'organization_scc', 'tuwa_scc', 'scc_evidence', 'transfer_review', 'authority_check');
  CREATE TYPE "public"."enum_policy_acceptances_authority_trigger" AS ENUM('owner_left', 'new_owner', 'dispute', 'unusual_details');
  CREATE TYPE "public"."enum_policy_acceptances_authority_method" AS ENUM('register_extract', 'power_of_attorney', 'management_letter', 'other');
  CREATE TYPE "public"."enum_policy_notices_decision" AS ENUM('notice', 'required');
  CREATE TYPE "public"."enum_data_transfers_status" AS ENUM('assessment', 'draft', 'review', 'awaiting_tuwa', 'concluded', 'not_required', 'withdrawn', 'superseded', 'closed_by_change', 'refused', 'declined');
  CREATE TYPE "public"."enum_transfer_documents_kind" AS ENUM('package', 'evidence');
  CREATE TYPE "public"."enum_data_access_log_viewed_collection" AS ENUM('transactions', 'apps', 'webhook-deliveries', 'webhook-endpoints', 'outbox_events', 'app-invoices');
  CREATE TYPE "public"."enum_data_access_log_operation" AS ENUM('list', 'record');
  CREATE TYPE "public"."enum_access_reviews_server_sessions_reason" AS ENUM('migration', 'restore', 'incident', 'admin_cannot');
  CREATE TYPE "public"."enum_access_reviews_findings_severity" AS ENUM('high', 'medium');
  CREATE TYPE "public"."enum_access_reviews_status" AS ENUM('collecting', 'ready', 'confirmed');
  CREATE TYPE "public"."enum_policy_notices_audience" AS ENUM('owner', 'controller');
  ALTER TYPE "public"."enum_organizations_data_processing" ADD VALUE 'scc';
  ALTER TYPE "public"."enum_organizations_data_processing" ADD VALUE 'not_required';
  CREATE TABLE "policy_versions_changed_areas" (
  	"order" integer NOT NULL,
  	"parent_id" varchar NOT NULL,
  	"value" "enum_policy_versions_changed_areas",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "policy_versions" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"policy" "enum_policy_versions_policy" NOT NULL,
  	"title" varchar NOT NULL,
  	"version" varchar NOT NULL,
  	"revision" numeric NOT NULL,
  	"pdf_sha256" varchar NOT NULL,
  	"sections" jsonb NOT NULL,
  	"html" varchar NOT NULL,
  	"acceptance" "enum_policy_versions_acceptance" DEFAULT 'undecided' NOT NULL,
  	"customer_summary" varchar,
  	"decision_reason" varchar,
  	"effective_at" timestamp(3) with time zone,
  	"decided_at" timestamp(3) with time zone,
  	"decided_by_id" varchar,
  	"decided_by_email" varchar,
  	"prefix" varchar DEFAULT 'policy-archive',
  	"_objectkey" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric
  );
  
  CREATE TABLE "policy_acceptances_documents" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"version_id" varchar NOT NULL,
  	"policy" varchar NOT NULL,
  	"version_label" varchar NOT NULL,
  	"pdf_sha256" varchar NOT NULL
  );
  
  CREATE TABLE "policy_acceptances_statements" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar NOT NULL
  );
  
  CREATE TABLE "policy_acceptances_checklist" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar NOT NULL
  );
  
  CREATE TABLE "policy_acceptances" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"kind" "enum_policy_acceptances_kind" NOT NULL,
  	"user_id" varchar,
  	"user_email" varchar NOT NULL,
  	"user_name" varchar,
  	"role" varchar,
  	"organization_id" varchar,
  	"organization_original_id" varchar,
  	"organization_name" varchar,
  	"details_legal_name" varchar,
  	"details_country" varchar,
  	"details_registration_number" varchar,
  	"details_address" varchar,
  	"details_contact_name" varchar,
  	"details_contact_position" varchar,
  	"details_contact_email" varchar,
  	"transfer_id" varchar,
  	"package_sha256" varchar,
  	"evidence_sha256" varchar,
  	"decision" varchar,
  	"reason" varchar,
  	"checked_record_id" varchar,
  	"authority_trigger" "enum_policy_acceptances_authority_trigger",
  	"authority_method" "enum_policy_acceptances_authority_method",
  	"accepted_at" timestamp(3) with time zone NOT NULL,
  	"retain_until" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "policy_notices" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"version_id" varchar NOT NULL,
  	"policy" varchar NOT NULL,
  	"version_label" varchar NOT NULL,
  	"decision" "enum_policy_notices_decision" NOT NULL,
  	"effective_at" timestamp(3) with time zone NOT NULL,
  	"organization_id" varchar,
  	"organization_original_id" varchar,
  	"organization_name" varchar,
  	"recipient_id" varchar,
  	"recipient_email" varchar NOT NULL,
  	"queued_at" timestamp(3) with time zone NOT NULL,
  	"sent_at" timestamp(3) with time zone,
  	"provider_message_id" varchar,
  	"failed_at" timestamp(3) with time zone,
  	"error" varchar,
  	"retain_until" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "data_transfers" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"organization_id" varchar,
  	"organization_original_id" varchar,
  	"organization_name" varchar,
  	"status" "enum_data_transfers_status" DEFAULT 'draft' NOT NULL,
  	"facts" jsonb NOT NULL,
  	"exporter" jsonb,
  	"proposal" jsonb NOT NULL,
  	"module" numeric,
  	"authority_id" varchar,
  	"authorities_version" varchar,
  	"scc_version_id" varchar,
  	"assessment_version_id" varchar,
  	"dpa_version_id" varchar,
  	"prepared_at" timestamp(3) with time zone,
  	"package_id" varchar,
  	"package_sha256" varchar,
  	"evidence_id" varchar,
  	"evidence_sha256" varchar,
  	"exporter_record_id" varchar,
  	"tuwa_record_id" varchar,
  	"evidence_record_id" varchar,
  	"review_record_id" varchar,
  	"previous_id" varchar,
  	"retain_until" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "transfer_documents" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"organization_id" varchar,
  	"transfer_id" varchar,
  	"kind" "enum_transfer_documents_kind" NOT NULL,
  	"sha256" varchar NOT NULL,
  	"retain_until" timestamp(3) with time zone,
  	"prefix" varchar DEFAULT 'scc-packages',
  	"_objectkey" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric
  );
  
  ALTER TABLE "organizations" ADD COLUMN "intake_closes_at" timestamp(3) with time zone;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "policy_versions_id" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "policy_acceptances_id" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "policy_notices_id" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "data_transfers_id" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "transfer_documents_id" varchar;
  ALTER TABLE "policy_versions_changed_areas" ADD CONSTRAINT "policy_versions_changed_areas_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."policy_versions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "policy_acceptances_documents" ADD CONSTRAINT "policy_acceptances_documents_version_id_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."policy_versions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "policy_acceptances_documents" ADD CONSTRAINT "policy_acceptances_documents_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."policy_acceptances"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "policy_acceptances_statements" ADD CONSTRAINT "policy_acceptances_statements_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."policy_acceptances"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "policy_acceptances_checklist" ADD CONSTRAINT "policy_acceptances_checklist_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."policy_acceptances"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_transfer_id_data_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."data_transfers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_checked_record_id_policy_acceptances_id_fk" FOREIGN KEY ("checked_record_id") REFERENCES "public"."policy_acceptances"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "policy_notices" ADD CONSTRAINT "policy_notices_version_id_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."policy_versions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "policy_notices" ADD CONSTRAINT "policy_notices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "policy_notices" ADD CONSTRAINT "policy_notices_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_scc_version_id_policy_versions_id_fk" FOREIGN KEY ("scc_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_assessment_version_id_policy_versions_id_fk" FOREIGN KEY ("assessment_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_dpa_version_id_policy_versions_id_fk" FOREIGN KEY ("dpa_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_package_id_transfer_documents_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."transfer_documents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_evidence_id_transfer_documents_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."transfer_documents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_exporter_record_id_policy_acceptances_id_fk" FOREIGN KEY ("exporter_record_id") REFERENCES "public"."policy_acceptances"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_tuwa_record_id_policy_acceptances_id_fk" FOREIGN KEY ("tuwa_record_id") REFERENCES "public"."policy_acceptances"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_evidence_record_id_policy_acceptances_id_fk" FOREIGN KEY ("evidence_record_id") REFERENCES "public"."policy_acceptances"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_review_record_id_policy_acceptances_id_fk" FOREIGN KEY ("review_record_id") REFERENCES "public"."policy_acceptances"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "data_transfers" ADD CONSTRAINT "data_transfers_previous_id_data_transfers_id_fk" FOREIGN KEY ("previous_id") REFERENCES "public"."data_transfers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "transfer_documents" ADD CONSTRAINT "transfer_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "transfer_documents" ADD CONSTRAINT "transfer_documents_transfer_id_data_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."data_transfers"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "policy_versions_changed_areas_order_idx" ON "policy_versions_changed_areas" USING btree ("order");
  CREATE INDEX "policy_versions_changed_areas_parent_idx" ON "policy_versions_changed_areas" USING btree ("parent_id");
  CREATE INDEX "policy_versions_policy_idx" ON "policy_versions" USING btree ("policy");
  CREATE INDEX "policy_versions_pdf_sha256_idx" ON "policy_versions" USING btree ("pdf_sha256");
  CREATE INDEX "policy_versions_decided_by_idx" ON "policy_versions" USING btree ("decided_by_id");
  CREATE INDEX "policy_versions_updated_at_idx" ON "policy_versions" USING btree ("updated_at");
  CREATE INDEX "policy_versions_created_at_idx" ON "policy_versions" USING btree ("created_at");
  CREATE UNIQUE INDEX "policy_versions_filename_idx" ON "policy_versions" USING btree ("filename");
  CREATE UNIQUE INDEX "policy_revision_idx" ON "policy_versions" USING btree ("policy","revision");
  CREATE INDEX "policy_acceptances_documents_order_idx" ON "policy_acceptances_documents" USING btree ("_order");
  CREATE INDEX "policy_acceptances_documents_parent_id_idx" ON "policy_acceptances_documents" USING btree ("_parent_id");
  CREATE INDEX "policy_acceptances_documents_version_idx" ON "policy_acceptances_documents" USING btree ("version_id");
  CREATE INDEX "policy_acceptances_statements_order_idx" ON "policy_acceptances_statements" USING btree ("_order");
  CREATE INDEX "policy_acceptances_statements_parent_id_idx" ON "policy_acceptances_statements" USING btree ("_parent_id");
  CREATE INDEX "policy_acceptances_checklist_order_idx" ON "policy_acceptances_checklist" USING btree ("_order");
  CREATE INDEX "policy_acceptances_checklist_parent_id_idx" ON "policy_acceptances_checklist" USING btree ("_parent_id");
  CREATE INDEX "policy_acceptances_kind_idx" ON "policy_acceptances" USING btree ("kind");
  CREATE INDEX "policy_acceptances_user_idx" ON "policy_acceptances" USING btree ("user_id");
  CREATE INDEX "policy_acceptances_organization_idx" ON "policy_acceptances" USING btree ("organization_id");
  CREATE INDEX "policy_acceptances_organization_original_id_idx" ON "policy_acceptances" USING btree ("organization_original_id");
  CREATE INDEX "policy_acceptances_transfer_idx" ON "policy_acceptances" USING btree ("transfer_id");
  CREATE INDEX "policy_acceptances_checked_record_idx" ON "policy_acceptances" USING btree ("checked_record_id");
  CREATE INDEX "policy_acceptances_accepted_at_idx" ON "policy_acceptances" USING btree ("accepted_at");
  CREATE INDEX "policy_acceptances_retain_until_idx" ON "policy_acceptances" USING btree ("retain_until");
  CREATE INDEX "policy_acceptances_updated_at_idx" ON "policy_acceptances" USING btree ("updated_at");
  CREATE INDEX "policy_acceptances_created_at_idx" ON "policy_acceptances" USING btree ("created_at");
  CREATE INDEX "policy_notices_version_idx" ON "policy_notices" USING btree ("version_id");
  CREATE INDEX "policy_notices_organization_idx" ON "policy_notices" USING btree ("organization_id");
  CREATE INDEX "policy_notices_organization_original_id_idx" ON "policy_notices" USING btree ("organization_original_id");
  CREATE INDEX "policy_notices_recipient_idx" ON "policy_notices" USING btree ("recipient_id");
  CREATE INDEX "policy_notices_queued_at_idx" ON "policy_notices" USING btree ("queued_at");
  CREATE INDEX "policy_notices_retain_until_idx" ON "policy_notices" USING btree ("retain_until");
  CREATE INDEX "policy_notices_updated_at_idx" ON "policy_notices" USING btree ("updated_at");
  CREATE INDEX "policy_notices_created_at_idx" ON "policy_notices" USING btree ("created_at");
  CREATE INDEX "data_transfers_organization_idx" ON "data_transfers" USING btree ("organization_id");
  CREATE INDEX "data_transfers_organization_original_id_idx" ON "data_transfers" USING btree ("organization_original_id");
  CREATE INDEX "data_transfers_status_idx" ON "data_transfers" USING btree ("status");
  CREATE INDEX "data_transfers_scc_version_idx" ON "data_transfers" USING btree ("scc_version_id");
  CREATE INDEX "data_transfers_assessment_version_idx" ON "data_transfers" USING btree ("assessment_version_id");
  CREATE INDEX "data_transfers_dpa_version_idx" ON "data_transfers" USING btree ("dpa_version_id");
  CREATE INDEX "data_transfers_package_idx" ON "data_transfers" USING btree ("package_id");
  CREATE INDEX "data_transfers_package_sha256_idx" ON "data_transfers" USING btree ("package_sha256");
  CREATE INDEX "data_transfers_evidence_idx" ON "data_transfers" USING btree ("evidence_id");
  CREATE INDEX "data_transfers_exporter_record_idx" ON "data_transfers" USING btree ("exporter_record_id");
  CREATE INDEX "data_transfers_tuwa_record_idx" ON "data_transfers" USING btree ("tuwa_record_id");
  CREATE INDEX "data_transfers_evidence_record_idx" ON "data_transfers" USING btree ("evidence_record_id");
  CREATE INDEX "data_transfers_review_record_idx" ON "data_transfers" USING btree ("review_record_id");
  CREATE INDEX "data_transfers_previous_idx" ON "data_transfers" USING btree ("previous_id");
  CREATE INDEX "data_transfers_retain_until_idx" ON "data_transfers" USING btree ("retain_until");
  CREATE INDEX "data_transfers_updated_at_idx" ON "data_transfers" USING btree ("updated_at");
  CREATE INDEX "data_transfers_created_at_idx" ON "data_transfers" USING btree ("created_at");
  CREATE INDEX "transfer_documents_organization_idx" ON "transfer_documents" USING btree ("organization_id");
  CREATE INDEX "transfer_documents_transfer_idx" ON "transfer_documents" USING btree ("transfer_id");
  CREATE INDEX "transfer_documents_sha256_idx" ON "transfer_documents" USING btree ("sha256");
  CREATE INDEX "transfer_documents_retain_until_idx" ON "transfer_documents" USING btree ("retain_until");
  CREATE INDEX "transfer_documents_updated_at_idx" ON "transfer_documents" USING btree ("updated_at");
  CREATE INDEX "transfer_documents_created_at_idx" ON "transfer_documents" USING btree ("created_at");
  CREATE UNIQUE INDEX "transfer_documents_filename_idx" ON "transfer_documents" USING btree ("filename");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_policy_versions_fk" FOREIGN KEY ("policy_versions_id") REFERENCES "public"."policy_versions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_policy_acceptances_fk" FOREIGN KEY ("policy_acceptances_id") REFERENCES "public"."policy_acceptances"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_policy_notices_fk" FOREIGN KEY ("policy_notices_id") REFERENCES "public"."policy_notices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_data_transfers_fk" FOREIGN KEY ("data_transfers_id") REFERENCES "public"."data_transfers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_transfer_documents_fk" FOREIGN KEY ("transfer_documents_id") REFERENCES "public"."transfer_documents"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_policy_versions_id_idx" ON "payload_locked_documents_rels" USING btree ("policy_versions_id");
  CREATE INDEX "payload_locked_documents_rels_policy_acceptances_id_idx" ON "payload_locked_documents_rels" USING btree ("policy_acceptances_id");
  CREATE INDEX "payload_locked_documents_rels_policy_notices_id_idx" ON "payload_locked_documents_rels" USING btree ("policy_notices_id");
  CREATE INDEX "payload_locked_documents_rels_data_transfers_id_idx" ON "payload_locked_documents_rels" USING btree ("data_transfers_id");
  CREATE INDEX "payload_locked_documents_rels_transfer_documents_id_idx" ON "payload_locked_documents_rels" USING btree ("transfer_documents_id");
  CREATE TABLE "data_access_log" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"viewed_at" timestamp(3) with time zone NOT NULL,
  	"user_id" varchar,
  	"user_email" varchar NOT NULL,
  	"viewed_collection" "enum_data_access_log_viewed_collection" NOT NULL,
  	"operation" "enum_data_access_log_operation" NOT NULL,
  	"records" jsonb,
  	"total" numeric
  );
  
  CREATE TABLE "access_reviews" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"period_from" timestamp(3) with time zone NOT NULL,
  	"period_to" timestamp(3) with time zone NOT NULL,
  	"status" "enum_access_reviews_status" DEFAULT 'confirmed',
  	"sources" varchar DEFAULT 'Data Access Log · SSH sign-ins of the servers · reverse-proxy log (7 days)',
  	"collected" jsonb,
  	"collected_until" timestamp(3) with time zone,
  	"result" varchar,
  	"confirmed" boolean,
  	"reviewer_id" varchar,
  	"reviewer_email" varchar,
  	"reviewed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "access_reviews_server_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"started_at" timestamp(3) with time zone NOT NULL,
  	"user" varchar,
  	"method" varchar,
  	"key_fingerprint" varchar,
  	"auto" boolean DEFAULT false,
  	"reason" "enum_access_reviews_server_sessions_reason",
  	"read_data" varchar
  );
  
  CREATE TABLE "access_reviews_findings" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"at" timestamp(3) with time zone,
  	"severity" "enum_access_reviews_findings_severity",
  	"rule" varchar,
  	"detail" varchar
  );
  
  ALTER TABLE "policy_notices" ADD COLUMN "audience" "enum_policy_notices_audience" DEFAULT 'owner' NOT NULL;
  ALTER TABLE "policy_notices" ADD COLUMN "transfer_id" varchar;
  ALTER TABLE "policy_notices" ADD COLUMN "delivered_at" timestamp(3) with time zone;
  ALTER TABLE "policy_notices" ADD COLUMN "bounced_at" timestamp(3) with time zone;
  ALTER TABLE "data_transfers" ADD COLUMN "flow_assessment" jsonb;
  ALTER TABLE "data_transfers" ADD COLUMN "controller_notice_email" varchar;
  ALTER TABLE "data_transfers" ADD COLUMN "declined" jsonb;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "data_access_log_id" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "access_reviews_id" varchar;
  ALTER TABLE "data_access_log" ADD CONSTRAINT "data_access_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "data_access_log_viewed_at_idx" ON "data_access_log" USING btree ("viewed_at");
  CREATE INDEX "data_access_log_user_idx" ON "data_access_log" USING btree ("user_id");
  CREATE INDEX "data_access_log_viewed_collection_idx" ON "data_access_log" USING btree ("viewed_collection");
  CREATE INDEX "access_reviews_period_from_idx" ON "access_reviews" USING btree ("period_from");
  CREATE INDEX "access_reviews_reviewer_idx" ON "access_reviews" USING btree ("reviewer_id");
  CREATE INDEX "access_reviews_reviewed_at_idx" ON "access_reviews" USING btree ("reviewed_at");
  CREATE INDEX "access_reviews_updated_at_idx" ON "access_reviews" USING btree ("updated_at");
  CREATE INDEX "access_reviews_created_at_idx" ON "access_reviews" USING btree ("created_at");
  ALTER TABLE "access_reviews_server_sessions" ADD CONSTRAINT "access_reviews_server_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."access_reviews"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "access_reviews_server_sessions_order_idx" ON "access_reviews_server_sessions" USING btree ("_order");
  CREATE INDEX "access_reviews_server_sessions_parent_id_idx" ON "access_reviews_server_sessions" USING btree ("_parent_id");
  ALTER TABLE "access_reviews_findings" ADD CONSTRAINT "access_reviews_findings_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."access_reviews"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "access_reviews_findings_order_idx" ON "access_reviews_findings" USING btree ("_order");
  CREATE INDEX "access_reviews_findings_parent_id_idx" ON "access_reviews_findings" USING btree ("_parent_id");
  CREATE INDEX "access_reviews_status_idx" ON "access_reviews" USING btree ("status");
  ALTER TABLE "policy_notices" ADD CONSTRAINT "policy_notices_transfer_id_data_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."data_transfers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_data_access_log_fk" FOREIGN KEY ("data_access_log_id") REFERENCES "public"."data_access_log"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_access_reviews_fk" FOREIGN KEY ("access_reviews_id") REFERENCES "public"."access_reviews"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "policy_notices_audience_idx" ON "policy_notices" USING btree ("audience");
  CREATE INDEX "policy_notices_transfer_idx" ON "policy_notices" USING btree ("transfer_id");
  CREATE INDEX "payload_locked_documents_rels_data_access_log_id_idx" ON "payload_locked_documents_rels" USING btree ("data_access_log_id");
  CREATE INDEX "payload_locked_documents_rels_access_reviews_id_idx" ON "payload_locked_documents_rels" USING btree ("access_reviews_id");`);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // The references from the lock table go first: dropping the tables with CASCADE would remove those foreign keys
  // before the statements below could name them. Organizations opened by the clauses go back to `pending`, the only
  // status of theirs the previous type knows besides `own`.
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_data_access_log_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_access_reviews_fk";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_data_access_log_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_access_reviews_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "data_access_log_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "access_reviews_id";
  DROP TABLE IF EXISTS "data_access_log" CASCADE;
  DROP TABLE IF EXISTS "access_reviews_server_sessions" CASCADE;
  DROP TABLE IF EXISTS "access_reviews_findings" CASCADE;
  DROP TABLE IF EXISTS "access_reviews" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_policy_versions_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_policy_acceptances_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_policy_notices_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_data_transfers_fk";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_transfer_documents_fk";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_policy_versions_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_policy_acceptances_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_policy_notices_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_data_transfers_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_transfer_documents_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "policy_versions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "policy_acceptances_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "policy_notices_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "data_transfers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "transfer_documents_id";
  ALTER TABLE "organizations" ALTER COLUMN "data_processing" SET DATA TYPE text;
  ALTER TABLE "organizations" ALTER COLUMN "data_processing" SET DEFAULT 'pending'::text;
  UPDATE "organizations" SET "data_processing" = 'pending' WHERE "data_processing" IN ('scc', 'not_required');
  DROP TYPE "public"."enum_organizations_data_processing";
  CREATE TYPE "public"."enum_organizations_data_processing" AS ENUM('pending', 'own');
  ALTER TABLE "organizations" ALTER COLUMN "data_processing" SET DEFAULT 'pending'::"public"."enum_organizations_data_processing";
  ALTER TABLE "organizations" ALTER COLUMN "data_processing" SET DATA TYPE "public"."enum_organizations_data_processing" USING "data_processing"::"public"."enum_organizations_data_processing";
  ALTER TABLE "organizations" DROP COLUMN IF EXISTS "intake_closes_at";
  DROP TABLE IF EXISTS "transfer_documents" CASCADE;
  DROP TABLE IF EXISTS "data_transfers" CASCADE;
  DROP TABLE IF EXISTS "policy_notices" CASCADE;
  DROP TABLE IF EXISTS "policy_acceptances_documents" CASCADE;
  DROP TABLE IF EXISTS "policy_acceptances_statements" CASCADE;
  DROP TABLE IF EXISTS "policy_acceptances_checklist" CASCADE;
  DROP TABLE IF EXISTS "policy_acceptances" CASCADE;
  DROP TABLE IF EXISTS "policy_versions_changed_areas" CASCADE;
  DROP TABLE IF EXISTS "policy_versions" CASCADE;
  DROP TYPE IF EXISTS "public"."enum_policy_versions_changed_areas";
  DROP TYPE IF EXISTS "public"."enum_policy_versions_policy";
  DROP TYPE IF EXISTS "public"."enum_policy_versions_acceptance";
  DROP TYPE IF EXISTS "public"."enum_policy_acceptances_kind";
  DROP TYPE IF EXISTS "public"."enum_policy_acceptances_authority_trigger";
  DROP TYPE IF EXISTS "public"."enum_policy_acceptances_authority_method";
  DROP TYPE IF EXISTS "public"."enum_policy_notices_decision";
  DROP TYPE IF EXISTS "public"."enum_data_transfers_status";
  DROP TYPE IF EXISTS "public"."enum_transfer_documents_kind";
  DROP TYPE IF EXISTS "public"."enum_data_access_log_viewed_collection";
  DROP TYPE IF EXISTS "public"."enum_data_access_log_operation";
  DROP TYPE IF EXISTS "public"."enum_access_reviews_server_sessions_reason";
  DROP TYPE IF EXISTS "public"."enum_access_reviews_findings_severity";
  DROP TYPE IF EXISTS "public"."enum_access_reviews_status";
  DROP TYPE IF EXISTS "public"."enum_policy_notices_audience";`);
}
