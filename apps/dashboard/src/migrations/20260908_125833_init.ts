import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_users_roles" AS ENUM('admin', 'user');
  CREATE TYPE "public"."enum_transactions_adapter" AS ENUM('evm', 'solana', 'starknet');
  CREATE TYPE "public"."enum_transactions_tracker" AS ENUM('ethereum', 'safe', 'gelato', 'solana', 'erc4337');
  CREATE TYPE "public"."enum_transactions_status" AS ENUM('Failed', 'Success', 'Replaced');
  CREATE TYPE "public"."enum_transactions_sync_status" AS ENUM('synced', 'pending-sync');
  CREATE TYPE "public"."enum_transactions_aml_status" AS ENUM('not_applicable', 'pending', 'passed', 'flagged', 'failed');
  CREATE TYPE "public"."enum_apps_environment" AS ENUM('live', 'test');
  CREATE TYPE "public"."enum_apps_kind" AS ENUM('basic', 'payments');
  CREATE TYPE "public"."enum_billing_history_provider" AS ENUM('admin', 'manual', 'transfer_in', 'transfer_out', 'web3_direct');
  CREATE TYPE "public"."enum_billing_history_status" AS ENUM('success', 'pending', 'failed');
  CREATE TYPE "public"."enum_quota_usage_ledger_status" AS ENUM('applied', 'manual-review');
  CREATE TYPE "public"."enum_connected_wallets_chain_type" AS ENUM('evm', 'solana', 'btc');
  CREATE TYPE "public"."enum_organization_members_role" AS ENUM('owner', 'admin', 'member');
  CREATE TYPE "public"."enum_webhook_endpoints_events" AS ENUM('*', 'transaction:success', 'transaction:failed', 'transaction:replaced');
  CREATE TYPE "public"."enum_billing_plans_type" AS ENUM('one_time', 'subscription');
  CREATE TYPE "public"."enum_billing_plans_currency" AS ENUM('USD', 'USDC', 'ETH');
  CREATE TYPE "public"."enum_invoices_status" AS ENUM('pending', 'paid', 'failed', 'expired', 'cancelled');
  CREATE TYPE "public"."enum_invoices_currency" AS ENUM('USD');
  CREATE TYPE "public"."enum_outbox_events_status" AS ENUM('pending', 'processed', 'failed');
  CREATE TYPE "public"."enum_app_invoices_status" AS ENUM('draft', 'pending', 'paid', 'failed', 'expired', 'cancelled');
  CREATE TYPE "public"."enum_app_invoices_currency" AS ENUM('USD');
  CREATE TYPE "public"."enum_system_pricing_base_currency" AS ENUM('USD');
  CREATE TABLE "users_roles" (
  	"order" integer NOT NULL,
  	"parent_id" varchar NOT NULL,
  	"value" "enum_users_roles",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "users" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"telegram_username" varchar,
  	"discord_username" varchar,
  	"two_factor_enabled" boolean DEFAULT false,
  	"two_factor_secret" varchar,
  	"backup_code" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"_verified" boolean,
  	"_verificationtoken" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "transactions" (
  	"id" serial NOT NULL,
  	"owner_id" varchar NOT NULL,
  	"app_id" varchar,
  	"app_name" varchar DEFAULT 'Web3 App' NOT NULL,
  	"tx_key" varchar NOT NULL,
  	"chain_id" varchar NOT NULL,
  	"from" varchar NOT NULL,
  	"type" varchar NOT NULL,
  	"connector_type" varchar NOT NULL,
  	"adapter" "enum_transactions_adapter" NOT NULL,
  	"tracker" "enum_transactions_tracker" NOT NULL,
  	"status" "enum_transactions_status",
  	"sync_status" "enum_transactions_sync_status" DEFAULT 'synced',
  	"pending" boolean DEFAULT true NOT NULL,
  	"is_error" boolean DEFAULT false,
  	"local_timestamp" numeric NOT NULL,
  	"finished_timestamp" numeric,
  	"title" jsonb,
  	"description" jsonb,
  	"error" jsonb,
  	"payload" jsonb,
  	"confirmations" varchar,
  	"required_confirmations" numeric,
  	"rpc_url" varchar,
  	"app_invoice_id_id" varchar,
  	"aml_status" "enum_transactions_aml_status" DEFAULT 'not_applicable',
  	"aml_risk_score" numeric DEFAULT 0,
  	"aml_provider_data" jsonb,
  	"hash" varchar,
  	"to" varchar,
  	"value" varchar,
  	"input" varchar,
  	"nonce" numeric,
  	"max_fee_per_gas" varchar,
  	"max_priority_fee_per_gas" varchar,
  	"replaced_tx_hash" varchar,
  	"bundler_url" varchar,
  	"pimlico_api_key" varchar,
  	"fee" numeric,
  	"slot" numeric,
  	"recent_blockhash" varchar,
  	"instructions" jsonb,
  	"actual_fee" jsonb,
  	"contract_address" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	PRIMARY KEY ("id", "created_at")
  ) PARTITION BY RANGE ("created_at");
  
  CREATE TABLE "apps_ip_whitelist" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"ip" varchar NOT NULL
  );
  
  CREATE TABLE "apps_domains_whitelist" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"domain" varchar NOT NULL
  );
  
  CREATE TABLE "apps_rpc_configs" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"chain_id" varchar NOT NULL,
  	"rpc_url" varchar NOT NULL
  );
  
  CREATE TABLE "apps" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"organization_id" varchar NOT NULL,
  	"environment" "enum_apps_environment" DEFAULT 'test' NOT NULL,
  	"kind" "enum_apps_kind" DEFAULT 'basic' NOT NULL,
  	"is_active" boolean DEFAULT true,
  	"alchemy_api_key" varchar,
  	"quick_node_api_key" varchar,
  	"quick_node_app_name" varchar,
  	"gelato_api_key" varchar,
  	"pimlico_api_key" varchar,
  	"payment_settings_aml_enabled" boolean DEFAULT false,
  	"payment_settings_go_plus_api_key" varchar,
  	"payment_settings_go_plus_api_secret" varchar,
  	"payment_settings_app_invoice_template" jsonb,
  	"public_key" varchar,
  	"secret_key" varchar,
  	"secret_key_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "billing_history" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"organization_id" varchar NOT NULL,
  	"amount" numeric NOT NULL,
  	"amount_money" varchar,
  	"invoice_id" varchar,
  	"provider" "enum_billing_history_provider" NOT NULL,
  	"external_id" varchar,
  	"status" "enum_billing_history_status" DEFAULT 'success' NOT NULL,
  	"rps" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "quota_usage_ledger" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"organization_id" varchar NOT NULL,
  	"batch_id" varchar NOT NULL,
  	"amount" numeric NOT NULL,
  	"usage_category" varchar NOT NULL,
  	"source_window" varchar NOT NULL,
  	"content_digest" varchar NOT NULL,
  	"status" "enum_quota_usage_ledger_status" DEFAULT 'applied' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "passkeys" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" varchar NOT NULL,
  	"name" varchar,
  	"credential_i_d" varchar NOT NULL,
  	"public_key" varchar NOT NULL,
  	"counter" numeric NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "passkeys_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "connected_wallets" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" varchar NOT NULL,
  	"address" varchar NOT NULL,
  	"chain_type" "enum_connected_wallets_chain_type" DEFAULT 'evm' NOT NULL,
  	"label" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "organizations" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar,
  	"created_by" varchar NOT NULL,
  	"quota_balance" numeric DEFAULT 100 NOT NULL,
  	"rps_limit" numeric DEFAULT 5 NOT NULL,
  	"rps_paid_limit" numeric DEFAULT 5 NOT NULL,
  	"rps_expires_at" timestamp(3) with time zone,
  	"payment_gateway_i_d" varchar,
  	"quota_used" numeric DEFAULT 0 NOT NULL,
  	"rps_forever" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "organization_members" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"organization_id" varchar NOT NULL,
  	"user_id" varchar NOT NULL,
  	"role" "enum_organization_members_role" DEFAULT 'member' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "organization_billing_profiles" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"organization_id" varchar NOT NULL,
  	"billing_name" varchar NOT NULL,
  	"address_line1" varchar NOT NULL,
  	"address_line2" varchar,
  	"city" varchar NOT NULL,
  	"country" varchar NOT NULL,
  	"registration_number" varchar,
  	"tax_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "deleted_accounts" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"email" varchar NOT NULL,
  	"original_id" varchar NOT NULL,
  	"deleted_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "deleted_organizations" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"org_name" varchar NOT NULL,
  	"original_id" varchar NOT NULL,
  	"deleted_by" varchar NOT NULL,
  	"deleted_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "deleted_organization_members" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"organization" varchar NOT NULL,
  	"user" varchar,
  	"email" varchar NOT NULL,
  	"deleted_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "webhook_endpoints_events" (
  	"order" integer NOT NULL,
  	"parent_id" varchar NOT NULL,
  	"value" "enum_webhook_endpoints_events",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "webhook_endpoints" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"app_id" varchar NOT NULL,
  	"url" varchar NOT NULL,
  	"signing_secret" varchar NOT NULL,
  	"is_active" boolean DEFAULT true,
  	"is_system_webhook" boolean DEFAULT false,
  	"description" varchar,
  	"tx_type" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "webhook_deliveries" (
  	"id" varchar NOT NULL,
  	"endpoint_id" varchar NOT NULL,
  	"event_type" varchar NOT NULL,
  	"tx_key" varchar NOT NULL,
  	"http_status" numeric,
  	"success" boolean DEFAULT false NOT NULL,
  	"request_payload" jsonb,
  	"response_body" varchar,
  	"execution_time_ms" numeric,
  	"attempts" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	PRIMARY KEY ("id", "created_at")
  ) PARTITION BY RANGE ("created_at");
  
  CREATE TABLE "accepted_payments" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"wallet_address_to_receive_payment" varchar NOT NULL,
  	"token_address" varchar NOT NULL,
  	"price_feed_address" varchar NOT NULL,
  	"chain_id" numeric NOT NULL,
  	"symbol" varchar NOT NULL,
  	"decimals" numeric DEFAULT 6 NOT NULL,
  	"markup" numeric DEFAULT 0,
  	"discount" numeric DEFAULT 0,
  	"is_active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "billing_plans_features" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"feature" varchar NOT NULL
  );
  
  CREATE TABLE "billing_plans" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"type" "enum_billing_plans_type" NOT NULL,
  	"price" numeric NOT NULL,
  	"currency" "enum_billing_plans_currency" DEFAULT 'USD' NOT NULL,
  	"quota_provided" numeric NOT NULL,
  	"rps_provided" numeric NOT NULL,
  	"is_active" boolean DEFAULT true,
  	"price_id" varchar,
  	"description" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "invoices" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"organization_id" varchar NOT NULL,
  	"status" "enum_invoices_status" DEFAULT 'pending' NOT NULL,
  	"plan_id" varchar,
  	"base_amount" numeric NOT NULL,
  	"total_amount" numeric NOT NULL,
  	"currency" "enum_invoices_currency" DEFAULT 'USD' NOT NULL,
  	"crypto_amount_expected" varchar NOT NULL,
  	"accepted_payment_id" varchar NOT NULL,
  	"tx_hash" varchar,
  	"origin_wallet" varchar,
  	"rps" numeric,
  	"quota" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "outbox_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_type" varchar NOT NULL,
  	"payload" jsonb NOT NULL,
  	"status" "enum_outbox_events_status" DEFAULT 'pending' NOT NULL,
  	"attempts" numeric DEFAULT 0 NOT NULL,
  	"next_attempt_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "app_accepted_payments" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"app_id" varchar NOT NULL,
  	"organization_id" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"wallet_address_to_receive_payment" varchar NOT NULL,
  	"token_address" varchar NOT NULL,
  	"chain_id" numeric NOT NULL,
  	"symbol" varchar NOT NULL,
  	"decimals" numeric DEFAULT 6 NOT NULL,
  	"markup" numeric DEFAULT 0,
  	"discount" numeric DEFAULT 0,
  	"price_feed_address" varchar NOT NULL,
  	"is_active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "app_invoices" (
  	"id" varchar PRIMARY KEY NOT NULL,
  	"app_id" varchar NOT NULL,
  	"organization_id" varchar NOT NULL,
  	"status" "enum_app_invoices_status" DEFAULT 'draft' NOT NULL,
  	"base_amount" numeric NOT NULL,
  	"total_amount" numeric NOT NULL,
  	"currency" "enum_app_invoices_currency" DEFAULT 'USD' NOT NULL,
  	"crypto_amount_expected" varchar NOT NULL,
  	"accepted_payment_id" varchar NOT NULL,
  	"tx_hash" varchar,
  	"origin_wallet" varchar,
  	"metadata" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "faq" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"question" varchar NOT NULL,
  	"answer" varchar NOT NULL,
  	"order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" varchar,
  	"transactions_id" integer,
  	"apps_id" varchar,
  	"billing_history_id" varchar,
  	"quota_usage_ledger_id" varchar,
  	"passkeys_id" integer,
  	"connected_wallets_id" integer,
  	"organizations_id" varchar,
  	"organization_members_id" varchar,
  	"organization_billing_profiles_id" varchar,
  	"deleted_accounts_id" varchar,
  	"deleted_organizations_id" varchar,
  	"deleted_organization_members_id" varchar,
  	"webhook_endpoints_id" varchar,
  	"webhook_deliveries_id" varchar,
  	"accepted_payments_id" varchar,
  	"billing_plans_id" varchar,
  	"invoices_id" varchar,
  	"outbox_events_id" integer,
  	"app_accepted_payments_id" varchar,
  	"app_invoices_id" varchar,
  	"media_id" integer,
  	"faq_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" varchar
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "system_pricing_volume_discounts" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"quota_threshold" numeric NOT NULL,
  	"discount_percentage" numeric NOT NULL
  );
  
  CREATE TABLE "system_pricing" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"base_currency" "enum_system_pricing_base_currency" DEFAULT 'USD' NOT NULL,
  	"cost_per_quota" numeric NOT NULL,
  	"cost_per_r_p_s" numeric NOT NULL,
  	"minimum_deposit_amount" numeric DEFAULT 5 NOT NULL,
  	"max_discount_percentage" numeric DEFAULT 15 NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "system_pricing_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"accepted_payments_id" varchar
  );
  
  CREATE TABLE "invoice_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"issuer_name" varchar DEFAULT 'FOP Tkach Oleksandr' NOT NULL,
  	"issuer_role" varchar DEFAULT 'Founder' NOT NULL,
  	"signature_image_id" integer NOT NULL,
  	"pdf_template" jsonb NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_id_organizations_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "transactions" ADD CONSTRAINT "transactions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "transactions" ADD CONSTRAINT "transactions_app_invoice_id_id_app_invoices_id_fk" FOREIGN KEY ("app_invoice_id_id") REFERENCES "public"."app_invoices"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "apps_ip_whitelist" ADD CONSTRAINT "apps_ip_whitelist_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "apps_domains_whitelist" ADD CONSTRAINT "apps_domains_whitelist_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "apps_rpc_configs" ADD CONSTRAINT "apps_rpc_configs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "apps" ADD CONSTRAINT "apps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "quota_usage_ledger" ADD CONSTRAINT "quota_usage_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "passkeys_texts" ADD CONSTRAINT "passkeys_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."passkeys"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "connected_wallets" ADD CONSTRAINT "connected_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "organization_billing_profiles" ADD CONSTRAINT "organization_billing_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "webhook_endpoints_events" ADD CONSTRAINT "webhook_endpoints_events_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "billing_plans_features" ADD CONSTRAINT "billing_plans_features_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."billing_plans"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_accepted_payment_id_accepted_payments_id_fk" FOREIGN KEY ("accepted_payment_id") REFERENCES "public"."accepted_payments"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "app_accepted_payments" ADD CONSTRAINT "app_accepted_payments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "app_accepted_payments" ADD CONSTRAINT "app_accepted_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "app_invoices" ADD CONSTRAINT "app_invoices_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "app_invoices" ADD CONSTRAINT "app_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "app_invoices" ADD CONSTRAINT "app_invoices_accepted_payment_id_app_accepted_payments_id_fk" FOREIGN KEY ("accepted_payment_id") REFERENCES "public"."app_accepted_payments"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  -- ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_transactions_fk" FOREIGN KEY ("transactions_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_apps_fk" FOREIGN KEY ("apps_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_billing_history_fk" FOREIGN KEY ("billing_history_id") REFERENCES "public"."billing_history"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_quota_usage_ledger_fk" FOREIGN KEY ("quota_usage_ledger_id") REFERENCES "public"."quota_usage_ledger"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_passkeys_fk" FOREIGN KEY ("passkeys_id") REFERENCES "public"."passkeys"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_connected_wallets_fk" FOREIGN KEY ("connected_wallets_id") REFERENCES "public"."connected_wallets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_organizations_fk" FOREIGN KEY ("organizations_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_organization_members_fk" FOREIGN KEY ("organization_members_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_organization_billing_profil_fk" FOREIGN KEY ("organization_billing_profiles_id") REFERENCES "public"."organization_billing_profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_deleted_accounts_fk" FOREIGN KEY ("deleted_accounts_id") REFERENCES "public"."deleted_accounts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_deleted_organizations_fk" FOREIGN KEY ("deleted_organizations_id") REFERENCES "public"."deleted_organizations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_deleted_organization_member_fk" FOREIGN KEY ("deleted_organization_members_id") REFERENCES "public"."deleted_organization_members"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_webhook_endpoints_fk" FOREIGN KEY ("webhook_endpoints_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;
  -- ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_webhook_deliveries_fk" FOREIGN KEY ("webhook_deliveries_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_accepted_payments_fk" FOREIGN KEY ("accepted_payments_id") REFERENCES "public"."accepted_payments"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_billing_plans_fk" FOREIGN KEY ("billing_plans_id") REFERENCES "public"."billing_plans"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_invoices_fk" FOREIGN KEY ("invoices_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_outbox_events_fk" FOREIGN KEY ("outbox_events_id") REFERENCES "public"."outbox_events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_app_accepted_payments_fk" FOREIGN KEY ("app_accepted_payments_id") REFERENCES "public"."app_accepted_payments"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_app_invoices_fk" FOREIGN KEY ("app_invoices_id") REFERENCES "public"."app_invoices"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_faq_fk" FOREIGN KEY ("faq_id") REFERENCES "public"."faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "system_pricing_volume_discounts" ADD CONSTRAINT "system_pricing_volume_discounts_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."system_pricing"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "system_pricing_rels" ADD CONSTRAINT "system_pricing_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."system_pricing"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "system_pricing_rels" ADD CONSTRAINT "system_pricing_rels_accepted_payments_fk" FOREIGN KEY ("accepted_payments_id") REFERENCES "public"."accepted_payments"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_signature_image_id_media_id_fk" FOREIGN KEY ("signature_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "users_roles_order_idx" ON "users_roles" USING btree ("order");
  CREATE INDEX "users_roles_parent_idx" ON "users_roles" USING btree ("parent_id");
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "transactions_owner_idx" ON "transactions" USING btree ("owner_id");
  CREATE INDEX "transactions_app_idx" ON "transactions" USING btree ("app_id");
  CREATE INDEX "transactions_app_name_idx" ON "transactions" USING btree ("app_name");
  CREATE UNIQUE INDEX "transactions_tx_key_idx" ON "transactions" USING btree ("tx_key", "created_at");
  CREATE INDEX "transactions_chain_id_idx" ON "transactions" USING btree ("chain_id");
  CREATE INDEX "transactions_from_idx" ON "transactions" USING btree ("from");
  CREATE INDEX "transactions_adapter_idx" ON "transactions" USING btree ("adapter");
  CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");
  CREATE INDEX "transactions_sync_status_idx" ON "transactions" USING btree ("sync_status");
  CREATE INDEX "transactions_local_timestamp_idx" ON "transactions" USING btree ("local_timestamp");
  CREATE INDEX "transactions_app_invoice_id_idx" ON "transactions" USING btree ("app_invoice_id_id");
  CREATE INDEX "transactions_aml_status_idx" ON "transactions" USING btree ("aml_status");
  CREATE INDEX "transactions_hash_idx" ON "transactions" USING btree ("hash");
  CREATE INDEX "transactions_to_idx" ON "transactions" USING btree ("to");
  CREATE INDEX "transactions_updated_at_idx" ON "transactions" USING btree ("updated_at");
  CREATE INDEX "transactions_created_at_idx" ON "transactions" USING btree ("created_at");
  CREATE INDEX "apps_ip_whitelist_order_idx" ON "apps_ip_whitelist" USING btree ("_order");
  CREATE INDEX "apps_ip_whitelist_parent_id_idx" ON "apps_ip_whitelist" USING btree ("_parent_id");
  CREATE INDEX "apps_domains_whitelist_order_idx" ON "apps_domains_whitelist" USING btree ("_order");
  CREATE INDEX "apps_domains_whitelist_parent_id_idx" ON "apps_domains_whitelist" USING btree ("_parent_id");
  CREATE INDEX "apps_rpc_configs_order_idx" ON "apps_rpc_configs" USING btree ("_order");
  CREATE INDEX "apps_rpc_configs_parent_id_idx" ON "apps_rpc_configs" USING btree ("_parent_id");
  CREATE INDEX "apps_organization_idx" ON "apps" USING btree ("organization_id");
  CREATE INDEX "apps_environment_idx" ON "apps" USING btree ("environment");
  CREATE INDEX "apps_kind_idx" ON "apps" USING btree ("kind");
  CREATE INDEX "apps_is_active_idx" ON "apps" USING btree ("is_active");
  CREATE UNIQUE INDEX "apps_public_key_idx" ON "apps" USING btree ("public_key");
  CREATE UNIQUE INDEX "apps_secret_key_idx" ON "apps" USING btree ("secret_key");
  CREATE INDEX "apps_secret_key_hash_idx" ON "apps" USING btree ("secret_key_hash");
  CREATE INDEX "apps_updated_at_idx" ON "apps" USING btree ("updated_at");
  CREATE INDEX "apps_created_at_idx" ON "apps" USING btree ("created_at");
  CREATE INDEX "billing_history_organization_idx" ON "billing_history" USING btree ("organization_id");
  CREATE INDEX "billing_history_invoice_idx" ON "billing_history" USING btree ("invoice_id");
  CREATE UNIQUE INDEX "billing_history_external_id_idx" ON "billing_history" USING btree ("external_id");
  CREATE INDEX "billing_history_status_idx" ON "billing_history" USING btree ("status");
  CREATE INDEX "billing_history_updated_at_idx" ON "billing_history" USING btree ("updated_at");
  CREATE INDEX "billing_history_created_at_idx" ON "billing_history" USING btree ("created_at");
  CREATE INDEX "quota_usage_ledger_organization_idx" ON "quota_usage_ledger" USING btree ("organization_id");
  CREATE UNIQUE INDEX "quota_usage_ledger_batch_id_idx" ON "quota_usage_ledger" USING btree ("batch_id");
  CREATE INDEX "quota_usage_ledger_status_idx" ON "quota_usage_ledger" USING btree ("status");
  CREATE INDEX "quota_usage_ledger_updated_at_idx" ON "quota_usage_ledger" USING btree ("updated_at");
  CREATE INDEX "quota_usage_ledger_created_at_idx" ON "quota_usage_ledger" USING btree ("created_at");
  CREATE INDEX "passkeys_user_idx" ON "passkeys" USING btree ("user_id");
  CREATE UNIQUE INDEX "passkeys_credential_i_d_idx" ON "passkeys" USING btree ("credential_i_d");
  CREATE INDEX "passkeys_updated_at_idx" ON "passkeys" USING btree ("updated_at");
  CREATE INDEX "passkeys_created_at_idx" ON "passkeys" USING btree ("created_at");
  CREATE INDEX "passkeys_texts_order_parent" ON "passkeys_texts" USING btree ("order","parent_id");
  CREATE INDEX "connected_wallets_user_idx" ON "connected_wallets" USING btree ("user_id");
  CREATE UNIQUE INDEX "connected_wallets_address_idx" ON "connected_wallets" USING btree ("address");
  CREATE INDEX "connected_wallets_updated_at_idx" ON "connected_wallets" USING btree ("updated_at");
  CREATE INDEX "connected_wallets_created_at_idx" ON "connected_wallets" USING btree ("created_at");
  CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");
  CREATE INDEX "organizations_created_by_idx" ON "organizations" USING btree ("created_by");
  CREATE INDEX "organizations_updated_at_idx" ON "organizations" USING btree ("updated_at");
  CREATE INDEX "organizations_created_at_idx" ON "organizations" USING btree ("created_at");
  CREATE INDEX "organization_members_organization_idx" ON "organization_members" USING btree ("organization_id");
  CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");
  CREATE INDEX "organization_members_updated_at_idx" ON "organization_members" USING btree ("updated_at");
  CREATE INDEX "organization_members_created_at_idx" ON "organization_members" USING btree ("created_at");
  CREATE UNIQUE INDEX "organization_user_idx" ON "organization_members" USING btree ("organization_id","user_id");
  CREATE UNIQUE INDEX "organization_billing_profiles_organization_idx" ON "organization_billing_profiles" USING btree ("organization_id");
  CREATE INDEX "organization_billing_profiles_updated_at_idx" ON "organization_billing_profiles" USING btree ("updated_at");
  CREATE INDEX "organization_billing_profiles_created_at_idx" ON "organization_billing_profiles" USING btree ("created_at");
  CREATE INDEX "deleted_accounts_email_idx" ON "deleted_accounts" USING btree ("email");
  CREATE INDEX "deleted_accounts_original_id_idx" ON "deleted_accounts" USING btree ("original_id");
  CREATE INDEX "deleted_accounts_deleted_at_idx" ON "deleted_accounts" USING btree ("deleted_at");
  CREATE INDEX "deleted_accounts_updated_at_idx" ON "deleted_accounts" USING btree ("updated_at");
  CREATE INDEX "deleted_accounts_created_at_idx" ON "deleted_accounts" USING btree ("created_at");
  CREATE INDEX "deleted_organizations_original_id_idx" ON "deleted_organizations" USING btree ("original_id");
  CREATE INDEX "deleted_organizations_deleted_by_idx" ON "deleted_organizations" USING btree ("deleted_by");
  CREATE INDEX "deleted_organizations_deleted_at_idx" ON "deleted_organizations" USING btree ("deleted_at");
  CREATE INDEX "deleted_organizations_updated_at_idx" ON "deleted_organizations" USING btree ("updated_at");
  CREATE INDEX "deleted_organizations_created_at_idx" ON "deleted_organizations" USING btree ("created_at");
  CREATE INDEX "deleted_organization_members_organization_idx" ON "deleted_organization_members" USING btree ("organization");
  CREATE INDEX "deleted_organization_members_user_idx" ON "deleted_organization_members" USING btree ("user");
  CREATE INDEX "deleted_organization_members_email_idx" ON "deleted_organization_members" USING btree ("email");
  CREATE INDEX "deleted_organization_members_deleted_at_idx" ON "deleted_organization_members" USING btree ("deleted_at");
  CREATE INDEX "deleted_organization_members_updated_at_idx" ON "deleted_organization_members" USING btree ("updated_at");
  CREATE INDEX "deleted_organization_members_created_at_idx" ON "deleted_organization_members" USING btree ("created_at");
  CREATE INDEX "webhook_endpoints_events_order_idx" ON "webhook_endpoints_events" USING btree ("order");
  CREATE INDEX "webhook_endpoints_events_parent_idx" ON "webhook_endpoints_events" USING btree ("parent_id");
  CREATE INDEX "webhook_endpoints_app_idx" ON "webhook_endpoints" USING btree ("app_id");
  CREATE UNIQUE INDEX "webhook_endpoints_signing_secret_idx" ON "webhook_endpoints" USING btree ("signing_secret");
  CREATE INDEX "webhook_endpoints_updated_at_idx" ON "webhook_endpoints" USING btree ("updated_at");
  CREATE INDEX "webhook_endpoints_created_at_idx" ON "webhook_endpoints" USING btree ("created_at");
  CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id");
  CREATE INDEX "webhook_deliveries_event_type_idx" ON "webhook_deliveries" USING btree ("event_type");
  CREATE INDEX "webhook_deliveries_tx_key_idx" ON "webhook_deliveries" USING btree ("tx_key");
  CREATE INDEX "webhook_deliveries_updated_at_idx" ON "webhook_deliveries" USING btree ("updated_at");
  CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries" USING btree ("created_at");
  CREATE INDEX "accepted_payments_updated_at_idx" ON "accepted_payments" USING btree ("updated_at");
  CREATE INDEX "accepted_payments_created_at_idx" ON "accepted_payments" USING btree ("created_at");
  CREATE INDEX "billing_plans_features_order_idx" ON "billing_plans_features" USING btree ("_order");
  CREATE INDEX "billing_plans_features_parent_id_idx" ON "billing_plans_features" USING btree ("_parent_id");
  CREATE INDEX "billing_plans_updated_at_idx" ON "billing_plans" USING btree ("updated_at");
  CREATE INDEX "billing_plans_created_at_idx" ON "billing_plans" USING btree ("created_at");
  CREATE INDEX "invoices_organization_idx" ON "invoices" USING btree ("organization_id");
  CREATE INDEX "invoices_plan_idx" ON "invoices" USING btree ("plan_id");
  CREATE INDEX "invoices_accepted_payment_idx" ON "invoices" USING btree ("accepted_payment_id");
  CREATE UNIQUE INDEX "invoices_tx_hash_idx" ON "invoices" USING btree ("tx_hash");
  CREATE INDEX "invoices_updated_at_idx" ON "invoices" USING btree ("updated_at");
  CREATE INDEX "invoices_created_at_idx" ON "invoices" USING btree ("created_at");
  CREATE INDEX "outbox_events_updated_at_idx" ON "outbox_events" USING btree ("updated_at");
  CREATE INDEX "outbox_events_created_at_idx" ON "outbox_events" USING btree ("created_at");
  CREATE INDEX "app_accepted_payments_app_idx" ON "app_accepted_payments" USING btree ("app_id");
  CREATE INDEX "app_accepted_payments_organization_idx" ON "app_accepted_payments" USING btree ("organization_id");
  CREATE INDEX "app_accepted_payments_updated_at_idx" ON "app_accepted_payments" USING btree ("updated_at");
  CREATE INDEX "app_accepted_payments_created_at_idx" ON "app_accepted_payments" USING btree ("created_at");
  CREATE INDEX "app_invoices_app_idx" ON "app_invoices" USING btree ("app_id");
  CREATE INDEX "app_invoices_organization_idx" ON "app_invoices" USING btree ("organization_id");
  CREATE INDEX "app_invoices_status_idx" ON "app_invoices" USING btree ("status");
  CREATE INDEX "app_invoices_accepted_payment_idx" ON "app_invoices" USING btree ("accepted_payment_id");
  CREATE INDEX "app_invoices_tx_hash_idx" ON "app_invoices" USING btree ("tx_hash");
  CREATE INDEX "app_invoices_updated_at_idx" ON "app_invoices" USING btree ("updated_at");
  CREATE INDEX "app_invoices_created_at_idx" ON "app_invoices" USING btree ("created_at");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "faq_updated_at_idx" ON "faq" USING btree ("updated_at");
  CREATE INDEX "faq_created_at_idx" ON "faq" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_transactions_id_idx" ON "payload_locked_documents_rels" USING btree ("transactions_id");
  CREATE INDEX "payload_locked_documents_rels_apps_id_idx" ON "payload_locked_documents_rels" USING btree ("apps_id");
  CREATE INDEX "payload_locked_documents_rels_billing_history_id_idx" ON "payload_locked_documents_rels" USING btree ("billing_history_id");
  CREATE INDEX "payload_locked_documents_rels_quota_usage_ledger_id_idx" ON "payload_locked_documents_rels" USING btree ("quota_usage_ledger_id");
  CREATE INDEX "payload_locked_documents_rels_passkeys_id_idx" ON "payload_locked_documents_rels" USING btree ("passkeys_id");
  CREATE INDEX "payload_locked_documents_rels_connected_wallets_id_idx" ON "payload_locked_documents_rels" USING btree ("connected_wallets_id");
  CREATE INDEX "payload_locked_documents_rels_organizations_id_idx" ON "payload_locked_documents_rels" USING btree ("organizations_id");
  CREATE INDEX "payload_locked_documents_rels_organization_members_id_idx" ON "payload_locked_documents_rels" USING btree ("organization_members_id");
  CREATE INDEX "payload_locked_documents_rels_organization_billing_profi_idx" ON "payload_locked_documents_rels" USING btree ("organization_billing_profiles_id");
  CREATE INDEX "payload_locked_documents_rels_deleted_accounts_id_idx" ON "payload_locked_documents_rels" USING btree ("deleted_accounts_id");
  CREATE INDEX "payload_locked_documents_rels_deleted_organizations_id_idx" ON "payload_locked_documents_rels" USING btree ("deleted_organizations_id");
  CREATE INDEX "payload_locked_documents_rels_deleted_organization_membe_idx" ON "payload_locked_documents_rels" USING btree ("deleted_organization_members_id");
  CREATE INDEX "payload_locked_documents_rels_webhook_endpoints_id_idx" ON "payload_locked_documents_rels" USING btree ("webhook_endpoints_id");
  CREATE INDEX "payload_locked_documents_rels_webhook_deliveries_id_idx" ON "payload_locked_documents_rels" USING btree ("webhook_deliveries_id");
  CREATE INDEX "payload_locked_documents_rels_accepted_payments_id_idx" ON "payload_locked_documents_rels" USING btree ("accepted_payments_id");
  CREATE INDEX "payload_locked_documents_rels_billing_plans_id_idx" ON "payload_locked_documents_rels" USING btree ("billing_plans_id");
  CREATE INDEX "payload_locked_documents_rels_invoices_id_idx" ON "payload_locked_documents_rels" USING btree ("invoices_id");
  CREATE INDEX "payload_locked_documents_rels_outbox_events_id_idx" ON "payload_locked_documents_rels" USING btree ("outbox_events_id");
  CREATE INDEX "payload_locked_documents_rels_app_accepted_payments_id_idx" ON "payload_locked_documents_rels" USING btree ("app_accepted_payments_id");
  CREATE INDEX "payload_locked_documents_rels_app_invoices_id_idx" ON "payload_locked_documents_rels" USING btree ("app_invoices_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_faq_id_idx" ON "payload_locked_documents_rels" USING btree ("faq_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");
  CREATE INDEX "system_pricing_volume_discounts_order_idx" ON "system_pricing_volume_discounts" USING btree ("_order");
  CREATE INDEX "system_pricing_volume_discounts_parent_id_idx" ON "system_pricing_volume_discounts" USING btree ("_parent_id");
  CREATE INDEX "system_pricing_rels_order_idx" ON "system_pricing_rels" USING btree ("order");
  CREATE INDEX "system_pricing_rels_parent_idx" ON "system_pricing_rels" USING btree ("parent_id");
  CREATE INDEX "system_pricing_rels_path_idx" ON "system_pricing_rels" USING btree ("path");
  CREATE INDEX "system_pricing_rels_accepted_payments_id_idx" ON "system_pricing_rels" USING btree ("accepted_payments_id");
  CREATE INDEX "invoice_settings_signature_image_idx" ON "invoice_settings" USING btree ("signature_image_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "users_roles" CASCADE;
  DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "transactions" CASCADE;
  DROP TABLE "apps_ip_whitelist" CASCADE;
  DROP TABLE "apps_domains_whitelist" CASCADE;
  DROP TABLE "apps_rpc_configs" CASCADE;
  DROP TABLE "apps" CASCADE;
  DROP TABLE "billing_history" CASCADE;
  DROP TABLE "quota_usage_ledger" CASCADE;
  DROP TABLE "passkeys" CASCADE;
  DROP TABLE "passkeys_texts" CASCADE;
  DROP TABLE "connected_wallets" CASCADE;
  DROP TABLE "organizations" CASCADE;
  DROP TABLE "organization_members" CASCADE;
  DROP TABLE "organization_billing_profiles" CASCADE;
  DROP TABLE "deleted_accounts" CASCADE;
  DROP TABLE "deleted_organizations" CASCADE;
  DROP TABLE "deleted_organization_members" CASCADE;
  DROP TABLE "webhook_endpoints_events" CASCADE;
  DROP TABLE "webhook_endpoints" CASCADE;
  DROP TABLE "webhook_deliveries" CASCADE;
  DROP TABLE "accepted_payments" CASCADE;
  DROP TABLE "billing_plans_features" CASCADE;
  DROP TABLE "billing_plans" CASCADE;
  DROP TABLE "invoices" CASCADE;
  DROP TABLE "outbox_events" CASCADE;
  DROP TABLE "app_accepted_payments" CASCADE;
  DROP TABLE "app_invoices" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "faq" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TABLE "system_pricing_volume_discounts" CASCADE;
  DROP TABLE "system_pricing" CASCADE;
  DROP TABLE "system_pricing_rels" CASCADE;
  DROP TABLE "invoice_settings" CASCADE;
  DROP TYPE "public"."enum_users_roles";
  DROP TYPE "public"."enum_transactions_adapter";
  DROP TYPE "public"."enum_transactions_tracker";
  DROP TYPE "public"."enum_transactions_status";
  DROP TYPE "public"."enum_transactions_sync_status";
  DROP TYPE "public"."enum_transactions_aml_status";
  DROP TYPE "public"."enum_apps_environment";
  DROP TYPE "public"."enum_apps_kind";
  DROP TYPE "public"."enum_billing_history_provider";
  DROP TYPE "public"."enum_billing_history_status";
  DROP TYPE "public"."enum_quota_usage_ledger_status";
  DROP TYPE "public"."enum_connected_wallets_chain_type";
  DROP TYPE "public"."enum_organization_members_role";
  DROP TYPE "public"."enum_webhook_endpoints_events";
  DROP TYPE "public"."enum_billing_plans_type";
  DROP TYPE "public"."enum_billing_plans_currency";
  DROP TYPE "public"."enum_invoices_status";
  DROP TYPE "public"."enum_invoices_currency";
  DROP TYPE "public"."enum_outbox_events_status";
  DROP TYPE "public"."enum_app_invoices_status";
  DROP TYPE "public"."enum_app_invoices_currency";
  DROP TYPE "public"."enum_system_pricing_base_currency";`)
}
