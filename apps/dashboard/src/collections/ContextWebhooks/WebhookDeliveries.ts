import { createId } from '@tuwaio/shared/cuid';
import type { CollectionConfig } from 'payload';

import { isMemberOfEndpointOrganization } from '@/lib/access';

/**
 * WebhookDeliveries Collection
 *
 * Immutable, append-only log of outbound HTTP POST requests to webhook endpoints.
 * Each record captures the full request/response cycle for debugging and auditing.
 * No manual creation or updates allowed — records are written exclusively by the
 * webhook dispatch system via `overrideAccess: true`.
 */
export const WebhookDeliveries: CollectionConfig = {
  slug: 'webhook-deliveries',
  disableDuplicate: true,
  admin: {
    useAsTitle: 'id',
    group: 'Product',
    defaultColumns: ['endpoint', 'txKey', 'httpStatus', 'success', 'executionTimeMs', 'createdAt'],
    enableRichTextRelationship: false,
    description:
      'Append-only delivery log, written by the dispatcher. Records cannot be created, edited or deleted here — ' +
      'a delivery attempt is evidence of what the system actually sent, and evidence that can be edited away is ' +
      'worth nothing during an incident. Retry appears only on failed deliveries and records the new attempt on ' +
      'the same row.',
    components: {
      edit: {
        beforeDocumentControls: ['@/components/admin/WebhookDeliveryRetryButton'],
      },
    },
  },
  access: {
    read: isMemberOfEndpointOrganization,
    create: () => false,
    update: () => false,
    // Closed to everyone, admins included. This log is what answers "did we
    // deliver it, and what did they reply" after the fact; a row an operator
    // can remove is not an answer. Growth is handled by retention, not by the
    // delete button.
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
      name: 'endpoint',
      type: 'relationship',
      relationTo: 'webhook-endpoints',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'The webhook endpoint this delivery was dispatched to.',
      },
    },
    {
      name: 'eventType',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'The type of event that triggered this delivery (e.g., tx.confirmed).',
      },
    },
    {
      name: 'txKey',
      type: 'text',
      required: true,
      index: true,
      label: 'Transaction Key',
      admin: {
        readOnly: true,
        description: 'The hash or unique ID of the transaction that triggered this webhook.',
      },
    },
    {
      name: 'httpStatus',
      type: 'number',
      label: 'HTTP Status',
      admin: {
        readOnly: true,
        description: 'HTTP status code returned by the client server (e.g., 200, 500).',
      },
    },
    {
      name: 'success',
      type: 'checkbox',
      required: true,
      label: 'Successful',
      admin: {
        readOnly: true,
        description: 'True if httpStatus is in the 2xx range.',
      },
    },
    {
      name: 'requestPayload',
      type: 'json',
      label: 'Request Payload',
      admin: {
        readOnly: true,
        description: 'The exact JSON body sent to the endpoint.',
      },
    },
    {
      name: 'responseBody',
      type: 'text',
      label: 'Response Body',
      admin: {
        readOnly: true,
        description: 'Response from the server. Can be HTML or JSON text.',
      },
    },
    {
      name: 'executionTimeMs',
      type: 'number',
      label: 'Execution Time (ms)',
      admin: {
        readOnly: true,
        description: 'Round-trip time of the HTTP request in milliseconds.',
      },
    },
    {
      name: 'attempts',
      type: 'number',
      label: 'Attempts',
      admin: {
        readOnly: true,
        description: 'The number of attempts made to deliver this webhook.',
      },
    },
  ],
  custom: {
    drizzle: {
      partitioned: true,
      partitionKey: 'created_at',
    },
  },
};
