import { relations } from "drizzle-orm/relations";
import { apps, webhookEndpoints, users, usersRoles, usersSessions, appInvoices, organizations, appAcceptedPayments, appsIpWhitelist, appsDomainsWhitelist, appsRpcConfigs, invoices, billingPlans, acceptedPayments, passkeys, passkeysTexts, connectedWallets, organizationMembers, organizationBillingProfiles, webhookEndpointsEvents, billingPlansFeatures, billingHistory, payloadLockedDocuments, payloadLockedDocumentsRels, deletedAccounts, deletedOrganizations, deletedOrganizationMembers, outboxEvents, media, faq, quotaUsageLedger, payloadPreferences, payloadPreferencesRels, systemPricing, systemPricingVolumeDiscounts, systemPricingRels, invoiceSettings, transactions, webhookDeliveries } from "./schema";

export const webhookEndpointsRelations = relations(webhookEndpoints, ({one, many}) => ({app: one(apps, {
		fields: [webhookEndpoints.appId],
		references: [apps.id]
	}),
	webhookEndpointsEvents: many(webhookEndpointsEvents),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
	webhookDeliveries: many(webhookDeliveries),
}));

export const appsRelations = relations(apps, ({one, many}) => ({webhookEndpoints: many(webhookEndpoints),
	appInvoices: many(appInvoices),
	appsIpWhitelists: many(appsIpWhitelist),
	appsDomainsWhitelists: many(appsDomainsWhitelist),
	appsRpcConfigs: many(appsRpcConfigs),
	appAcceptedPayments: many(appAcceptedPayments),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
	organization: one(organizations, {
		fields: [apps.organizationId],
		references: [organizations.id]
	}),
	transactions: many(transactions),
}));

export const usersRolesRelations = relations(usersRoles, ({one}) => ({
	user: one(users, {
		fields: [usersRoles.parentId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	usersRoles: many(usersRoles),
	usersSessions: many(usersSessions),
	passkeys: many(passkeys),
	connectedWallets: many(connectedWallets),
	organizationMembers: many(organizationMembers),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
	payloadPreferencesRels: many(payloadPreferencesRels),
}));

export const usersSessionsRelations = relations(usersSessions, ({one}) => ({
	user: one(users, {
		fields: [usersSessions.parentId],
		references: [users.id]
	}),
}));

export const appInvoicesRelations = relations(appInvoices, ({one, many}) => ({
	app: one(apps, {
		fields: [appInvoices.appId],
		references: [apps.id]
	}),
	organization: one(organizations, {
		fields: [appInvoices.organizationId],
		references: [organizations.id]
	}),
	appAcceptedPayment: one(appAcceptedPayments, {
		fields: [appInvoices.acceptedPaymentId],
		references: [appAcceptedPayments.id]
	}),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const organizationsRelations = relations(organizations, ({many}) => ({
	appInvoices: many(appInvoices),
	invoices: many(invoices),
	organizationMembers: many(organizationMembers),
	organizationBillingProfiles: many(organizationBillingProfiles),
	appAcceptedPayments: many(appAcceptedPayments),
	billingHistories: many(billingHistory),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
	apps: many(apps),
	quotaUsageLedgers: many(quotaUsageLedger),
}));

export const appAcceptedPaymentsRelations = relations(appAcceptedPayments, ({one, many}) => ({
	appInvoices: many(appInvoices),
	app: one(apps, {
		fields: [appAcceptedPayments.appId],
		references: [apps.id]
	}),
	organization: one(organizations, {
		fields: [appAcceptedPayments.organizationId],
		references: [organizations.id]
	}),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const appsIpWhitelistRelations = relations(appsIpWhitelist, ({one}) => ({
	app: one(apps, {
		fields: [appsIpWhitelist.parentId],
		references: [apps.id]
	}),
}));

export const appsDomainsWhitelistRelations = relations(appsDomainsWhitelist, ({one}) => ({
	app: one(apps, {
		fields: [appsDomainsWhitelist.parentId],
		references: [apps.id]
	}),
}));

export const appsRpcConfigsRelations = relations(appsRpcConfigs, ({one}) => ({
	app: one(apps, {
		fields: [appsRpcConfigs.parentId],
		references: [apps.id]
	}),
}));

export const invoicesRelations = relations(invoices, ({one, many}) => ({
	organization: one(organizations, {
		fields: [invoices.organizationId],
		references: [organizations.id]
	}),
	billingPlan: one(billingPlans, {
		fields: [invoices.planId],
		references: [billingPlans.id]
	}),
	acceptedPayment: one(acceptedPayments, {
		fields: [invoices.acceptedPaymentId],
		references: [acceptedPayments.id]
	}),
	billingHistories: many(billingHistory),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const billingPlansRelations = relations(billingPlans, ({many}) => ({
	invoices: many(invoices),
	billingPlansFeatures: many(billingPlansFeatures),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const acceptedPaymentsRelations = relations(acceptedPayments, ({many}) => ({
	invoices: many(invoices),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
	systemPricingRels: many(systemPricingRels),
}));

export const passkeysRelations = relations(passkeys, ({one, many}) => ({
	user: one(users, {
		fields: [passkeys.userId],
		references: [users.id]
	}),
	passkeysTexts: many(passkeysTexts),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const passkeysTextsRelations = relations(passkeysTexts, ({one}) => ({
	passkey: one(passkeys, {
		fields: [passkeysTexts.parentId],
		references: [passkeys.id]
	}),
}));

export const connectedWalletsRelations = relations(connectedWallets, ({one, many}) => ({
	user: one(users, {
		fields: [connectedWallets.userId],
		references: [users.id]
	}),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const organizationMembersRelations = relations(organizationMembers, ({one, many}) => ({
	organization: one(organizations, {
		fields: [organizationMembers.organizationId],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [organizationMembers.userId],
		references: [users.id]
	}),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const organizationBillingProfilesRelations = relations(organizationBillingProfiles, ({one, many}) => ({
	organization: one(organizations, {
		fields: [organizationBillingProfiles.organizationId],
		references: [organizations.id]
	}),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const webhookEndpointsEventsRelations = relations(webhookEndpointsEvents, ({one}) => ({
	webhookEndpoint: one(webhookEndpoints, {
		fields: [webhookEndpointsEvents.parentId],
		references: [webhookEndpoints.id]
	}),
}));

export const billingPlansFeaturesRelations = relations(billingPlansFeatures, ({one}) => ({
	billingPlan: one(billingPlans, {
		fields: [billingPlansFeatures.parentId],
		references: [billingPlans.id]
	}),
}));

export const billingHistoryRelations = relations(billingHistory, ({one, many}) => ({
	organization: one(organizations, {
		fields: [billingHistory.organizationId],
		references: [organizations.id]
	}),
	invoice: one(invoices, {
		fields: [billingHistory.invoiceId],
		references: [invoices.id]
	}),
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const payloadLockedDocumentsRelsRelations = relations(payloadLockedDocumentsRels, ({one}) => ({
	payloadLockedDocument: one(payloadLockedDocuments, {
		fields: [payloadLockedDocumentsRels.parentId],
		references: [payloadLockedDocuments.id]
	}),
	user: one(users, {
		fields: [payloadLockedDocumentsRels.usersId],
		references: [users.id]
	}),
	app: one(apps, {
		fields: [payloadLockedDocumentsRels.appsId],
		references: [apps.id]
	}),
	billingHistory: one(billingHistory, {
		fields: [payloadLockedDocumentsRels.billingHistoryId],
		references: [billingHistory.id]
	}),
	passkey: one(passkeys, {
		fields: [payloadLockedDocumentsRels.passkeysId],
		references: [passkeys.id]
	}),
	connectedWallet: one(connectedWallets, {
		fields: [payloadLockedDocumentsRels.connectedWalletsId],
		references: [connectedWallets.id]
	}),
	organization: one(organizations, {
		fields: [payloadLockedDocumentsRels.organizationsId],
		references: [organizations.id]
	}),
	organizationMember: one(organizationMembers, {
		fields: [payloadLockedDocumentsRels.organizationMembersId],
		references: [organizationMembers.id]
	}),
	organizationBillingProfile: one(organizationBillingProfiles, {
		fields: [payloadLockedDocumentsRels.organizationBillingProfilesId],
		references: [organizationBillingProfiles.id]
	}),
	deletedAccount: one(deletedAccounts, {
		fields: [payloadLockedDocumentsRels.deletedAccountsId],
		references: [deletedAccounts.id]
	}),
	deletedOrganization: one(deletedOrganizations, {
		fields: [payloadLockedDocumentsRels.deletedOrganizationsId],
		references: [deletedOrganizations.id]
	}),
	deletedOrganizationMember: one(deletedOrganizationMembers, {
		fields: [payloadLockedDocumentsRels.deletedOrganizationMembersId],
		references: [deletedOrganizationMembers.id]
	}),
	webhookEndpoint: one(webhookEndpoints, {
		fields: [payloadLockedDocumentsRels.webhookEndpointsId],
		references: [webhookEndpoints.id]
	}),
	acceptedPayment: one(acceptedPayments, {
		fields: [payloadLockedDocumentsRels.acceptedPaymentsId],
		references: [acceptedPayments.id]
	}),
	billingPlan: one(billingPlans, {
		fields: [payloadLockedDocumentsRels.billingPlansId],
		references: [billingPlans.id]
	}),
	invoice: one(invoices, {
		fields: [payloadLockedDocumentsRels.invoicesId],
		references: [invoices.id]
	}),
	outboxEvent: one(outboxEvents, {
		fields: [payloadLockedDocumentsRels.outboxEventsId],
		references: [outboxEvents.id]
	}),
	appAcceptedPayment: one(appAcceptedPayments, {
		fields: [payloadLockedDocumentsRels.appAcceptedPaymentsId],
		references: [appAcceptedPayments.id]
	}),
	appInvoice: one(appInvoices, {
		fields: [payloadLockedDocumentsRels.appInvoicesId],
		references: [appInvoices.id]
	}),
	media: one(media, {
		fields: [payloadLockedDocumentsRels.mediaId],
		references: [media.id]
	}),
	faq: one(faq, {
		fields: [payloadLockedDocumentsRels.faqId],
		references: [faq.id]
	}),
	quotaUsageLedger: one(quotaUsageLedger, {
		fields: [payloadLockedDocumentsRels.quotaUsageLedgerId],
		references: [quotaUsageLedger.id]
	}),
}));

export const payloadLockedDocumentsRelations = relations(payloadLockedDocuments, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const deletedAccountsRelations = relations(deletedAccounts, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const deletedOrganizationsRelations = relations(deletedOrganizations, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const deletedOrganizationMembersRelations = relations(deletedOrganizationMembers, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const outboxEventsRelations = relations(outboxEvents, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const mediaRelations = relations(media, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
	invoiceSettings: many(invoiceSettings),
}));

export const faqRelations = relations(faq, ({many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
}));

export const quotaUsageLedgerRelations = relations(quotaUsageLedger, ({one, many}) => ({
	payloadLockedDocumentsRels: many(payloadLockedDocumentsRels),
	organization: one(organizations, {
		fields: [quotaUsageLedger.organizationId],
		references: [organizations.id]
	}),
}));

export const payloadPreferencesRelsRelations = relations(payloadPreferencesRels, ({one}) => ({
	payloadPreference: one(payloadPreferences, {
		fields: [payloadPreferencesRels.parentId],
		references: [payloadPreferences.id]
	}),
	user: one(users, {
		fields: [payloadPreferencesRels.usersId],
		references: [users.id]
	}),
}));

export const payloadPreferencesRelations = relations(payloadPreferences, ({many}) => ({
	payloadPreferencesRels: many(payloadPreferencesRels),
}));

export const systemPricingVolumeDiscountsRelations = relations(systemPricingVolumeDiscounts, ({one}) => ({
	systemPricing: one(systemPricing, {
		fields: [systemPricingVolumeDiscounts.parentId],
		references: [systemPricing.id]
	}),
}));

export const systemPricingRelations = relations(systemPricing, ({many}) => ({
	systemPricingVolumeDiscounts: many(systemPricingVolumeDiscounts),
	systemPricingRels: many(systemPricingRels),
}));

export const systemPricingRelsRelations = relations(systemPricingRels, ({one}) => ({
	systemPricing: one(systemPricing, {
		fields: [systemPricingRels.parentId],
		references: [systemPricing.id]
	}),
	acceptedPayment: one(acceptedPayments, {
		fields: [systemPricingRels.acceptedPaymentsId],
		references: [acceptedPayments.id]
	}),
}));

export const invoiceSettingsRelations = relations(invoiceSettings, ({one}) => ({
	media: one(media, {
		fields: [invoiceSettings.signatureImageId],
		references: [media.id]
	}),
}));

export const transactionsRelations = relations(transactions, ({one, many}) => ({
	app: one(apps, {
		fields: [transactions.appId],
		references: [apps.id]
	}),
	appInvoice: one(appInvoices, {
		fields: [transactions.appInvoiceId],
		references: [appInvoices.id]
	}),
	webhookDeliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({one}) => ({
	webhookEndpoint: one(webhookEndpoints, {
		fields: [webhookDeliveries.endpointId],
		references: [webhookEndpoints.id]
	}),
	transaction: one(transactions, {
		fields: [webhookDeliveries.txKey],
		references: [transactions.txKey]
	}),
}));
