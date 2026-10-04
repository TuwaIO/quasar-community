import { z } from 'zod';

import {
  enum_app_invoices_currency,
  enum_app_invoices_status,
  enum_transactions_adapter,
  enum_transactions_aml_status,
  enum_transactions_status,
  enum_transactions_sync_status,
  enum_transactions_tracker,
  enum_webhook_endpoints_events,
} from '@/payload-generated-schema';

/**
 * The records of a Quasar export, one per NDJSON line: `{ "t": <type>, "v": <value> }`. Field names are those of the
 * Payload collections (organization, app, webhook endpoint) or of the generated Drizzle tables (the rest), so the
 * importer writes them without renaming. Secrets are in plain text: the envelope encrypts the whole file.
 *
 * Unknown fields are dropped, so a newer Cloud can add optional ones without a new format version
 * (open-source-plans/11-cloud-to-community-migration.md §5.5).
 */

/** Record types in the order an export lists them */
export const RECORD_ORDER = [
  'manifest',
  'organization',
  'app',
  'appAcceptedPayment',
  'webhookEndpoint',
  'appInvoice',
  'transaction',
  'webhookDelivery',
  'end',
] as const;

export type RecordType = (typeof RECORD_ORDER)[number];

/** Record types that can repeat, with a count in the manifest and the end record */
export const COUNTED_TYPES = [
  'app',
  'appAcceptedPayment',
  'webhookEndpoint',
  'appInvoice',
  'transaction',
  'webhookDelivery',
] as const;

export type CountedType = (typeof COUNTED_TYPES)[number];

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().max(max);
const optionalText = (max: number) => z.string().max(max).nullable().optional();
const timestamp = z
  .string()
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'not a date')
  .transform((value) => new Date(value).toISOString());
const optionalTimestamp = timestamp.nullable().optional();
const number = z.number().finite();
const json = z.unknown();

const countsSchema = z.object(
  Object.fromEntries(COUNTED_TYPES.map((type) => [type, z.number().int().min(0)])) as Record<CountedType, z.ZodNumber>,
);

export const manifestSchema = z.object({
  source: z.literal('quasar-cloud'),
  exportedAt: timestamp,
  /** Newest Payload migration of the Cloud database that produced the export */
  schemaMigration: text(200),
  organization: z.object({ id, name: text(255) }),
  /** Webhook deliveries are exported from this moment on */
  deliveriesSince: timestamp,
  /** Members of the organization in Cloud; they are not exported */
  members: z.number().int().min(0),
  counts: countsSchema,
});

export const organizationSchema = z.object({
  id,
  name: text(255).min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const appSchema = z.object({
  id,
  name: text(255).min(1),
  organization: id,
  isActive: z.boolean().nullable().optional(),
  environment: z.enum(['live', 'test']),
  kind: z.enum(['basic', 'payments']),
  publicKey: z.string().regex(/^pk_/).max(200).nullable().optional(),
  secretKey: z.string().regex(/^sk_/).max(200).nullable().optional(),
  ipWhitelist: z
    .array(z.object({ ip: text(64).min(1) }))
    .max(500)
    .nullable()
    .optional(),
  domainsWhitelist: z
    .array(z.object({ domain: text(255).min(1) }))
    .max(500)
    .nullable()
    .optional(),
  rpcConfigs: z
    .array(z.object({ chainId: text(100).min(1), rpcUrl: text(2048).min(1) }))
    .max(500)
    .nullable()
    .optional(),
  alchemyApiKey: optionalText(1024),
  quickNodeApiKey: optionalText(2048),
  quickNodeAppName: optionalText(255),
  gelatoApiKey: optionalText(1024),
  pimlicoApiKey: optionalText(1024),
  paymentSettings: z
    .object({
      amlEnabled: z.boolean().nullable().optional(),
      goPlusApiKey: optionalText(1024),
      goPlusApiSecret: optionalText(1024),
      appInvoiceTemplate: json,
    })
    .partial()
    .nullable()
    .optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const appAcceptedPaymentSchema = z.object({
  id,
  app: id,
  organization: id,
  name: text(255),
  walletAddressToReceivePayment: text(255),
  tokenAddress: text(255),
  chainId: number,
  symbol: text(64),
  decimals: number,
  markup: number.nullable().optional(),
  discount: number.nullable().optional(),
  priceFeedAddress: text(255),
  isActive: z.boolean().nullable().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const webhookEndpointSchema = z.object({
  id,
  app: id,
  url: text(2048).min(1),
  signingSecret: text(1024).min(1),
  events: z.array(z.enum(enum_webhook_endpoints_events.enumValues)).min(1).max(10),
  description: optionalText(2000),
  txType: text(255),
  isActive: z.boolean().nullable().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const appInvoiceSchema = z.object({
  id,
  app: id,
  organization: id,
  status: z.enum(enum_app_invoices_status.enumValues),
  baseAmount: number,
  totalAmount: number,
  currency: z.enum(enum_app_invoices_currency.enumValues),
  cryptoAmountExpected: text(100),
  acceptedPayment: id,
  txHash: optionalText(255),
  originWallet: optionalText(255),
  metadata: json,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const transactionSchema = z.object({
  owner: id,
  app: id.nullable(),
  appName: text(255),
  txKey: text(255).min(1),
  chainId: text(100).min(1),
  from: text(255),
  type: text(255),
  connectorType: text(255),
  adapter: z.enum(enum_transactions_adapter.enumValues),
  tracker: z.enum(enum_transactions_tracker.enumValues),
  status: z.enum(enum_transactions_status.enumValues).nullable(),
  syncStatus: z.enum(enum_transactions_sync_status.enumValues).nullable(),
  pending: z.boolean(),
  isError: z.boolean().nullable(),
  localTimestamp: number,
  finishedTimestamp: number.nullable(),
  title: json,
  description: json,
  error: json,
  payload: json,
  confirmations: optionalText(100),
  requiredConfirmations: number.nullable(),
  rpcUrl: optionalText(2048),
  appInvoiceId: id.nullable(),
  amlStatus: z.enum(enum_transactions_aml_status.enumValues).nullable(),
  amlRiskScore: number.nullable(),
  amlProviderData: json,
  hash: optionalText(255),
  to: optionalText(255),
  value: optionalText(255),
  input: z.string().max(1_000_000).nullable().optional(),
  nonce: number.nullable(),
  maxFeePerGas: optionalText(100),
  maxPriorityFeePerGas: optionalText(100),
  replacedTxHash: optionalText(255),
  bundlerUrl: optionalText(2048),
  pimlicoApiKey: optionalText(1024),
  fee: number.nullable(),
  slot: number.nullable(),
  recentBlockhash: optionalText(255),
  instructions: json,
  actualFee: json,
  contractAddress: optionalText(255),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const webhookDeliverySchema = z.object({
  id,
  endpoint: id,
  eventType: text(255),
  txKey: text(255),
  httpStatus: number.nullable(),
  success: z.boolean(),
  requestPayload: json,
  responseBody: z.string().max(1_000_000).nullable().optional(),
  executionTimeMs: number.nullable(),
  attempts: number.nullable(),
  createdAt: timestamp,
  updatedAt: optionalTimestamp,
});

export const endSchema = z.object({ counts: countsSchema });

export const RECORD_SCHEMAS = {
  manifest: manifestSchema,
  organization: organizationSchema,
  app: appSchema,
  appAcceptedPayment: appAcceptedPaymentSchema,
  webhookEndpoint: webhookEndpointSchema,
  appInvoice: appInvoiceSchema,
  transaction: transactionSchema,
  webhookDelivery: webhookDeliverySchema,
  end: endSchema,
} as const;

export type ManifestRecord = z.output<typeof manifestSchema>;
export type OrganizationRecord = z.output<typeof organizationSchema>;
export type AppRecord = z.output<typeof appSchema>;
export type AppAcceptedPaymentRecord = z.output<typeof appAcceptedPaymentSchema>;
export type WebhookEndpointRecord = z.output<typeof webhookEndpointSchema>;
export type AppInvoiceRecord = z.output<typeof appInvoiceSchema>;
export type TransactionRecord = z.output<typeof transactionSchema>;
export type WebhookDeliveryRecord = z.output<typeof webhookDeliverySchema>;
export type ExportCounts = z.output<typeof countsSchema>;

export type ExportRecord = {
  [Type in RecordType]: { t: Type; v: z.output<(typeof RECORD_SCHEMAS)[Type]> };
}[RecordType];

/** The value a writer passes for a record type: timestamps in any form `Date` parses */
export type RecordInput<Type extends RecordType> = z.input<(typeof RECORD_SCHEMAS)[Type]>;

/** What a writer passes in: the same shapes, timestamps in any form `Date` parses */
export type ExportRecordInput = {
  [Type in RecordType]: { t: Type; v: z.input<(typeof RECORD_SCHEMAS)[Type]> };
}[RecordType];
