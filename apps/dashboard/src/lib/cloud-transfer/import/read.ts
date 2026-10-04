import { CloudTransferError } from '../errors';
import type {
  AppAcceptedPaymentRecord,
  AppInvoiceRecord,
  AppRecord,
  ExportRecord,
  ManifestRecord,
  OrganizationRecord,
  WebhookEndpointRecord,
} from '../records';

/** The records an import plans from: everything before the transactions. Small enough to hold in memory. */
export interface ConfigRecords {
  manifest: ManifestRecord;
  organization: OrganizationRecord;
  apps: AppRecord[];
  acceptedPayments: AppAcceptedPaymentRecord[];
  endpoints: WebhookEndpointRecord[];
  invoices: AppInvoiceRecord[];
}

/**
 * Reads the configuration records from the start of an export. Returns them with the first record after them (a
 * transaction, a delivery or the end record); the rest stays in `records`.
 */
export async function readConfig(
  records: AsyncIterator<ExportRecord>,
): Promise<{ config: ConfigRecords; next: ExportRecord }> {
  let manifest: ManifestRecord | undefined;
  let organization: OrganizationRecord | undefined;
  const config = { apps: [], acceptedPayments: [], endpoints: [], invoices: [] } as Omit<
    ConfigRecords,
    'manifest' | 'organization'
  >;

  for (;;) {
    const { value: record, done } = await records.next();
    if (done) throw new CloudTransferError('corrupt', 'The export is incomplete: it ends before its last record.');
    switch (record.t) {
      case 'manifest':
        manifest = record.v;
        break;
      case 'organization':
        organization = record.v;
        break;
      case 'app':
        config.apps.push(record.v);
        break;
      case 'appAcceptedPayment':
        config.acceptedPayments.push(record.v);
        break;
      case 'webhookEndpoint':
        config.endpoints.push(record.v);
        break;
      case 'appInvoice':
        config.invoices.push(record.v);
        break;
      default:
        // readExport guarantees the manifest and the organization come first
        return { config: { manifest: manifest!, organization: organization!, ...config }, next: record };
    }
  }
}
