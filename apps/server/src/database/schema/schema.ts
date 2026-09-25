import { pgTable, uniqueIndex, serial, varchar, jsonb, index, numeric, timestamp, foreignKey, boolean, integer, primaryKey, pgSequence, pgEnum } from "drizzle-orm/pg-core"

export const enumAppInvoicesCurrency = pgEnum("enum_app_invoices_currency", ['USD'])
export const enumAppInvoicesStatus = pgEnum("enum_app_invoices_status", ['draft', 'pending', 'paid', 'failed', 'expired', 'cancelled'])
export const enumAppsEnvironment = pgEnum("enum_apps_environment", ['live', 'test'])
export const enumAppsKind = pgEnum("enum_apps_kind", ['basic', 'payments'])
export const enumBillingHistoryProvider = pgEnum("enum_billing_history_provider", ['admin', 'manual', 'transfer_in', 'transfer_out', 'web3_direct'])
export const enumBillingHistoryStatus = pgEnum("enum_billing_history_status", ['success', 'pending', 'failed'])
export const enumBillingPlansCurrency = pgEnum("enum_billing_plans_currency", ['USD', 'USDC', 'ETH'])
export const enumBillingPlansType = pgEnum("enum_billing_plans_type", ['one_time', 'subscription'])
export const enumConnectedWalletsChainType = pgEnum("enum_connected_wallets_chain_type", ['evm', 'solana', 'btc'])
export const enumInvoicesCurrency = pgEnum("enum_invoices_currency", ['USD'])
export const enumInvoicesStatus = pgEnum("enum_invoices_status", ['pending', 'paid', 'failed', 'expired', 'cancelled'])
export const enumOrganizationMembersRole = pgEnum("enum_organization_members_role", ['owner', 'admin', 'member'])
export const enumOutboxEventsStatus = pgEnum("enum_outbox_events_status", ['pending', 'processed', 'failed'])
export const enumQuotaUsageLedgerStatus = pgEnum("enum_quota_usage_ledger_status", ['applied', 'manual-review'])
export const enumSystemPricingBaseCurrency = pgEnum("enum_system_pricing_base_currency", ['USD'])
export const enumTransactionsAdapter = pgEnum("enum_transactions_adapter", ['evm', 'solana', 'starknet'])
export const enumTransactionsAmlStatus = pgEnum("enum_transactions_aml_status", ['not_applicable', 'pending', 'passed', 'flagged', 'failed'])
export const enumTransactionsStatus = pgEnum("enum_transactions_status", ['Failed', 'Success', 'Replaced'])
export const enumTransactionsSyncStatus = pgEnum("enum_transactions_sync_status", ['synced', 'pending-sync'])
export const enumTransactionsTracker = pgEnum("enum_transactions_tracker", ['ethereum', 'safe', 'gelato', 'solana', 'erc4337'])
export const enumUsersRoles = pgEnum("enum_users_roles", ['admin', 'user'])
export const enumWebhookEndpointsEvents = pgEnum("enum_webhook_endpoints_events", ['*', 'transaction:success', 'transaction:failed', 'transaction:replaced'])

export const transactionsIdSeq = pgSequence("transactions_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })

export const payloadKv = pgTable("payload_kv", {
	id: serial().primaryKey().notNull(),
	key: varchar().notNull(),
	data: jsonb().notNull(),
}, (table) => [
	uniqueIndex("payload_kv_key_idx").using("btree", table.key.asc().nullsLast().op("text_ops")),
]);

export const payloadMigrations = pgTable("payload_migrations", {
	id: serial().primaryKey().notNull(),
	name: varchar(),
	batch: numeric(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("payload_migrations_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("payload_migrations_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const webhookEndpoints = pgTable("webhook_endpoints", {
	id: varchar().primaryKey().notNull(),
	appId: varchar("app_id").notNull(),
	url: varchar().notNull(),
	signingSecret: varchar("signing_secret").notNull(),
	isActive: boolean("is_active").default(true),
	description: varchar(),
	txType: varchar("tx_type").default('*').notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	isSystemWebhook: boolean("is_system_webhook").default(false),
}, (table) => [
	index("webhook_endpoints_app_idx").using("btree", table.appId.asc().nullsLast().op("text_ops")),
	index("webhook_endpoints_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("webhook_endpoints_signing_secret_idx").using("btree", table.signingSecret.asc().nullsLast().op("text_ops")),
	index("webhook_endpoints_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.appId],
			foreignColumns: [apps.id],
			name: "webhook_endpoints_app_id_apps_id_fk"
		}).onDelete("set null"),
]);

export const users = pgTable("users", {
	id: varchar().primaryKey().notNull(),
	name: varchar(),
	telegramUsername: varchar("telegram_username"),
	discordUsername: varchar("discord_username"),
	twoFactorEnabled: boolean("two_factor_enabled").default(false),
	twoFactorSecret: varchar("two_factor_secret"),
	backupCode: varchar("backup_code"),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	email: varchar().notNull(),
	resetPasswordToken: varchar("reset_password_token"),
	resetPasswordExpiration: timestamp("reset_password_expiration", { precision: 3, withTimezone: true, mode: 'string' }),
	salt: varchar(),
	hash: varchar(),
	verified: boolean("_verified"),
	verificationtoken: varchar("_verificationtoken"),
	loginAttempts: numeric("login_attempts").default('0'),
	lockUntil: timestamp("lock_until", { precision: 3, withTimezone: true, mode: 'string' }),
}, (table) => [
	index("users_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("users_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("users_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const usersRoles = pgTable("users_roles", {
	order: integer().notNull(),
	parentId: varchar("parent_id").notNull(),
	value: enumUsersRoles(),
	id: serial().primaryKey().notNull(),
}, (table) => [
	index("users_roles_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("users_roles_parent_idx").using("btree", table.parentId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [users.id],
			name: "users_roles_parent_fk"
		}).onDelete("cascade"),
]);

export const usersSessions = pgTable("users_sessions", {
	order: integer("_order").notNull(),
	parentId: varchar("_parent_id").notNull(),
	id: varchar().primaryKey().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("users_sessions_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("users_sessions_parent_id_idx").using("btree", table.parentId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [users.id],
			name: "users_sessions_parent_id_fk"
		}).onDelete("cascade"),
]);

export const organizations = pgTable("organizations", {
	id: varchar().primaryKey().notNull(),
	name: varchar().notNull(),
	slug: varchar(),
	createdBy: varchar("created_by").notNull(),
	quotaBalance: numeric("quota_balance").default('100').notNull(),
	rpsLimit: numeric("rps_limit").default('5').notNull(),
	rpsPaidLimit: numeric("rps_paid_limit").default('5').notNull(),
	rpsExpiresAt: timestamp("rps_expires_at", { precision: 3, withTimezone: true, mode: 'string' }),
	paymentGatewayID: varchar("payment_gateway_i_d"),
	quotaUsed: numeric("quota_used").default('0').notNull(),
	rpsForever: boolean("rps_forever").default(false),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("organizations_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("organizations_created_by_idx").using("btree", table.createdBy.asc().nullsLast().op("text_ops")),
	uniqueIndex("organizations_slug_idx").using("btree", table.slug.asc().nullsLast().op("text_ops")),
	index("organizations_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const appInvoices = pgTable("app_invoices", {
	id: varchar().primaryKey().notNull(),
	appId: varchar("app_id").notNull(),
	organizationId: varchar("organization_id").notNull(),
	status: enumAppInvoicesStatus().default('draft').notNull(),
	baseAmount: numeric("base_amount").notNull(),
	totalAmount: numeric("total_amount").notNull(),
	currency: enumAppInvoicesCurrency().default('USD').notNull(),
	cryptoAmountExpected: varchar("crypto_amount_expected").notNull(),
	acceptedPaymentId: varchar("accepted_payment_id").notNull(),
	txHash: varchar("tx_hash"),
	originWallet: varchar("origin_wallet"),
	metadata: jsonb(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("app_invoices_accepted_payment_idx").using("btree", table.acceptedPaymentId.asc().nullsLast().op("text_ops")),
	index("app_invoices_app_idx").using("btree", table.appId.asc().nullsLast().op("text_ops")),
	index("app_invoices_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("app_invoices_organization_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
	index("app_invoices_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	uniqueIndex("app_invoices_tx_hash_idx").using("btree", table.txHash.asc().nullsLast().op("text_ops")),
	index("app_invoices_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.appId],
			foreignColumns: [apps.id],
			name: "app_invoices_app_id_apps_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "app_invoices_organization_id_organizations_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.acceptedPaymentId],
			foreignColumns: [appAcceptedPayments.id],
			name: "app_invoices_accepted_payment_id_app_accepted_payments_id_fk"
		}).onDelete("set null"),
]);

export const appsIpWhitelist = pgTable("apps_ip_whitelist", {
	order: integer("_order").notNull(),
	parentId: varchar("_parent_id").notNull(),
	id: varchar().primaryKey().notNull(),
	ip: varchar().notNull(),
}, (table) => [
	index("apps_ip_whitelist_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("apps_ip_whitelist_parent_id_idx").using("btree", table.parentId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [apps.id],
			name: "apps_ip_whitelist_parent_id_fk"
		}).onDelete("cascade"),
]);

export const appsDomainsWhitelist = pgTable("apps_domains_whitelist", {
	order: integer("_order").notNull(),
	parentId: varchar("_parent_id").notNull(),
	id: varchar().primaryKey().notNull(),
	domain: varchar().notNull(),
}, (table) => [
	index("apps_domains_whitelist_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("apps_domains_whitelist_parent_id_idx").using("btree", table.parentId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [apps.id],
			name: "apps_domains_whitelist_parent_id_fk"
		}).onDelete("cascade"),
]);

export const appsRpcConfigs = pgTable("apps_rpc_configs", {
	order: integer("_order").notNull(),
	parentId: varchar("_parent_id").notNull(),
	id: varchar().primaryKey().notNull(),
	chainId: varchar("chain_id").notNull(),
	rpcUrl: varchar("rpc_url").notNull(),
}, (table) => [
	index("apps_rpc_configs_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("apps_rpc_configs_parent_id_idx").using("btree", table.parentId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [apps.id],
			name: "apps_rpc_configs_parent_id_fk"
		}).onDelete("cascade"),
]);

export const invoices = pgTable("invoices", {
	id: varchar().primaryKey().notNull(),
	organizationId: varchar("organization_id").notNull(),
	status: enumInvoicesStatus().default('pending').notNull(),
	planId: varchar("plan_id"),
	baseAmount: numeric("base_amount").notNull(),
	totalAmount: numeric("total_amount").notNull(),
	currency: enumInvoicesCurrency().default('USD').notNull(),
	cryptoAmountExpected: varchar("crypto_amount_expected").notNull(),
	acceptedPaymentId: varchar("accepted_payment_id").notNull(),
	txHash: varchar("tx_hash"),
	originWallet: varchar("origin_wallet"),
	rps: numeric(),
	quota: numeric(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("invoices_accepted_payment_idx").using("btree", table.acceptedPaymentId.asc().nullsLast().op("text_ops")),
	index("invoices_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("invoices_organization_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
	index("invoices_plan_idx").using("btree", table.planId.asc().nullsLast().op("text_ops")),
	uniqueIndex("invoices_tx_hash_idx").using("btree", table.txHash.asc().nullsLast().op("text_ops")),
	index("invoices_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "invoices_organization_id_organizations_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [billingPlans.id],
			name: "invoices_plan_id_billing_plans_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.acceptedPaymentId],
			foreignColumns: [acceptedPayments.id],
			name: "invoices_accepted_payment_id_accepted_payments_id_fk"
		}).onDelete("set null"),
]);

export const passkeys = pgTable("passkeys", {
	id: serial().primaryKey().notNull(),
	userId: varchar("user_id").notNull(),
	name: varchar(),
	credentialID: varchar("credential_i_d").notNull(),
	publicKey: varchar("public_key").notNull(),
	counter: numeric().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("passkeys_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("passkeys_credential_i_d_idx").using("btree", table.credentialID.asc().nullsLast().op("text_ops")),
	index("passkeys_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	index("passkeys_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "passkeys_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const passkeysTexts = pgTable("passkeys_texts", {
	id: serial().primaryKey().notNull(),
	order: integer().notNull(),
	parentId: integer("parent_id").notNull(),
	path: varchar().notNull(),
	text: varchar(),
}, (table) => [
	index("passkeys_texts_order_parent").using("btree", table.order.asc().nullsLast().op("int4_ops"), table.parentId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [passkeys.id],
			name: "passkeys_texts_parent_fk"
		}).onDelete("cascade"),
]);

export const connectedWallets = pgTable("connected_wallets", {
	id: serial().primaryKey().notNull(),
	userId: varchar("user_id").notNull(),
	address: varchar().notNull(),
	chainType: enumConnectedWalletsChainType("chain_type").default('evm').notNull(),
	label: varchar(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("connected_wallets_address_idx").using("btree", table.address.asc().nullsLast().op("text_ops")),
	index("connected_wallets_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("connected_wallets_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	index("connected_wallets_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "connected_wallets_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const organizationMembers = pgTable("organization_members", {
	id: varchar().primaryKey().notNull(),
	organizationId: varchar("organization_id").notNull(),
	userId: varchar("user_id").notNull(),
	role: enumOrganizationMembersRole().default('member').notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("organization_members_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("organization_members_organization_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
	index("organization_members_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	index("organization_members_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	uniqueIndex("organization_user_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops"), table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "organization_members_organization_id_organizations_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "organization_members_user_id_users_id_fk"
		}).onDelete("set null"),
]);

export const organizationBillingProfiles = pgTable("organization_billing_profiles", {
	id: varchar().primaryKey().notNull(),
	organizationId: varchar("organization_id").notNull(),
	billingName: varchar("billing_name").notNull(),
	addressLine1: varchar("address_line1").notNull(),
	addressLine2: varchar("address_line2"),
	city: varchar().notNull(),
	country: varchar().notNull(),
	registrationNumber: varchar("registration_number"),
	taxId: varchar("tax_id"),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("organization_billing_profiles_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("organization_billing_profiles_organization_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
	index("organization_billing_profiles_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "organization_billing_profiles_organization_id_organizations_id_"
		}).onDelete("set null"),
]);

export const webhookEndpointsEvents = pgTable("webhook_endpoints_events", {
	order: integer().notNull(),
	parentId: varchar("parent_id").notNull(),
	value: enumWebhookEndpointsEvents(),
	id: serial().primaryKey().notNull(),
}, (table) => [
	index("webhook_endpoints_events_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("webhook_endpoints_events_parent_idx").using("btree", table.parentId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [webhookEndpoints.id],
			name: "webhook_endpoints_events_parent_fk"
		}).onDelete("cascade"),
]);

export const billingPlans = pgTable("billing_plans", {
	id: varchar().primaryKey().notNull(),
	name: varchar().notNull(),
	type: enumBillingPlansType().notNull(),
	price: numeric().notNull(),
	currency: enumBillingPlansCurrency().default('USD').notNull(),
	quotaProvided: numeric("quota_provided").notNull(),
	rpsProvided: numeric("rps_provided").notNull(),
	isActive: boolean("is_active").default(true),
	priceId: varchar("price_id"),
	description: varchar(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("billing_plans_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("billing_plans_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const billingPlansFeatures = pgTable("billing_plans_features", {
	order: integer("_order").notNull(),
	parentId: varchar("_parent_id").notNull(),
	id: varchar().primaryKey().notNull(),
	feature: varchar().notNull(),
}, (table) => [
	index("billing_plans_features_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("billing_plans_features_parent_id_idx").using("btree", table.parentId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [billingPlans.id],
			name: "billing_plans_features_parent_id_fk"
		}).onDelete("cascade"),
]);

export const acceptedPayments = pgTable("accepted_payments", {
	id: varchar().primaryKey().notNull(),
	name: varchar().notNull(),
	walletAddressToReceivePayment: varchar("wallet_address_to_receive_payment").notNull(),
	tokenAddress: varchar("token_address").notNull(),
	priceFeedAddress: varchar("price_feed_address").notNull(),
	chainId: numeric("chain_id").notNull(),
	symbol: varchar().notNull(),
	decimals: numeric().default('6').notNull(),
	markup: numeric().default('0'),
	discount: numeric().default('0'),
	isActive: boolean("is_active").default(true),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("accepted_payments_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("accepted_payments_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const appAcceptedPayments = pgTable("app_accepted_payments", {
	id: varchar().primaryKey().notNull(),
	appId: varchar("app_id").notNull(),
	organizationId: varchar("organization_id").notNull(),
	name: varchar().notNull(),
	walletAddressToReceivePayment: varchar("wallet_address_to_receive_payment").notNull(),
	tokenAddress: varchar("token_address").notNull(),
	chainId: numeric("chain_id").notNull(),
	symbol: varchar().notNull(),
	decimals: numeric().default('6').notNull(),
	markup: numeric().default('0'),
	discount: numeric().default('0'),
	priceFeedAddress: varchar("price_feed_address").notNull(),
	isActive: boolean("is_active").default(true),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("app_accepted_payments_app_idx").using("btree", table.appId.asc().nullsLast().op("text_ops")),
	index("app_accepted_payments_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("app_accepted_payments_organization_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
	index("app_accepted_payments_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.appId],
			foreignColumns: [apps.id],
			name: "app_accepted_payments_app_id_apps_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "app_accepted_payments_organization_id_organizations_id_fk"
		}).onDelete("set null"),
]);

export const payloadLockedDocuments = pgTable("payload_locked_documents", {
	id: serial().primaryKey().notNull(),
	globalSlug: varchar("global_slug"),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("payload_locked_documents_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("payload_locked_documents_global_slug_idx").using("btree", table.globalSlug.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const deletedAccounts = pgTable("deleted_accounts", {
	id: varchar().primaryKey().notNull(),
	email: varchar().notNull(),
	originalId: varchar("original_id").notNull(),
	deletedAt: timestamp("deleted_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("deleted_accounts_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("deleted_accounts_deleted_at_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	index("deleted_accounts_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("deleted_accounts_original_id_idx").using("btree", table.originalId.asc().nullsLast().op("text_ops")),
	index("deleted_accounts_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const deletedOrganizations = pgTable("deleted_organizations", {
	id: varchar().primaryKey().notNull(),
	orgName: varchar("org_name").notNull(),
	originalId: varchar("original_id").notNull(),
	deletedBy: varchar("deleted_by").notNull(),
	deletedAt: timestamp("deleted_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("deleted_organizations_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("deleted_organizations_deleted_at_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	index("deleted_organizations_deleted_by_idx").using("btree", table.deletedBy.asc().nullsLast().op("text_ops")),
	index("deleted_organizations_original_id_idx").using("btree", table.originalId.asc().nullsLast().op("text_ops")),
	index("deleted_organizations_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const deletedOrganizationMembers = pgTable("deleted_organization_members", {
	id: varchar().primaryKey().notNull(),
	organization: varchar().notNull(),
	user: varchar(),
	email: varchar().notNull(),
	deletedAt: timestamp("deleted_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("deleted_organization_members_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("deleted_organization_members_deleted_at_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	index("deleted_organization_members_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("deleted_organization_members_organization_idx").using("btree", table.organization.asc().nullsLast().op("text_ops")),
	index("deleted_organization_members_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	index("deleted_organization_members_user_idx").using("btree", table.user.asc().nullsLast().op("text_ops")),
]);

export const billingHistory = pgTable("billing_history", {
	id: varchar().primaryKey().notNull(),
	organizationId: varchar("organization_id").notNull(),
	amount: numeric().notNull(),
	amountMoney: varchar("amount_money"),
	invoiceId: varchar("invoice_id"),
	provider: enumBillingHistoryProvider().notNull(),
	externalId: varchar("external_id"),
	status: enumBillingHistoryStatus().default('success').notNull(),
	rps: numeric(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("billing_history_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("billing_history_external_id_idx").using("btree", table.externalId.asc().nullsLast().op("text_ops")),
	index("billing_history_invoice_idx").using("btree", table.invoiceId.asc().nullsLast().op("text_ops")),
	index("billing_history_organization_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
	index("billing_history_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("billing_history_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "billing_history_organization_id_organizations_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "billing_history_invoice_id_invoices_id_fk"
		}).onDelete("set null"),
]);

export const payloadLockedDocumentsRels = pgTable("payload_locked_documents_rels", {
	id: serial().primaryKey().notNull(),
	order: integer(),
	parentId: integer("parent_id").notNull(),
	path: varchar().notNull(),
	usersId: varchar("users_id"),
	transactionsId: integer("transactions_id"),
	appsId: varchar("apps_id"),
	billingHistoryId: varchar("billing_history_id"),
	passkeysId: integer("passkeys_id"),
	connectedWalletsId: integer("connected_wallets_id"),
	organizationsId: varchar("organizations_id"),
	organizationMembersId: varchar("organization_members_id"),
	organizationBillingProfilesId: varchar("organization_billing_profiles_id"),
	deletedAccountsId: varchar("deleted_accounts_id"),
	deletedOrganizationsId: varchar("deleted_organizations_id"),
	deletedOrganizationMembersId: varchar("deleted_organization_members_id"),
	webhookEndpointsId: varchar("webhook_endpoints_id"),
	webhookDeliveriesId: varchar("webhook_deliveries_id"),
	acceptedPaymentsId: varchar("accepted_payments_id"),
	billingPlansId: varchar("billing_plans_id"),
	invoicesId: varchar("invoices_id"),
	outboxEventsId: integer("outbox_events_id"),
	appAcceptedPaymentsId: varchar("app_accepted_payments_id"),
	appInvoicesId: varchar("app_invoices_id"),
	mediaId: integer("media_id"),
	faqId: integer("faq_id"),
	quotaUsageLedgerId: varchar("quota_usage_ledger_id"),
}, (table) => [
	index("payload_locked_documents_rels_accepted_payments_id_idx").using("btree", table.acceptedPaymentsId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_app_accepted_payments_id_idx").using("btree", table.appAcceptedPaymentsId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_app_invoices_id_idx").using("btree", table.appInvoicesId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_apps_id_idx").using("btree", table.appsId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_billing_history_id_idx").using("btree", table.billingHistoryId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_billing_plans_id_idx").using("btree", table.billingPlansId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_connected_wallets_id_idx").using("btree", table.connectedWalletsId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_deleted_accounts_id_idx").using("btree", table.deletedAccountsId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_deleted_organization_membe_idx").using("btree", table.deletedOrganizationMembersId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_deleted_organizations_id_idx").using("btree", table.deletedOrganizationsId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_faq_id_idx").using("btree", table.faqId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_invoices_id_idx").using("btree", table.invoicesId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_media_id_idx").using("btree", table.mediaId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_organization_billing_profi_idx").using("btree", table.organizationBillingProfilesId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_organization_members_id_idx").using("btree", table.organizationMembersId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_organizations_id_idx").using("btree", table.organizationsId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_outbox_events_id_idx").using("btree", table.outboxEventsId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_parent_idx").using("btree", table.parentId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_passkeys_id_idx").using("btree", table.passkeysId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_path_idx").using("btree", table.path.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_quota_usage_ledger_id_idx").using("btree", table.quotaUsageLedgerId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_transactions_id_idx").using("btree", table.transactionsId.asc().nullsLast().op("int4_ops")),
	index("payload_locked_documents_rels_users_id_idx").using("btree", table.usersId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_webhook_deliveries_id_idx").using("btree", table.webhookDeliveriesId.asc().nullsLast().op("text_ops")),
	index("payload_locked_documents_rels_webhook_endpoints_id_idx").using("btree", table.webhookEndpointsId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [payloadLockedDocuments.id],
			name: "payload_locked_documents_rels_parent_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.usersId],
			foreignColumns: [users.id],
			name: "payload_locked_documents_rels_users_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appsId],
			foreignColumns: [apps.id],
			name: "payload_locked_documents_rels_apps_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.billingHistoryId],
			foreignColumns: [billingHistory.id],
			name: "payload_locked_documents_rels_billing_history_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.passkeysId],
			foreignColumns: [passkeys.id],
			name: "payload_locked_documents_rels_passkeys_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.connectedWalletsId],
			foreignColumns: [connectedWallets.id],
			name: "payload_locked_documents_rels_connected_wallets_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizationsId],
			foreignColumns: [organizations.id],
			name: "payload_locked_documents_rels_organizations_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizationMembersId],
			foreignColumns: [organizationMembers.id],
			name: "payload_locked_documents_rels_organization_members_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organizationBillingProfilesId],
			foreignColumns: [organizationBillingProfiles.id],
			name: "payload_locked_documents_rels_organization_billing_profil_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.deletedAccountsId],
			foreignColumns: [deletedAccounts.id],
			name: "payload_locked_documents_rels_deleted_accounts_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.deletedOrganizationsId],
			foreignColumns: [deletedOrganizations.id],
			name: "payload_locked_documents_rels_deleted_organizations_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.deletedOrganizationMembersId],
			foreignColumns: [deletedOrganizationMembers.id],
			name: "payload_locked_documents_rels_deleted_organization_member_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.webhookEndpointsId],
			foreignColumns: [webhookEndpoints.id],
			name: "payload_locked_documents_rels_webhook_endpoints_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.acceptedPaymentsId],
			foreignColumns: [acceptedPayments.id],
			name: "payload_locked_documents_rels_accepted_payments_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.billingPlansId],
			foreignColumns: [billingPlans.id],
			name: "payload_locked_documents_rels_billing_plans_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.invoicesId],
			foreignColumns: [invoices.id],
			name: "payload_locked_documents_rels_invoices_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.outboxEventsId],
			foreignColumns: [outboxEvents.id],
			name: "payload_locked_documents_rels_outbox_events_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appAcceptedPaymentsId],
			foreignColumns: [appAcceptedPayments.id],
			name: "payload_locked_documents_rels_app_accepted_payments_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appInvoicesId],
			foreignColumns: [appInvoices.id],
			name: "payload_locked_documents_rels_app_invoices_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.mediaId],
			foreignColumns: [media.id],
			name: "payload_locked_documents_rels_media_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.faqId],
			foreignColumns: [faq.id],
			name: "payload_locked_documents_rels_faq_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.quotaUsageLedgerId],
			foreignColumns: [quotaUsageLedger.id],
			name: "payload_locked_documents_rels_quota_usage_ledger_fk"
		}).onDelete("cascade"),
]);

export const apps = pgTable("apps", {
	id: varchar().primaryKey().notNull(),
	name: varchar().notNull(),
	organizationId: varchar("organization_id").notNull(),
	environment: enumAppsEnvironment().default('test').notNull(),
	kind: enumAppsKind().default('basic').notNull(),
	isActive: boolean("is_active").default(true),
	alchemyApiKey: varchar("alchemy_api_key"),
	quickNodeApiKey: varchar("quick_node_api_key"),
	quickNodeAppName: varchar("quick_node_app_name"),
	gelatoApiKey: varchar("gelato_api_key"),
	paymentSettingsAmlEnabled: boolean("payment_settings_aml_enabled").default(false),
	paymentSettingsGoPlusApiKey: varchar("payment_settings_go_plus_api_key"),
	paymentSettingsGoPlusApiSecret: varchar("payment_settings_go_plus_api_secret"),
	paymentSettingsAppInvoiceTemplate: jsonb("payment_settings_app_invoice_template"),
	publicKey: varchar("public_key"),
	secretKey: varchar("secret_key"),
	secretKeyHash: varchar("secret_key_hash"),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	pimlicoApiKey: varchar("pimlico_api_key"),
}, (table) => [
	index("apps_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("apps_environment_idx").using("btree", table.environment.asc().nullsLast().op("enum_ops")),
	index("apps_is_active_idx").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("apps_kind_idx").using("btree", table.kind.asc().nullsLast().op("enum_ops")),
	index("apps_organization_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
	uniqueIndex("apps_public_key_idx").using("btree", table.publicKey.asc().nullsLast().op("text_ops")),
	index("apps_secret_key_hash_idx").using("btree", table.secretKeyHash.asc().nullsLast().op("text_ops")),
	uniqueIndex("apps_secret_key_idx").using("btree", table.secretKey.asc().nullsLast().op("text_ops")),
	index("apps_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "apps_organization_id_organizations_id_fk"
		}).onDelete("set null"),
]);

export const outboxEvents = pgTable("outbox_events", {
	id: serial().primaryKey().notNull(),
	eventType: varchar("event_type").notNull(),
	payload: jsonb().notNull(),
	status: enumOutboxEventsStatus().default('pending').notNull(),
	attempts: numeric().default('0').notNull(),
	nextAttemptAt: timestamp("next_attempt_at", { precision: 3, withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("outbox_events_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("outbox_events_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const media = pgTable("media", {
	id: serial().primaryKey().notNull(),
	alt: varchar().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	url: varchar(),
	thumbnailURL: varchar("thumbnail_u_r_l"),
	filename: varchar(),
	mimeType: varchar("mime_type"),
	filesize: numeric(),
	width: numeric(),
	height: numeric(),
	focalX: numeric("focal_x"),
	focalY: numeric("focal_y"),
}, (table) => [
	index("media_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("media_filename_idx").using("btree", table.filename.asc().nullsLast().op("text_ops")),
	index("media_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const faq = pgTable("faq", {
	id: serial().primaryKey().notNull(),
	question: varchar().notNull(),
	answer: varchar().notNull(),
	order: numeric().default('0'),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("faq_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("faq_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const payloadPreferences = pgTable("payload_preferences", {
	id: serial().primaryKey().notNull(),
	key: varchar(),
	value: jsonb(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("payload_preferences_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("payload_preferences_key_idx").using("btree", table.key.asc().nullsLast().op("text_ops")),
	index("payload_preferences_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const payloadPreferencesRels = pgTable("payload_preferences_rels", {
	id: serial().primaryKey().notNull(),
	order: integer(),
	parentId: integer("parent_id").notNull(),
	path: varchar().notNull(),
	usersId: varchar("users_id"),
}, (table) => [
	index("payload_preferences_rels_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("payload_preferences_rels_parent_idx").using("btree", table.parentId.asc().nullsLast().op("int4_ops")),
	index("payload_preferences_rels_path_idx").using("btree", table.path.asc().nullsLast().op("text_ops")),
	index("payload_preferences_rels_users_id_idx").using("btree", table.usersId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [payloadPreferences.id],
			name: "payload_preferences_rels_parent_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.usersId],
			foreignColumns: [users.id],
			name: "payload_preferences_rels_users_fk"
		}).onDelete("cascade"),
]);

export const systemPricing = pgTable("system_pricing", {
	id: serial().primaryKey().notNull(),
	baseCurrency: enumSystemPricingBaseCurrency("base_currency").default('USD').notNull(),
	costPerQuota: numeric("cost_per_quota").notNull(),
	costPerRPS: numeric("cost_per_r_p_s").notNull(),
	minimumDepositAmount: numeric("minimum_deposit_amount").default('5').notNull(),
	maxDiscountPercentage: numeric("max_discount_percentage").default('15').notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }),
});

export const systemPricingVolumeDiscounts = pgTable("system_pricing_volume_discounts", {
	order: integer("_order").notNull(),
	parentId: integer("_parent_id").notNull(),
	id: varchar().primaryKey().notNull(),
	quotaThreshold: numeric("quota_threshold").notNull(),
	discountPercentage: numeric("discount_percentage").notNull(),
}, (table) => [
	index("system_pricing_volume_discounts_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("system_pricing_volume_discounts_parent_id_idx").using("btree", table.parentId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [systemPricing.id],
			name: "system_pricing_volume_discounts_parent_id_fk"
		}).onDelete("cascade"),
]);

export const systemPricingRels = pgTable("system_pricing_rels", {
	id: serial().primaryKey().notNull(),
	order: integer(),
	parentId: integer("parent_id").notNull(),
	path: varchar().notNull(),
	acceptedPaymentsId: varchar("accepted_payments_id"),
}, (table) => [
	index("system_pricing_rels_accepted_payments_id_idx").using("btree", table.acceptedPaymentsId.asc().nullsLast().op("text_ops")),
	index("system_pricing_rels_order_idx").using("btree", table.order.asc().nullsLast().op("int4_ops")),
	index("system_pricing_rels_parent_idx").using("btree", table.parentId.asc().nullsLast().op("int4_ops")),
	index("system_pricing_rels_path_idx").using("btree", table.path.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.parentId],
			foreignColumns: [systemPricing.id],
			name: "system_pricing_rels_parent_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.acceptedPaymentsId],
			foreignColumns: [acceptedPayments.id],
			name: "system_pricing_rels_accepted_payments_fk"
		}).onDelete("cascade"),
]);

export const invoiceSettings = pgTable("invoice_settings", {
	id: serial().primaryKey().notNull(),
	issuerName: varchar("issuer_name").default('FOP Tkach Oleksandr').notNull(),
	issuerRole: varchar("issuer_role").default('Founder').notNull(),
	signatureImageId: integer("signature_image_id").notNull(),
	pdfTemplate: jsonb("pdf_template").notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }),
}, (table) => [
	index("invoice_settings_signature_image_idx").using("btree", table.signatureImageId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.signatureImageId],
			foreignColumns: [media.id],
			name: "invoice_settings_signature_image_id_media_id_fk"
		}).onDelete("set null"),
]);

export const quotaUsageLedger = pgTable("quota_usage_ledger", {
	id: varchar().primaryKey().notNull(),
	organizationId: varchar("organization_id").notNull(),
	batchId: varchar("batch_id").notNull(),
	amount: numeric().notNull(),
	usageCategory: varchar("usage_category").notNull(),
	sourceWindow: varchar("source_window").notNull(),
	contentDigest: varchar("content_digest").notNull(),
	status: enumQuotaUsageLedgerStatus().default('applied').notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("quota_usage_ledger_batch_id_idx").using("btree", table.batchId.asc().nullsLast().op("text_ops")),
	index("quota_usage_ledger_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("quota_usage_ledger_organization_idx").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
	index("quota_usage_ledger_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("quota_usage_ledger_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "quota_usage_ledger_organization_id_organizations_id_fk"
		}).onDelete("set null"),
]);

export const transactions = pgTable("transactions", {
	id: serial().notNull(),
	ownerId: varchar("owner_id").notNull(),
	appId: varchar("app_id"),
	appName: varchar("app_name").default('Web3 App').notNull(),
	txKey: varchar("tx_key").notNull(),
	chainId: varchar("chain_id").notNull(),
	from: varchar().notNull(),
	type: varchar().notNull(),
	connectorType: varchar("connector_type").notNull(),
	adapter: enumTransactionsAdapter().notNull(),
	tracker: enumTransactionsTracker().notNull(),
	status: enumTransactionsStatus(),
	pending: boolean().default(true).notNull(),
	isError: boolean("is_error").default(false),
	localTimestamp: numeric("local_timestamp").notNull(),
	finishedTimestamp: numeric("finished_timestamp"),
	title: jsonb(),
	description: jsonb(),
	error: jsonb(),
	payload: jsonb(),
	confirmations: varchar(),
	requiredConfirmations: numeric("required_confirmations"),
	rpcUrl: varchar("rpc_url"),
	hash: varchar(),
	to: varchar(),
	value: varchar(),
	input: varchar(),
	nonce: numeric(),
	maxFeePerGas: varchar("max_fee_per_gas"),
	maxPriorityFeePerGas: varchar("max_priority_fee_per_gas"),
	replacedTxHash: varchar("replaced_tx_hash"),
	bundlerUrl: varchar("bundler_url"),
	pimlicoApiKey: varchar("pimlico_api_key"),
	fee: numeric(),
	slot: numeric(),
	recentBlockhash: varchar("recent_blockhash"),
	instructions: jsonb(),
	actualFee: jsonb("actual_fee"),
	contractAddress: varchar("contract_address"),
	appInvoiceId: varchar("app_invoice_id_id"),
	amlStatus: varchar("aml_status").default('not_applicable'),
	amlRiskScore: numeric("aml_risk_score"),
	amlProviderData: jsonb("aml_provider_data"),
	syncStatus: enumTransactionsSyncStatus("sync_status").default('synced'),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.id, table.createdAt] }),
	index("transactions_owner_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops")),
	index("transactions_app_idx").using("btree", table.appId.asc().nullsLast().op("text_ops")),
	index("transactions_app_name_idx").using("btree", table.appName.asc().nullsLast().op("text_ops")),
	uniqueIndex("transactions_tx_key_idx").using("btree", table.txKey.asc().nullsLast().op("text_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("transactions_chain_id_idx").using("btree", table.chainId.asc().nullsLast().op("text_ops")),
	index("transactions_from_idx").using("btree", table.from.asc().nullsLast().op("text_ops")),
	index("transactions_adapter_idx").using("btree", table.adapter.asc().nullsLast().op("enum_ops")),
	index("transactions_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("transactions_sync_status_idx").using("btree", table.syncStatus.asc().nullsLast().op("enum_ops")),
	index("transactions_local_timestamp_idx").using("btree", table.localTimestamp.asc().nullsLast().op("numeric_ops")),
	index("transactions_hash_idx").using("btree", table.hash.asc().nullsLast().op("text_ops")),
	index("transactions_to_idx").using("btree", table.to.asc().nullsLast().op("text_ops")),
	index("transactions_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	index("transactions_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("transactions_app_invoice_id_idx").using("btree", table.appInvoiceId.asc().nullsLast().op("text_ops")),
	index("transactions_aml_status_idx").using("btree", table.amlStatus.asc().nullsLast().op("text_ops")),
]);

export const webhookDeliveries = pgTable("webhook_deliveries", {
	id: varchar().notNull(),
	endpointId: varchar("endpoint_id").notNull(),
	eventType: varchar("event_type").notNull(),
	txKey: varchar("tx_key").notNull(),
	httpStatus: numeric("http_status"),
	success: boolean().default(false).notNull(),
	requestPayload: jsonb("request_payload"),
	responseBody: varchar("response_body"),
	executionTimeMs: numeric("execution_time_ms"),
	attempts: numeric("attempts"),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.id, table.createdAt] }),
	index("webhook_deliveries_endpoint_idx").using("btree", table.endpointId.asc().nullsLast().op("text_ops")),
	index("webhook_deliveries_event_type_idx").using("btree", table.eventType.asc().nullsLast().op("text_ops")),
	index("webhook_deliveries_tx_key_idx").using("btree", table.txKey.asc().nullsLast().op("text_ops")),
	index("webhook_deliveries_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
	index("webhook_deliveries_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
]);
