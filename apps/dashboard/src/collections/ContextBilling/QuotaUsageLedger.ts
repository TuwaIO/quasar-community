import { createId } from '@tuwaio/shared/cuid';
import type { CollectionConfig } from 'payload';

import { isMemberOfOrganization } from '@/lib/access';

/**
 * Immutable idempotency ledger for Redis -> Postgres quota batches.
 * This is intentionally separate from BillingHistory: usage reconciliation is
 * an operational ledger, not a payment/top-up event.
 */
export const QuotaUsageLedger: CollectionConfig = {
  slug: 'quota-usage-ledger',
  disableDuplicate: true,
  admin: {
    useAsTitle: 'batchId',
    group: 'Usage & Reliability',
    defaultColumns: ['organization', 'batchId', 'amount', 'status', 'createdAt'],
    description:
      'Append-only record of quota drained from each organization, flushed from Redis in batches by the engine. ' +
      'Fully read-only: an entry is the reconciliation trail between what the engine metered and what the balance ' +
      'says, and a ledger anyone can write to cannot reconcile anything.',
  },
  access: {
    read: isMemberOfOrganization,
    // Machine-written, and not through Payload at all: the only writer is
    // `cron/sync-usage.service.ts` in the engine, which inserts straight into
    // the `quota_usage_ledger` table over Drizzle inside the same transaction
    // that debits the balance. Nothing in the codebase creates a row through
    // this collection, so the gate has no legitimate caller to serve.
    //
    // It must stay shut, in every edition: `batchId` is the idempotency key
    // that makes Redis -> Postgres reconciliation exactly-once. A row typed by
    // hand with a batchId the cron later generates would make that batch look
    // already-applied and silently drop real usage.
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'id',
      type: 'text',
      unique: true,
      required: true,
      defaultValue: () => createId(),
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
    },
    {
      name: 'batchId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'amount',
      type: 'number',
      required: true,
    },
    {
      name: 'usageCategory',
      type: 'text',
      required: true,
    },
    {
      name: 'sourceWindow',
      type: 'text',
      required: true,
    },
    {
      name: 'contentDigest',
      type: 'text',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'applied',
      options: [
        { label: 'Applied', value: 'applied' },
        { label: 'Manual Review', value: 'manual-review' },
      ],
      index: true,
    },
  ],
  hooks: {
    beforeChange: [
      ({ operation }) => {
        if (operation === 'update') {
          throw new Error('Quota usage ledger records are immutable.');
        }
      },
    ],
    beforeDelete: [
      () => {
        throw new Error('Quota usage ledger records cannot be deleted.');
      },
    ],
  },
};
