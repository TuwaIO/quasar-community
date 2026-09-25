-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."enum_app_invoices_currency" AS ENUM('USD');--> statement-breakpoint
CREATE TYPE "public"."enum_app_invoices_status" AS ENUM('draft', 'pending', 'paid', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."enum_apps_environment" AS ENUM('live', 'test');--> statement-breakpoint
CREATE TYPE "public"."enum_apps_kind" AS ENUM('basic', 'payments');--> statement-breakpoint
CREATE TYPE "public"."enum_billing_history_provider" AS ENUM('whitepay', 'admin', 'manual', 'transfer_in', 'transfer_out', 'web3_direct');--> statement-breakpoint
CREATE TYPE "public"."enum_billing_history_status" AS ENUM('success', 'pending', 'failed');--> statement-breakpoint
CREATE TYPE "public"."enum_billing_plans_currency" AS ENUM('USD', 'USDC', 'ETH');--> statement-breakpoint
CREATE TYPE "public"."enum_billing_plans_type" AS ENUM('one_time', 'subscription');--> statement-breakpoint
CREATE TYPE "public"."enum_connected_wallets_chain_type" AS ENUM('evm', 'solana', 'btc');--> statement-breakpoint
CREATE TYPE "public"."enum_invoices_currency" AS ENUM('USD');--> statement-breakpoint
CREATE TYPE "public"."enum_invoices_status" AS ENUM('pending', 'paid', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."enum_organization_members_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."enum_outbox_events_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."enum_system_pricing_base_currency" AS ENUM('USD');--> statement-breakpoint
CREATE TYPE "public"."enum_transactions_adapter" AS ENUM('evm', 'solana', 'starknet');--> statement-breakpoint
CREATE TYPE "public"."enum_transactions_aml_status" AS ENUM('not_applicable', 'pending', 'passed', 'flagged', 'failed');--> statement-breakpoint
CREATE TYPE "public"."enum_transactions_status" AS ENUM('Failed', 'Success', 'Replaced');--> statement-breakpoint
CREATE TYPE "public"."enum_transactions_tracker" AS ENUM('ethereum', 'safe', 'gelato', 'solana');--> statement-breakpoint
CREATE TYPE "public"."enum_users_roles" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TYPE "public"."enum_webhook_endpoints_events" AS ENUM('*', 'transaction:success', 'transaction:failed', 'transaction:replaced');--> statement-breakpoint
CREATE SEQUENCE "public"."transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "payload_kv" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payload_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar,
	"batch" numeric,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"login_attempts" numeric DEFAULT '0',
	"lock_until" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "users_roles" (
	"order" integer NOT NULL,
	"parent_id" varchar NOT NULL,
	"value" "enum_users_roles",
	"id" serial PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users_sessions" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone,
	"expires_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"slug" varchar,
	"created_by" varchar NOT NULL,
	"quota_balance" numeric DEFAULT '100' NOT NULL,
	"rps_limit" numeric DEFAULT '5' NOT NULL,
	"rps_paid_limit" numeric DEFAULT '5' NOT NULL,
	"rps_expires_at" timestamp(3) with time zone,
	"payment_gateway_i_d" varchar,
	"quota_used" numeric DEFAULT '0' NOT NULL,
	"rps_forever" boolean DEFAULT false,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "apps_ip_whitelist" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"ip" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps_domains_whitelist" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"domain" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps_rpc_configs" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"chain_id" varchar NOT NULL,
	"rpc_url" varchar NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "passkeys_texts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"text" varchar
);
--> statement-breakpoint
CREATE TABLE "connected_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"address" varchar NOT NULL,
	"chain_type" "enum_connected_wallets_chain_type" DEFAULT 'evm' NOT NULL,
	"label" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" varchar PRIMARY KEY NOT NULL,
	"organization_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" "enum_organization_members_role" DEFAULT 'member' NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" varchar PRIMARY KEY NOT NULL,
	"app_id" varchar NOT NULL,
	"url" varchar NOT NULL,
	"signing_secret" varchar NOT NULL,
	"is_active" boolean DEFAULT true,
	"description" varchar,
	"tx_type" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints_events" (
	"order" integer NOT NULL,
	"parent_id" varchar NOT NULL,
	"value" "enum_webhook_endpoints_events",
	"id" serial PRIMARY KEY NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "billing_plans_features" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"feature" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accepted_payments" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"wallet_address_to_receive_payment" varchar NOT NULL,
	"token_address" varchar NOT NULL,
	"price_feed_address" varchar NOT NULL,
	"chain_id" numeric NOT NULL,
	"symbol" varchar NOT NULL,
	"decimals" numeric DEFAULT '6' NOT NULL,
	"markup" numeric DEFAULT '0',
	"discount" numeric DEFAULT '0',
	"is_active" boolean DEFAULT true,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_accepted_payments" (
	"id" varchar PRIMARY KEY NOT NULL,
	"app_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"wallet_address_to_receive_payment" varchar NOT NULL,
	"token_address" varchar NOT NULL,
	"chain_id" numeric NOT NULL,
	"symbol" varchar NOT NULL,
	"decimals" numeric DEFAULT '6' NOT NULL,
	"markup" numeric DEFAULT '0',
	"discount" numeric DEFAULT '0',
	"price_feed_address" varchar,
	"is_active" boolean DEFAULT true,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payload_locked_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"global_slug" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payload_locked_documents_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"users_id" varchar,
	"transactions_id" integer,
	"apps_id" varchar,
	"billing_history_id" varchar,
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
--> statement-breakpoint
CREATE TABLE "deleted_accounts" (
	"id" varchar PRIMARY KEY NOT NULL,
	"email" varchar NOT NULL,
	"original_id" varchar NOT NULL,
	"deleted_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deleted_organizations" (
	"id" varchar PRIMARY KEY NOT NULL,
	"org_name" varchar NOT NULL,
	"original_id" varchar NOT NULL,
	"deleted_by" varchar NOT NULL,
	"deleted_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deleted_organization_members" (
	"id" varchar PRIMARY KEY NOT NULL,
	"organization" varchar NOT NULL,
	"user" varchar,
	"email" varchar NOT NULL,
	"deleted_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" varchar NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "enum_outbox_events_status" DEFAULT 'pending' NOT NULL,
	"attempts" numeric DEFAULT '0' NOT NULL,
	"next_attempt_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "faq" (
	"id" serial PRIMARY KEY NOT NULL,
	"question" varchar NOT NULL,
	"answer" varchar NOT NULL,
	"order" numeric DEFAULT '0',
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payload_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar,
	"value" jsonb,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payload_preferences_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"users_id" varchar
);
--> statement-breakpoint
CREATE TABLE "system_pricing" (
	"id" serial PRIMARY KEY NOT NULL,
	"base_currency" "enum_system_pricing_base_currency" DEFAULT 'USD' NOT NULL,
	"cost_per_quota" numeric NOT NULL,
	"cost_per_r_p_s" numeric NOT NULL,
	"minimum_deposit_amount" numeric DEFAULT '5' NOT NULL,
	"max_discount_percentage" numeric DEFAULT '15' NOT NULL,
	"updated_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "system_pricing_volume_discounts" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"quota_threshold" numeric NOT NULL,
	"discount_percentage" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_pricing_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"accepted_payments_id" varchar
);
--> statement-breakpoint
CREATE TABLE "invoice_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"issuer_name" varchar DEFAULT 'FOP Tkach Oleksandr' NOT NULL,
	"issuer_role" varchar DEFAULT 'Founder' NOT NULL,
	"signature_image_id" integer NOT NULL,
	"pdf_template" jsonb NOT NULL,
	"updated_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone
);
--> statement-breakpoint
ALTER TABLE "users_roles" ADD CONSTRAINT "users_roles_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_invoices" ADD CONSTRAINT "app_invoices_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_invoices" ADD CONSTRAINT "app_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_invoices" ADD CONSTRAINT "app_invoices_accepted_payment_id_app_accepted_payments_id_fk" FOREIGN KEY ("accepted_payment_id") REFERENCES "public"."app_accepted_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps_ip_whitelist" ADD CONSTRAINT "apps_ip_whitelist_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps_domains_whitelist" ADD CONSTRAINT "apps_domains_whitelist_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps_rpc_configs" ADD CONSTRAINT "apps_rpc_configs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_accepted_payment_id_accepted_payments_id_fk" FOREIGN KEY ("accepted_payment_id") REFERENCES "public"."accepted_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys_texts" ADD CONSTRAINT "passkeys_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."passkeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_wallets" ADD CONSTRAINT "connected_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_billing_profiles" ADD CONSTRAINT "organization_billing_profiles_organization_id_organizations_id_" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints_events" ADD CONSTRAINT "webhook_endpoints_events_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_plans_features" ADD CONSTRAINT "billing_plans_features_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."billing_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_accepted_payments" ADD CONSTRAINT "app_accepted_payments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_accepted_payments" ADD CONSTRAINT "app_accepted_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_apps_fk" FOREIGN KEY ("apps_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_billing_history_fk" FOREIGN KEY ("billing_history_id") REFERENCES "public"."billing_history"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_passkeys_fk" FOREIGN KEY ("passkeys_id") REFERENCES "public"."passkeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_connected_wallets_fk" FOREIGN KEY ("connected_wallets_id") REFERENCES "public"."connected_wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_organizations_fk" FOREIGN KEY ("organizations_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_organization_members_fk" FOREIGN KEY ("organization_members_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_organization_billing_profil_fk" FOREIGN KEY ("organization_billing_profiles_id") REFERENCES "public"."organization_billing_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_deleted_accounts_fk" FOREIGN KEY ("deleted_accounts_id") REFERENCES "public"."deleted_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_deleted_organizations_fk" FOREIGN KEY ("deleted_organizations_id") REFERENCES "public"."deleted_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_deleted_organization_member_fk" FOREIGN KEY ("deleted_organization_members_id") REFERENCES "public"."deleted_organization_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_webhook_endpoints_fk" FOREIGN KEY ("webhook_endpoints_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_accepted_payments_fk" FOREIGN KEY ("accepted_payments_id") REFERENCES "public"."accepted_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_billing_plans_fk" FOREIGN KEY ("billing_plans_id") REFERENCES "public"."billing_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_invoices_fk" FOREIGN KEY ("invoices_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_outbox_events_fk" FOREIGN KEY ("outbox_events_id") REFERENCES "public"."outbox_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_app_accepted_payments_fk" FOREIGN KEY ("app_accepted_payments_id") REFERENCES "public"."app_accepted_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_app_invoices_fk" FOREIGN KEY ("app_invoices_id") REFERENCES "public"."app_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_faq_fk" FOREIGN KEY ("faq_id") REFERENCES "public"."faq"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_pricing_volume_discounts" ADD CONSTRAINT "system_pricing_volume_discounts_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."system_pricing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_pricing_rels" ADD CONSTRAINT "system_pricing_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."system_pricing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_pricing_rels" ADD CONSTRAINT "system_pricing_rels_accepted_payments_fk" FOREIGN KEY ("accepted_payments_id") REFERENCES "public"."accepted_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_signature_image_id_media_id_fk" FOREIGN KEY ("signature_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key" text_ops);--> statement-breakpoint
CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "users_roles_order_idx" ON "users_roles" USING btree ("order" int4_ops);--> statement-breakpoint
CREATE INDEX "users_roles_parent_idx" ON "users_roles" USING btree ("parent_id" text_ops);--> statement-breakpoint
CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order" int4_ops);--> statement-breakpoint
CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id" text_ops);--> statement-breakpoint
CREATE INDEX "organizations_created_at_idx" ON "organizations" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "organizations_created_by_idx" ON "organizations" USING btree ("created_by" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug" text_ops);--> statement-breakpoint
CREATE INDEX "organizations_updated_at_idx" ON "organizations" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "apps_created_at_idx" ON "apps" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "apps_environment_idx" ON "apps" USING btree ("environment" enum_ops);--> statement-breakpoint
CREATE INDEX "apps_is_active_idx" ON "apps" USING btree ("is_active" bool_ops);--> statement-breakpoint
CREATE INDEX "apps_kind_idx" ON "apps" USING btree ("kind" enum_ops);--> statement-breakpoint
CREATE INDEX "apps_organization_idx" ON "apps" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "apps_public_key_idx" ON "apps" USING btree ("public_key" text_ops);--> statement-breakpoint
CREATE INDEX "apps_secret_key_hash_idx" ON "apps" USING btree ("secret_key_hash" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "apps_secret_key_idx" ON "apps" USING btree ("secret_key" text_ops);--> statement-breakpoint
CREATE INDEX "apps_updated_at_idx" ON "apps" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "app_invoices_accepted_payment_idx" ON "app_invoices" USING btree ("accepted_payment_id" text_ops);--> statement-breakpoint
CREATE INDEX "app_invoices_app_idx" ON "app_invoices" USING btree ("app_id" text_ops);--> statement-breakpoint
CREATE INDEX "app_invoices_created_at_idx" ON "app_invoices" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "app_invoices_organization_idx" ON "app_invoices" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "app_invoices_status_idx" ON "app_invoices" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "app_invoices_tx_hash_idx" ON "app_invoices" USING btree ("tx_hash" text_ops);--> statement-breakpoint
CREATE INDEX "app_invoices_updated_at_idx" ON "app_invoices" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "apps_ip_whitelist_order_idx" ON "apps_ip_whitelist" USING btree ("_order" int4_ops);--> statement-breakpoint
CREATE INDEX "apps_ip_whitelist_parent_id_idx" ON "apps_ip_whitelist" USING btree ("_parent_id" text_ops);--> statement-breakpoint
CREATE INDEX "apps_domains_whitelist_order_idx" ON "apps_domains_whitelist" USING btree ("_order" int4_ops);--> statement-breakpoint
CREATE INDEX "apps_domains_whitelist_parent_id_idx" ON "apps_domains_whitelist" USING btree ("_parent_id" text_ops);--> statement-breakpoint
CREATE INDEX "apps_rpc_configs_order_idx" ON "apps_rpc_configs" USING btree ("_order" int4_ops);--> statement-breakpoint
CREATE INDEX "apps_rpc_configs_parent_id_idx" ON "apps_rpc_configs" USING btree ("_parent_id" text_ops);--> statement-breakpoint
CREATE INDEX "billing_history_created_at_idx" ON "billing_history" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "billing_history_external_id_idx" ON "billing_history" USING btree ("external_id" text_ops);--> statement-breakpoint
CREATE INDEX "billing_history_invoice_idx" ON "billing_history" USING btree ("invoice_id" text_ops);--> statement-breakpoint
CREATE INDEX "billing_history_organization_idx" ON "billing_history" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "billing_history_status_idx" ON "billing_history" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "billing_history_updated_at_idx" ON "billing_history" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "invoices_accepted_payment_idx" ON "invoices" USING btree ("accepted_payment_id" text_ops);--> statement-breakpoint
CREATE INDEX "invoices_created_at_idx" ON "invoices" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "invoices_organization_idx" ON "invoices" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "invoices_plan_idx" ON "invoices" USING btree ("plan_id" text_ops);--> statement-breakpoint
CREATE INDEX "invoices_tx_hash_idx" ON "invoices" USING btree ("tx_hash" text_ops);--> statement-breakpoint
CREATE INDEX "invoices_updated_at_idx" ON "invoices" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "passkeys_created_at_idx" ON "passkeys" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credential_i_d_idx" ON "passkeys" USING btree ("credential_i_d" text_ops);--> statement-breakpoint
CREATE INDEX "passkeys_updated_at_idx" ON "passkeys" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "passkeys" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "passkeys_texts_order_parent" ON "passkeys_texts" USING btree ("order" int4_ops,"parent_id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "connected_wallets_address_idx" ON "connected_wallets" USING btree ("address" text_ops);--> statement-breakpoint
CREATE INDEX "connected_wallets_created_at_idx" ON "connected_wallets" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "connected_wallets_updated_at_idx" ON "connected_wallets" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "connected_wallets_user_idx" ON "connected_wallets" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "organization_members_created_at_idx" ON "organization_members" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "organization_members_organization_idx" ON "organization_members" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "organization_members_updated_at_idx" ON "organization_members" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "organization_user_idx" ON "organization_members" USING btree ("organization_id" text_ops,"user_id" text_ops);--> statement-breakpoint
CREATE INDEX "organization_billing_profiles_created_at_idx" ON "organization_billing_profiles" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "organization_billing_profiles_organization_idx" ON "organization_billing_profiles" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "organization_billing_profiles_updated_at_idx" ON "organization_billing_profiles" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "webhook_endpoints_app_idx" ON "webhook_endpoints" USING btree ("app_id" text_ops);--> statement-breakpoint
CREATE INDEX "webhook_endpoints_created_at_idx" ON "webhook_endpoints" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoints_signing_secret_idx" ON "webhook_endpoints" USING btree ("signing_secret" text_ops);--> statement-breakpoint
CREATE INDEX "webhook_endpoints_updated_at_idx" ON "webhook_endpoints" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "webhook_endpoints_events_order_idx" ON "webhook_endpoints_events" USING btree ("order" int4_ops);--> statement-breakpoint
CREATE INDEX "webhook_endpoints_events_parent_idx" ON "webhook_endpoints_events" USING btree ("parent_id" text_ops);--> statement-breakpoint
CREATE INDEX "billing_plans_created_at_idx" ON "billing_plans" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "billing_plans_updated_at_idx" ON "billing_plans" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "billing_plans_features_order_idx" ON "billing_plans_features" USING btree ("_order" int4_ops);--> statement-breakpoint
CREATE INDEX "billing_plans_features_parent_id_idx" ON "billing_plans_features" USING btree ("_parent_id" text_ops);--> statement-breakpoint
CREATE INDEX "accepted_payments_created_at_idx" ON "accepted_payments" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "accepted_payments_updated_at_idx" ON "accepted_payments" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "app_accepted_payments_app_idx" ON "app_accepted_payments" USING btree ("app_id" text_ops);--> statement-breakpoint
CREATE INDEX "app_accepted_payments_created_at_idx" ON "app_accepted_payments" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "app_accepted_payments_organization_idx" ON "app_accepted_payments" USING btree ("organization_id" text_ops);--> statement-breakpoint
CREATE INDEX "app_accepted_payments_updated_at_idx" ON "app_accepted_payments" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_accepted_payments_id_idx" ON "payload_locked_documents_rels" USING btree ("accepted_payments_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_app_accepted_payments_id_idx" ON "payload_locked_documents_rels" USING btree ("app_accepted_payments_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_app_invoices_id_idx" ON "payload_locked_documents_rels" USING btree ("app_invoices_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_apps_id_idx" ON "payload_locked_documents_rels" USING btree ("apps_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_billing_history_id_idx" ON "payload_locked_documents_rels" USING btree ("billing_history_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_billing_plans_id_idx" ON "payload_locked_documents_rels" USING btree ("billing_plans_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_connected_wallets_id_idx" ON "payload_locked_documents_rels" USING btree ("connected_wallets_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_deleted_accounts_id_idx" ON "payload_locked_documents_rels" USING btree ("deleted_accounts_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_deleted_organization_membe_idx" ON "payload_locked_documents_rels" USING btree ("deleted_organization_members_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_deleted_organizations_id_idx" ON "payload_locked_documents_rels" USING btree ("deleted_organizations_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_faq_id_idx" ON "payload_locked_documents_rels" USING btree ("faq_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_invoices_id_idx" ON "payload_locked_documents_rels" USING btree ("invoices_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_organization_billing_profi_idx" ON "payload_locked_documents_rels" USING btree ("organization_billing_profiles_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_organization_members_id_idx" ON "payload_locked_documents_rels" USING btree ("organization_members_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_organizations_id_idx" ON "payload_locked_documents_rels" USING btree ("organizations_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_outbox_events_id_idx" ON "payload_locked_documents_rels" USING btree ("outbox_events_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_passkeys_id_idx" ON "payload_locked_documents_rels" USING btree ("passkeys_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_transactions_id_idx" ON "payload_locked_documents_rels" USING btree ("transactions_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_webhook_deliveries_id_idx" ON "payload_locked_documents_rels" USING btree ("webhook_deliveries_id" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_webhook_endpoints_id_idx" ON "payload_locked_documents_rels" USING btree ("webhook_endpoints_id" text_ops);--> statement-breakpoint
CREATE INDEX "deleted_accounts_created_at_idx" ON "deleted_accounts" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "deleted_accounts_deleted_at_idx" ON "deleted_accounts" USING btree ("deleted_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "deleted_accounts_email_idx" ON "deleted_accounts" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "deleted_accounts_original_id_idx" ON "deleted_accounts" USING btree ("original_id" text_ops);--> statement-breakpoint
CREATE INDEX "deleted_accounts_updated_at_idx" ON "deleted_accounts" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "deleted_organizations_created_at_idx" ON "deleted_organizations" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "deleted_organizations_deleted_at_idx" ON "deleted_organizations" USING btree ("deleted_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "deleted_organizations_deleted_by_idx" ON "deleted_organizations" USING btree ("deleted_by" text_ops);--> statement-breakpoint
CREATE INDEX "deleted_organizations_original_id_idx" ON "deleted_organizations" USING btree ("original_id" text_ops);--> statement-breakpoint
CREATE INDEX "deleted_organizations_updated_at_idx" ON "deleted_organizations" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "deleted_organization_members_created_at_idx" ON "deleted_organization_members" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "deleted_organization_members_deleted_at_idx" ON "deleted_organization_members" USING btree ("deleted_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "deleted_organization_members_email_idx" ON "deleted_organization_members" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "deleted_organization_members_organization_idx" ON "deleted_organization_members" USING btree ("organization" text_ops);--> statement-breakpoint
CREATE INDEX "deleted_organization_members_updated_at_idx" ON "deleted_organization_members" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "deleted_organization_members_user_idx" ON "deleted_organization_members" USING btree ("user" text_ops);--> statement-breakpoint
CREATE INDEX "outbox_events_created_at_idx" ON "outbox_events" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "outbox_events_updated_at_idx" ON "outbox_events" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename" text_ops);--> statement-breakpoint
CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "faq_created_at_idx" ON "faq" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "faq_updated_at_idx" ON "faq" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key" text_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path" text_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id" text_ops);--> statement-breakpoint
CREATE INDEX "system_pricing_volume_discounts_order_idx" ON "system_pricing_volume_discounts" USING btree ("_order" int4_ops);--> statement-breakpoint
CREATE INDEX "system_pricing_volume_discounts_parent_id_idx" ON "system_pricing_volume_discounts" USING btree ("_parent_id" int4_ops);--> statement-breakpoint
CREATE INDEX "system_pricing_rels_accepted_payments_id_idx" ON "system_pricing_rels" USING btree ("accepted_payments_id" text_ops);--> statement-breakpoint
CREATE INDEX "system_pricing_rels_order_idx" ON "system_pricing_rels" USING btree ("order" int4_ops);--> statement-breakpoint
CREATE INDEX "system_pricing_rels_parent_idx" ON "system_pricing_rels" USING btree ("parent_id" int4_ops);--> statement-breakpoint
CREATE INDEX "system_pricing_rels_path_idx" ON "system_pricing_rels" USING btree ("path" text_ops);--> statement-breakpoint
CREATE INDEX "invoice_settings_signature_image_idx" ON "invoice_settings" USING btree ("signature_image_id" int4_ops);
*/