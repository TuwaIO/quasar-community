import type { Payload } from 'payload';

import type { User } from '@/payload-types';

import { CloudTransferError } from '../errors';
import type { TransactionRecord, WebhookDeliveryRecord } from '../records';
import { readExport } from '../stream';
import { type ImportPlan, planImport } from './plan';
import { readConfig } from './read';
import { checkOutboundUrl, loadExistingState } from './state';
import { queuePending, writeConfig, writeDeliveries, writeTransactions } from './write';

/**
 * The two passes of a Cloud import (open-source-plans/11 §7): `analyzeExport` reads the whole file and returns the
 * plan without writing; `applyExport` writes it. Both read the file as it streams in.
 */

const BATCH_SIZE = 1000;

export interface ImportReport {
  plan: ImportPlan;
  transactions: { inserted: number; updated: number; unchanged: number };
  /** `skipped`: deliveries of webhook endpoints this node did not import */
  deliveries: { inserted: number; unchanged: number; skipped: number };
  /** Transactions that were pending in Cloud and are now tracked by this node */
  queued: number;
}

export type ImportEvent =
  | { type: 'plan'; plan: ImportPlan }
  | { type: 'progress'; transactions: number; deliveries: number }
  | { type: 'done'; report: ImportReport };

export class ImportConflictError extends Error {
  constructor(readonly conflicts: string[]) {
    super(conflicts.join(' '));
    this.name = 'ImportConflictError';
  }
}

const env = () => ({ production: process.env.NODE_ENV === 'production' });

async function plan(payload: Payload, body: ReadableStream<Uint8Array>, key: Uint8Array) {
  const records = readExport(body, key);
  const { config, next } = await readConfig(records);
  const importPlan = await planImport(config, await loadExistingState(payload, config), checkOutboundUrl, env());
  return { records, config, next, plan: importPlan };
}

/** Reads and checks the whole export; writes nothing. */
export async function analyzeExport(payload: Payload, body: ReadableStream<Uint8Array>, key: Uint8Array) {
  const { records, next, plan: importPlan } = await plan(payload, body, key);
  // Reading to the end checks every frame, record and count, so the import does not stop half way
  if (next.t !== 'end') for await (const record of records) if (record.t === 'end') break;
  return importPlan;
}

/**
 * Imports the export. Stops before writing when the plan has conflicts. A failure part way leaves what was written
 * so far; running the import again finishes it, because every write is keyed by id.
 */
export async function* applyExport(
  payload: Payload,
  admin: User,
  body: ReadableStream<Uint8Array>,
  key: Uint8Array,
): AsyncGenerator<ImportEvent> {
  const { records, config, next, plan: importPlan } = await plan(payload, body, key);
  if (importPlan.conflicts.length) throw new ImportConflictError(importPlan.conflicts);

  await writeConfig(payload, admin, config, importPlan);
  const importedEndpoints = new Set(
    importPlan.endpoints.filter((endpoint) => endpoint.action !== 'skip').map((endpoint) => endpoint.id),
  );
  yield { type: 'plan', plan: importPlan };

  const db = payload.db.drizzle;
  const ensured = new Set<string>();
  const report: ImportReport = {
    plan: importPlan,
    transactions: { inserted: 0, updated: 0, unchanged: 0 },
    deliveries: { inserted: 0, unchanged: 0, skipped: 0 },
    queued: 0,
  };
  let transactionBatch: TransactionRecord[] = [];
  let deliveryBatch: WebhookDeliveryRecord[] = [];
  let pending: { app: string | null; owner: string; txKey: string }[] = [];
  const progress = (): ImportEvent => ({
    type: 'progress',
    transactions: report.transactions.inserted + report.transactions.updated + report.transactions.unchanged,
    deliveries: report.deliveries.inserted + report.deliveries.unchanged + report.deliveries.skipped,
  });

  const flushTransactions = async () => {
    if (!transactionBatch.length) return;
    const result = await writeTransactions(db, transactionBatch, ensured);
    report.transactions.inserted += result.inserted;
    report.transactions.updated += result.updated;
    report.transactions.unchanged += result.unchanged;
    pending = pending.concat(result.pending);
    transactionBatch = [];
  };
  const flushDeliveries = async () => {
    if (!deliveryBatch.length) return;
    const result = await writeDeliveries(db, deliveryBatch, ensured);
    report.deliveries.inserted += result.inserted;
    report.deliveries.unchanged += result.unchanged;
    deliveryBatch = [];
  };

  let record = next;
  for (;;) {
    if (record.t === 'transaction') {
      transactionBatch.push(record.v);
      if (transactionBatch.length >= BATCH_SIZE) {
        await flushTransactions();
        yield progress();
      }
    } else if (record.t === 'webhookDelivery') {
      await flushTransactions();
      // A delivery must point at an endpoint of this node (foreign key); those of skipped endpoints are left out
      if (importedEndpoints.has(record.v.endpoint)) deliveryBatch.push(record.v);
      else report.deliveries.skipped += 1;
      if (deliveryBatch.length >= BATCH_SIZE) {
        await flushDeliveries();
        yield progress();
      }
    } else if (record.t === 'end') {
      break;
    }
    const step = await records.next();
    if (step.done) throw new CloudTransferError('corrupt', 'The export is incomplete: it ends before its last record.');
    record = step.value;
  }
  await flushTransactions();
  await flushDeliveries();
  yield progress();

  await queuePending(pending);
  report.queued = pending.length;
  yield { type: 'done', report };
}
