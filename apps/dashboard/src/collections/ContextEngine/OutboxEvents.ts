import type { CollectionConfig } from 'payload';

export const OutboxEvents: CollectionConfig = {
  slug: 'outbox_events',
  disableDuplicate: true,
  admin: {
    useAsTitle: 'eventType',
    group: 'Engine',
    defaultColumns: ['eventType', 'status', 'createdAt'],
    description:
      'Transactional outbox: events the system committed alongside the data that produced them, waiting to be ' +
      'relayed. Fully read-only — the whole guarantee of the pattern is that a row appears here only as part of the ' +
      'database transaction that caused it, so anything inserted or edited by hand is an event that never happened.',
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false;
      return user.roles?.includes('admin') ?? false;
    },
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'eventType',
      type: 'text',
      required: true,
    },
    {
      name: 'payload',
      type: 'json',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Processed', value: 'processed' },
        { label: 'Failed', value: 'failed' },
      ],
    },
    {
      name: 'attempts',
      type: 'number',
      required: true,
      defaultValue: 0,
    },
    {
      name: 'nextAttemptAt',
      type: 'date',
      admin: {
        readOnly: true,
      },
    },
  ],
};
