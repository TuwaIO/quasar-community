import { DeletedAccounts } from '@/collections/ContextAudit/DeletedAccounts';
import { DeletedOrganizationMembers } from '@/collections/ContextAudit/DeletedOrganizationMembers';
import { DeletedOrganizations } from '@/collections/ContextAudit/DeletedOrganizations';
import { QuotaUsageLedger } from '@/collections/ContextBilling/QuotaUsageLedger';
import { Apps } from '@/collections/ContextEngine/Apps';
import { OutboxEvents } from '@/collections/ContextEngine/OutboxEvents';
import { OrganizationMembers } from '@/collections/ContextOrganizations/OrganizationMembers';
import { Organizations } from '@/collections/ContextOrganizations/Organizations';
import { AppAcceptedPayments } from '@/collections/ContextPayments/AppAcceptedPayments';
import { AppInvoices } from '@/collections/ContextPayments/AppInvoices';
import { Transactions } from '@/collections/ContextTransactions/Transactions';
import { Users } from '@/collections/ContextUsers/Users';
import { WebhookDeliveries } from '@/collections/ContextWebhooks/WebhookDeliveries';
import { WebhookEndpoints } from '@/collections/ContextWebhooks/WebhookEndpoints';

export const collections = [
  Users,
  Transactions,
  Apps,
  QuotaUsageLedger,
  Organizations,
  OrganizationMembers,
  DeletedAccounts,
  DeletedOrganizations,
  DeletedOrganizationMembers,
  WebhookEndpoints,
  WebhookDeliveries,
  OutboxEvents,
  AppAcceptedPayments,
  AppInvoices,
];
