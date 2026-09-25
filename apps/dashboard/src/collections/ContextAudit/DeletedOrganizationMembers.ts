import { createId } from '@tuwaio/shared/cuid';
import type { CollectionConfig } from 'payload';

import { isAdmin } from '@/lib/access';

export const DeletedOrganizationMembers: CollectionConfig = {
  slug: 'deleted-organization-members',
  disableDuplicate: true,
  admin: {
    group: 'Audit',
    useAsTitle: 'email',
    defaultColumns: ['email', 'organization', 'user', 'deletedAt'],
    description:
      'Tombstones written automatically when a membership is revoked — the record of who lost access to which ' +
      'organization and when. Creation and editing are disabled so the trail cannot be authored after the fact; ' +
      'clearing old entries stays available to global admins.',
  },
  access: {
    read: isAdmin,
    create: () => false, // System hook only with overrideAccess: true
    update: () => false,
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
      name: 'organization',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'user',
      type: 'text',
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'email',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'deletedAt',
      type: 'date',
      required: true,
      index: true,
      admin: { readOnly: true },
      defaultValue: () => new Date(),
    },
  ],
};
