import { getSolanaChainId } from '@tuwaio/sdk/orbit';
import { encrypt } from '@tuwaio/shared/encryption';
import { createPartitionSql, monthlyPartition, type PartitionedTable } from '@tuwaio/shared/partitions';
import { inArray, sql } from 'drizzle-orm';
import type { Payload } from 'payload';

import { QUEUE_FAST } from '@/../constants';
import {
  COMMUNITY_WORKSPACE_QUOTA_BALANCE,
  COMMUNITY_WORKSPACE_RPS_FOREVER,
  COMMUNITY_WORKSPACE_RPS_LIMIT,
} from '@/constants/community';
import { getQueue, invalidateOrganizationAppMetadata } from '@/lib/redis';
import { app_accepted_payments, app_invoices, transactions, webhook_deliveries } from '@/payload-generated-schema';
import type { App, User } from '@/payload-types';

import type { TransactionRecord, WebhookDeliveryRecord } from '../records';
import type { ImportPlan } from './plan';
import type { ConfigRecords } from './read';

type Db = Payload['db']['drizzle'];

/** Payload writes run as the system, not as a user: SaaS owner limits do not apply to an import. */
const SYSTEM = { overrideAccess: true, context: { skipAuthCheck: true, cloudImport: true } } as const;

/** A record without its timestamps: Payload sets them on the rows it creates */
function withoutTimestamps<T extends { createdAt: string; updatedAt?: string | null }>(
  record: T,
): Omit<T, 'createdAt' | 'updatedAt'> {
  const fields: Partial<T> = { ...record };
  delete fields.createdAt;
  delete fields.updatedAt;
  return fields as Omit<T, 'createdAt' | 'updatedAt'>;
}

/**
 * Writes the organization, its apps, Payments App rows and webhook endpoints. Organization, apps and endpoints go
 * through Payload, so their hooks encrypt the secrets with this node's key, hash the secret keys and validate the
 * fields; rows the plan keeps are not touched. An endpoint Payload refuses is skipped and its reason added to the
 * plan.
 */
export async function writeConfig(payload: Payload, admin: User, config: ConfigRecords, plan: ImportPlan) {
  const orgId = config.organization.id;

  if (plan.organization.mode === 'new') {
    await payload.create({
      collection: 'organizations',
      data: {
        id: orgId,
        name: config.organization.name,
        slug: plan.organization.slug,
        createdBy: admin.id,
        quotaBalance: COMMUNITY_WORKSPACE_QUOTA_BALANCE,
        rpsLimit: COMMUNITY_WORKSPACE_RPS_LIMIT,
        rpsPaidLimit: COMMUNITY_WORKSPACE_RPS_LIMIT,
        rpsForever: COMMUNITY_WORKSPACE_RPS_FOREVER,
        quotaUsed: 0,
      },
      ...SYSTEM,
    });
    await payload.create({
      collection: 'organization-members',
      data: { organization: orgId, user: admin.id, role: 'owner' },
      ...SYSTEM,
    });
  }

  for (const app of config.apps) {
    const planned = plan.apps.find((item) => item.id === app.id);
    if (planned?.action !== 'create') continue;
    const skipped = new Set(planned.skippedRpcConfigs.map((item) => item.chainId));
    await payload.create({
      collection: 'apps',
      data: {
        ...withoutTimestamps(app),
        organization: orgId,
        rpcConfigs: (app.rpcConfigs ?? []).filter((rpc) => !skipped.has(rpc.chainId)),
        quickNodeApiKey: planned.quickNodeSkipped ? null : app.quickNodeApiKey,
        paymentSettings: (app.paymentSettings ?? undefined) as App['paymentSettings'],
      },
      ...SYSTEM,
    });
  }

  const db = payload.db.drizzle;
  const newPayments = config.acceptedPayments.filter((row) =>
    plan.acceptedPayments.some((item) => item.id === row.id && item.action === 'create'),
  );
  if (newPayments.length) await db.insert(app_accepted_payments).values(newPayments).onConflictDoNothing();

  for (const endpoint of config.endpoints) {
    const planned = plan.endpoints.find((item) => item.id === endpoint.id);
    if (planned?.action !== 'create') continue;
    try {
      await payload.create({
        collection: 'webhook-endpoints',
        data: { ...withoutTimestamps(endpoint), isSystemWebhook: false },
        ...SYSTEM,
      });
    } catch (error) {
      planned.action = 'skip';
      planned.reason = error instanceof Error ? error.message : 'refused by the node';
    }
  }

  const newInvoices = config.invoices.filter((row) =>
    plan.invoices.some((item) => item.id === row.id && item.action === 'create'),
  );
  if (newInvoices.length) await db.insert(app_invoices).values(newInvoices).onConflictDoNothing();

  await invalidateOrganizationAppMetadata(payload, orgId);
}

/** Creates the monthly partitions rows of `createdAt` need, once per month per import. */
async function ensurePartitions(db: Db, table: PartitionedTable, createdAt: string[], ensured: Set<string>) {
  for (const value of createdAt) {
    const partition = monthlyPartition(table, new Date(value));
    if (ensured.has(partition.name)) continue;
    await db.execute(sql.raw(createPartitionSql(partition)));
    ensured.add(partition.name);
  }
}

/** Columns a repeated import may update: everything but the row's identity */
const IMMUTABLE_TRANSACTION_COLUMNS = new Set(['id', 'txKey', 'createdAt', 'owner']);
const transactionUpdates = Object.fromEntries(
  Object.entries(transactions)
    .filter(
      ([key, column]) =>
        !IMMUTABLE_TRANSACTION_COLUMNS.has(key) && typeof column === 'object' && column && 'name' in column,
    )
    .map(([key, column]) => [key, sql.raw(`excluded."${(column as { name: string }).name}"`)]),
);

/**
 * The row a transaction record is written as: the chain ID as the engine stores it, and the keys sent with the
 * transaction encrypted with this node's key, as the engine keeps them (the export carries them in plain text).
 */
export function transactionRowFrom(row: TransactionRecord) {
  return {
    ...row,
    // One chain ID per Solana cluster, as the engine stores it
    chainId: row.adapter === 'solana' ? (getSolanaChainId(row.chainId) ?? row.chainId) : row.chainId,
    bundlerUrl: row.bundlerUrl ? encrypt(row.bundlerUrl) : null,
    pimlicoApiKey: row.pimlicoApiKey ? encrypt(row.pimlicoApiKey) : null,
    rpcUrl: null,
  };
}

/**
 * Inserts transactions, or updates those the node has already imported when the export has a newer version of them
 * (`updated_at`). The engine's webhooks and hooks do not run: history is not delivered again.
 */
export async function writeTransactions(db: Db, batch: TransactionRecord[], ensured: Set<string>) {
  await ensurePartitions(
    db,
    'transactions',
    batch.map((row) => row.createdAt),
    ensured,
  );
  const values = batch.map(transactionRowFrom);

  // Which rows exist already, so the report can tell inserts from updates: RETURNING cannot read `xmax` on a
  // partitioned table
  const identity = (txKey: string, createdAt: string) => `${txKey}\u0001${Date.parse(createdAt)}`;
  const existing = new Set(
    (
      await db
        .select({ txKey: transactions.txKey, createdAt: transactions.createdAt })
        .from(transactions)
        .where(inArray(transactions.txKey, [...new Set(values.map((row) => row.txKey))]))
    ).map((row) => identity(row.txKey, row.createdAt)),
  );

  const written = await db
    .insert(transactions)
    .values(values)
    .onConflictDoUpdate({
      target: [transactions.txKey, transactions.createdAt],
      set: transactionUpdates,
      setWhere: sql`excluded.updated_at > ${transactions.updatedAt} AND ${transactions.owner} = excluded.owner_id`,
    })
    .returning({
      app: transactions.app,
      owner: transactions.owner,
      txKey: transactions.txKey,
      createdAt: transactions.createdAt,
      pending: transactions.pending,
    });

  const inserted = written.filter((row) => !existing.has(identity(row.txKey, row.createdAt))).length;
  return {
    inserted,
    updated: written.length - inserted,
    unchanged: batch.length - written.length,
    pending: written.filter((row) => row.pending && row.app),
  };
}

export async function writeDeliveries(db: Db, batch: WebhookDeliveryRecord[], ensured: Set<string>) {
  await ensurePartitions(
    db,
    'webhook_deliveries',
    batch.map((row) => row.createdAt),
    ensured,
  );
  const written = await db
    .insert(webhook_deliveries)
    .values(batch.map((row) => ({ ...row, updatedAt: row.updatedAt ?? row.createdAt })))
    .onConflictDoNothing({ target: [webhook_deliveries.id, webhook_deliveries.createdAt] })
    .returning({ id: webhook_deliveries.id });
  return { inserted: written.length, unchanged: batch.length - written.length };
}

/** Hands transactions that were still pending in Cloud to this node's trackers, as the engine and `retry` do. */
export async function queuePending(rows: { app: string | null; owner: string; txKey: string }[]) {
  const queue = getQueue(QUEUE_FAST);
  for (const row of rows) {
    if (!row.app) continue;
    await queue.add(
      'process-tx',
      { appId: row.app, ownerId: row.owner, txKey: row.txKey },
      {
        jobId: `${row.app}-${row.txKey}`,
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }
}
