import { createId } from '@tuwaio/shared/cuid';
import type { CollectionConfig } from 'payload';

import { isAdmin } from '@/lib/access';

export const DeletedOrganizations: CollectionConfig = {
  slug: 'deleted-organizations',
  disableDuplicate: true,
  admin: {
    group: 'Audit',
    useAsTitle: 'orgName',
    defaultColumns: ['orgName', 'originalId', 'deletedBy', 'deletedAt'],
    description:
      'Tombstones written automatically when an organization is deleted, including who deleted it. Creation and ' +
      'editing are disabled — this is the only surviving trace of an organization and everything it owned, so it ' +
      'must not be something a person can compose. Clearing old entries stays available to global admins.',
  },
  access: {
    read: isAdmin,
    // System-authored only, exactly like deleted-accounts: the single writer is
    // `Organizations.afterDelete`, which passes `overrideAccess: true` and so
    // never consults this gate. Blocking manual creation keeps the log
    // trustworthy and stops a hand-written row from triggering the
    // ORG_DELETION_COOLDOWN_DAYS check in `Organizations.beforeChange`.
    create: () => false,
    update: () => false, // Immutable
    delete: isAdmin,
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
      name: 'orgName',
      type: 'text',
      required: true,
      label: 'Organization Name',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'originalId',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'The ID of the Organization before deletion',
      },
    },
    {
      name: 'deletedBy',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'User ID who performed the deletion',
      },
    },
    {
      name: 'deletedAt',
      type: 'date',
      required: true,
      index: true,
      admin: {
        readOnly: true,
      },
    },
  ],
};
