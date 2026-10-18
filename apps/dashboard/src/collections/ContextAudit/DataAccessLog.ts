import { createId } from '@tuwaio/shared/cuid';
import type { CollectionConfig } from 'payload';

import { isAdmin } from '@/lib/access';
import { WATCHED_COLLECTIONS } from '@/lib/dataAccess';

const readOnly = { readOnly: true };

/**
 * The record of each view of customer data in the admin panel: who opened which list or record of
 * which collection, and when. Written only by `recordDataAccess` (`lib/dataAccess.ts`); nobody creates, edits or
 * deletes an entry through the API. The server deletes entries after 1 year (`RETENTION.DATA_ACCESS_LOG_MONTHS`).
 */
export const DataAccessLog: CollectionConfig = {
  slug: 'data-access-log',
  disableDuplicate: true,
  defaultSort: '-viewedAt',
  admin: {
    group: 'Audit',
    useAsTitle: 'viewedCollection',
    defaultColumns: ['viewedAt', 'userEmail', 'viewedCollection', 'operation', 'total'],
    description:
      'Read-only. One entry for each list or record of customer data opened in the admin panel: who, which collection ' +
      'and records, when. Kept for 1 year, then deleted. Reviewed every week (Access Reviews).',
  },
  access: {
    read: isAdmin,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'id', type: 'text', unique: true, required: true, defaultValue: () => createId(), admin: readOnly },
    {
      name: 'viewedAt',
      type: 'date',
      required: true,
      index: true,
      admin: { ...readOnly, date: { pickerAppearance: 'dayAndTime' } },
    },
    { name: 'user', type: 'relationship', relationTo: 'users', index: true, admin: readOnly },
    { name: 'userEmail', type: 'text', required: true, admin: readOnly },
    {
      name: 'viewedCollection',
      type: 'select',
      required: true,
      index: true,
      options: WATCHED_COLLECTIONS.map((value) => ({ label: value, value })),
      admin: readOnly,
    },
    {
      name: 'operation',
      type: 'select',
      required: true,
      options: [
        { label: 'List', value: 'list' },
        { label: 'Record', value: 'record' },
      ],
      admin: readOnly,
    },
    {
      name: 'records',
      type: 'json',
      admin: { ...readOnly, description: 'The ids of the records shown, up to 100.' },
    },
    { name: 'total', type: 'number', admin: { ...readOnly, description: 'How many records the list had.' } },
  ],
  timestamps: false,
};
