import { createId } from '@tuwaio/shared/cuid';
import type { CollectionConfig } from 'payload';

import { isAdmin } from '@/lib/access';

export const DeletedAccounts: CollectionConfig = {
  slug: 'deleted-accounts',
  disableDuplicate: true,
  admin: {
    group: 'Audit',
    useAsTitle: 'email',
    defaultColumns: ['email', 'originalId', 'deletedAt'],
    description:
      'Tombstones written automatically when an account is deleted. Creation and editing are disabled: a row here is ' +
      'proof that a specific deletion happened, and a hand-written or hand-edited one proves nothing. Clearing old ' +
      'entries stays available to global admins.',
  },
  access: {
    read: isAdmin,
    // An audit log is only evidence if nothing can author an entry by hand.
    // Rows are written exclusively by `Users.beforeDelete` with
    // `overrideAccess: true`, which bypasses this gate entirely — so `false`
    // costs the system nothing and removes the admin's "Create new" button.
    // A hand-written row would also defeat the re-registration cooldown the
    // same hook enforces, since it is keyed on (email, deletedAt).
    create: () => false,
    update: () => false, // Immutable audit log
    delete: isAdmin, // Only admin can clear logs
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
      name: 'email',
      type: 'email',
      required: true,
      index: true,
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
        description: 'The ID of the User before deletion',
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
