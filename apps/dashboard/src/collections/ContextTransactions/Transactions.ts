import { OrbitAdapter } from '@tuwaio/sdk/orbit';
import {
  BaseTransaction,
  EvmTransaction,
  SolanaTransaction,
  StarknetTransaction,
  TransactionStatus,
  TransactionTracker,
} from '@tuwaio/sdk/pulsar';
import { TUWA_HEADERS } from '@tuwaio/shared/constants';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { CollectionConfig, Field, FieldAccess, PayloadRequest } from 'payload';
import { isHex } from 'viem';

import { isAdmin } from '@/lib/access';
import { getInternalSecret } from '@/lib/redis';
import { ProxyMetadata } from '@/lib/types';
import type { App, Organization } from '@/payload-types';

// ---------------------------------------------------------------------------
// 1. Type Mapping (Single Source of Truth)
// ---------------------------------------------------------------------------

type TxKeys = Exclude<
  keyof BaseTransaction | keyof EvmTransaction | keyof SolanaTransaction | keyof StarknetTransaction,
  'isTrackedModalOpen'
>;

type TransactionFieldMap = Record<TxKeys, TxKeys>;

const F = {
  // --- Base Transaction Fields ---
  chainId: 'chainId',
  description: 'description',
  error: 'error',
  finishedTimestamp: 'finishedTimestamp',
  from: 'from',
  isError: 'isError',
  localTimestamp: 'localTimestamp',
  payload: 'payload',
  pending: 'pending',
  status: 'status',
  syncStatus: 'syncStatus',
  title: 'title',
  tracker: 'tracker',
  txKey: 'txKey',
  type: 'type',
  connectorType: 'connectorType',
  confirmations: 'confirmations',
  requiredConfirmations: 'requiredConfirmations',
  rpcUrl: 'rpcUrl',
  adapter: 'adapter',

  // --- EVM Specific Fields ---
  hash: 'hash',
  input: 'input',
  maxFeePerGas: 'maxFeePerGas',
  maxPriorityFeePerGas: 'maxPriorityFeePerGas',
  nonce: 'nonce',
  replacedTxHash: 'replacedTxHash',
  to: 'to',
  value: 'value',
  bundlerUrl: 'bundlerUrl',
  pimlicoApiKey: 'pimlicoApiKey',

  // --- Solana Specific Fields ---
  fee: 'fee',
  instructions: 'instructions',
  recentBlockhash: 'recentBlockhash',
  slot: 'slot',

  // --- Starknet Specific Fields ---
  actualFee: 'actualFee',
  contractAddress: 'contractAddress',
} satisfies TransactionFieldMap;

// ---------------------------------------------------------------------------
// 2. Auth Logic (Iron Dome Integration)
// ---------------------------------------------------------------------------

/**
 * Resolves the authentication context for the request.
 */
async function resolveAuthContext(req: PayloadRequest): Promise<ProxyMetadata> {
  // A. PROXY PATH (Production / Iron Dome)
  const proxyMeta = req.headers.get(TUWA_HEADERS.METADATA);
  const proxySignature = req.headers.get(TUWA_HEADERS.METADATA_SIGNATURE);
  const metadataSecret = await getInternalSecret();
  if (proxyMeta && proxySignature && metadataSecret) {
    try {
      const expectedSignature = createHmac('sha256', metadataSecret).update(proxyMeta).digest('hex');
      const validSignature = timingSafeEqual(Buffer.from(proxySignature, 'hex'), Buffer.from(expectedSignature, 'hex'));
      if (!validSignature) throw new Error('Invalid metadata signature');

      const meta = JSON.parse(proxyMeta);
      if (
        typeof meta.ownerId !== 'string' ||
        typeof meta.id !== 'string' ||
        !['public', 'secret', 'internal'].includes(meta.credentialType)
      ) {
        throw new Error('Incomplete trusted auth context');
      }
      return {
        ownerId: meta.ownerId,
        scopes: meta.scopes || [],
        appId: meta.id,
        credentialType: meta.credentialType,
      };
    } catch (e) {
      console.error('Invalid Proxy Metadata', e);
    }
  }

  // B. DIRECT PATH (Local Dev / Fallback)
  const apiKey = req.headers.get(TUWA_HEADERS.SECRET_KEY);
  if (!apiKey) throw new Error('Access Denied: No Auth Context.');

  const secretHash = createHash('sha256').update(apiKey).digest('hex');
  const keyResult = await req.payload.find({
    collection: 'apps',
    where: { secretKeyHash: { equals: secretHash } },
    limit: 1,
    depth: 0,
  });

  if (!keyResult.totalDocs) throw new Error('Access Denied: Invalid Key.');
  const keyDoc = keyResult.docs[0] as unknown as App;

  if (!keyDoc.isActive) throw new Error('Access Denied: App Inactive.');

  const ownerId =
    typeof keyDoc.organization === 'object'
      ? (keyDoc.organization as Organization).id
      : (keyDoc.organization as string);

  return {
    ownerId: ownerId,
    scopes: ['history:read', 'sync:write', 'billing:view'],
    appId: keyDoc.id,
    credentialType: 'secret',
  };
}

// ---------------------------------------------------------------------------
// 3. Strict Sync Access (Machine-Only Updates)
// ---------------------------------------------------------------------------

/**
 * STRICT Access Control:
 * Updates are ONLY allowed via the Sync API (Pulsar Client with a valid Key).
 * Manual updates via Admin Dashboard are FORBIDDEN to ensure data integrity.
 */
const machineOnlySyncAccess = async ({ req }: { req: PayloadRequest; id?: string | number }): Promise<boolean> => {
  // ⛔️ BLOCK ADMIN MANUAL EDITS
  // We explicitly DO NOT check isAdmin(req) here.
  // If the request comes from the Dashboard (cookie auth), resolveAuthContext will fail/throw, returning false.

  try {
    const ctx = await resolveAuthContext(req);
    return ctx.scopes.includes('history:read');
    // eslint-disable-next-line
  } catch (e) {
    // If no API/Proxy context is found (e.g. Admin in Dashboard), Access Denied.
    return false;
  }
};

/**
 * STRICT Access Control for creation — same shape as machineOnlySyncAccess,
 * one scope up.
 *
 * A transaction row is an *observation* of something that happened on a chain:
 * the engine writes it from the Pulsar sync path, keyed by a real txKey, and
 * every consequence downstream (quota debit, webhook fan-out, the receipt PDF)
 * assumes it corresponds to an on-chain fact. A row typed into the Payload
 * admin has no such fact behind it, cannot be corrected afterwards
 * (`immutableField` forbids updates to every core field, with no admin
 * bypass), and cannot be reconciled — it just permanently pollutes the
 * organization's history and statistics.
 *
 * So creation is machine-only, in EVERY edition. Admins keep `delete` for
 * legal-compliance removals, which is the one manual operation on this
 * collection that has a defensible reason to exist.
 *
 * This deliberately does not check isAdmin either: a Dashboard cookie session
 * carries no API context, so resolveAuthContext throws and access is denied —
 * which is also what hides the "Create new" button in the admin UI.
 */
const machineOnlyCreateAccess = async ({ req }: { req: PayloadRequest; id?: string | number }): Promise<boolean> => {
  try {
    const ctx = await resolveAuthContext(req);
    return ctx.scopes.includes('sync:write');
    // eslint-disable-next-line
  } catch (e) {
    return false;
  }
};

/**
 * Immutable Fields:
 * Once created, these fields cannot be changed by ANYONE (even via API).
 */
const immutableField: FieldAccess = ({ doc }) => {
  if (!doc) return true; // Creation allowed
  return false; // ⛔️ Updates FORBIDDEN (No Admin Bypass)
};

// ---------------------------------------------------------------------------
// 4. Collection Config
// ---------------------------------------------------------------------------

const coreFields: Field[] = [
  {
    name: 'owner',
    type: 'relationship',
    relationTo: 'organizations',
    required: true,
    index: true,
    access: { update: immutableField }, // Never change owner
    admin: { description: 'Tenant Owner (Auto-stamped via API Key)' },
  },
  {
    name: 'app',
    type: 'relationship',
    relationTo: 'apps',
    index: true,
    access: { update: immutableField },
    admin: { description: 'The App used to initiate this transaction.' },
  },
  {
    name: 'appName',
    type: 'text',
    required: true,
    index: true,
    defaultValue: 'Web3 App',
    admin: { description: 'App name for filtering by apps.' },
  },
  {
    name: F.txKey,
    type: 'text',
    required: true,
    unique: true,
    index: true,
    label: 'Transaction Key',
    access: { update: immutableField },
  },
  {
    name: F.chainId,
    type: 'text',
    required: true,
    index: true,
    access: { update: immutableField },
  },
  {
    name: F.from,
    type: 'text',
    required: true,
    index: true,
    access: { update: immutableField },
  },
  {
    name: F.type,
    type: 'text',
    required: true,
    access: { update: immutableField },
  },
  {
    name: F.connectorType,
    type: 'text',
    required: true,
    access: { update: immutableField },
  },
  {
    name: F.adapter,
    type: 'select',
    required: true,
    index: true,
    options: Object.values(OrbitAdapter),
    access: { update: immutableField },
  },
  {
    name: F.tracker,
    type: 'select',
    required: true,
    options: Object.values(TransactionTracker),
    admin: { description: 'Tracking System' },
    // Tracker might change (e.g. Ethereum -> Safe), so we allow update if logic permits,
    // but usually it's static. Let's keep it mutable via API if needed for complex flows,
    // or add immutableField if strict. Assuming API controls logic.
  },
  {
    name: F.status,
    type: 'select',
    index: true,
    options: Object.values(TransactionStatus),
    // Status is the MAIN field updated by Pulsar Sync. Mutable via API.
  },
  {
    name: F.syncStatus,
    type: 'select',
    index: true,
    options: [
      { label: 'Synced', value: 'synced' },
      { label: 'Pending Sync', value: 'pending-sync' },
    ],
    defaultValue: 'synced',
    admin: { description: 'Engine sync status' },
  },
  { name: F.pending, type: 'checkbox', required: true, defaultValue: true },
  { name: F.isError, type: 'checkbox', defaultValue: false },
  {
    name: F.localTimestamp,
    type: 'number',
    required: true,
    index: true,
    access: { update: immutableField },
  },
  { name: F.finishedTimestamp, type: 'number' },
  { name: F.title, type: 'json', validate: () => true },
  { name: F.description, type: 'json', validate: () => true },
  { name: F.error, type: 'json', validate: () => true },
  { name: F.payload, type: 'json', label: 'Payload', validate: () => true },
  { name: F.confirmations, type: 'text' },
  { name: F.requiredConfirmations, type: 'number' },
  { name: F.rpcUrl, type: 'text' },

  // --- Payments App Kind Fields ---
  {
    name: 'appInvoiceId',
    type: 'relationship',
    relationTo: 'app-invoices',
    hasMany: false,
    index: true,
    admin: { description: 'Linked AppInvoice (Payments apps only).' },
  },
  {
    name: 'amlStatus',
    type: 'select',
    defaultValue: 'not_applicable',
    options: [
      { label: 'N/A', value: 'not_applicable' },
      { label: 'Pending', value: 'pending' },
      { label: 'Passed', value: 'passed' },
      { label: 'Flagged', value: 'flagged' },
      { label: 'Failed', value: 'failed' },
    ],
    index: true,
    admin: { description: 'AML screening result (Payments apps only).' },
  },
  {
    name: 'amlRiskScore',
    type: 'number',
    min: 0,
    max: 100,
    defaultValue: 0,
    admin: { description: 'Risk score from AML provider (0-100).' },
  },
  {
    name: 'amlProviderData',
    type: 'json',
    validate: () => true,
    admin: { description: 'Raw response data from the AML provider.' },
  },
];

const evmFields: Field[] = [
  {
    name: F.hash,
    type: 'text',
    index: true,
    validate: (val: any) => (!val || isHex(val) ? true : 'Invalid Hash'),
  },
  { name: F.to, type: 'text', index: true, access: { update: immutableField } },
  { name: F.value, type: 'text', access: { update: immutableField } },
  { name: F.input, type: 'textarea', access: { update: immutableField } },
  { name: F.nonce, type: 'number', access: { update: immutableField } },
  { name: F.maxFeePerGas, type: 'text' },
  { name: F.maxPriorityFeePerGas, type: 'text' },
  { name: F.replacedTxHash, type: 'text' },
  { name: F.bundlerUrl, type: 'text' },
  { name: F.pimlicoApiKey, type: 'text' },
];

const solanaFields: Field[] = [
  { name: F.fee, type: 'number' },
  { name: F.slot, type: 'number' },
  { name: F.recentBlockhash, type: 'text' },
  { name: F.instructions, type: 'json', validate: () => true },
];

const starknetFields: Field[] = [
  { name: F.actualFee, type: 'json', validate: () => true },
  {
    name: F.contractAddress,
    type: 'text',
    access: { update: immutableField },
  },
];

export const Transactions: CollectionConfig = {
  slug: 'transactions',
  disableDuplicate: true,
  admin: {
    group: 'Data Layer',
    useAsTitle: F.txKey,
    defaultColumns: [F.txKey, F.adapter, F.chainId, F.status, F.localTimestamp],
    description:
      'Ledger of tracked transactions, written by the engine. Records are not created, edited or deleted from here — ' +
      'they mirror on-chain history and the quota that was spent tracking it. Rows leave only with the app or the ' +
      'organization they belong to.',
    components: {
      edit: {
        beforeDocumentControls: [
          '@/components/admin/TransactionRetryButton',
          '@/components/admin/TransactionDownloadReceiptButton',
        ],
      },
    },
  },
  access: {
    read: () => true, // Access gated by beforeOperation hook

    // 🔥 STRICT CREATE ACCESS:
    // Machine (Pulsar sync) context only. The beforeOperation hook below still
    // runs first and still stamps owner/app from the API context; this gate is
    // what stops a Dashboard admin from reaching the operation at all.
    create: machineOnlyCreateAccess,

    // 🔥 STRICT UPDATE ACCESS:
    // Only requests with valid API Context (Pulsar Client) can update.
    // Admin Dashboard requests will FAIL here.
    update: machineOnlySyncAccess,

    // 🔥 NO MANUAL DELETE:
    // Closed to everyone, admins included. A transaction row is the record of
    // work the engine did and quota the organization was charged for; deleting
    // one by hand makes the ledger disagree with both the chain and the
    // billing history, and nothing here can put it back.
    //
    // The cascades are unaffected — Apps.beforeDelete and
    // Organizations.beforeDelete both delete with `overrideAccess: true`, which
    // never consults this gate. Removing an app still removes its transactions.
    delete: () => false,
  },
  hooks: {
    beforeOperation: [
      async ({ args, operation, req }) => {
        // --- READ ---
        if (operation === 'read') {
          if (isAdmin({ req })) return args;

          // Internal server-side Local API calls (e.g. idempotency check)
          if (req.context?.skipOwnerFilter) return args;

          const findArgs = args as any;
          // eslint-disable-next-line no-useless-assignment
          let ownerFilter = {};

          if (req.user) {
            // Find user's organizations
            const memberships = await req.payload.find({
              collection: 'organization-members',
              where: { user: { equals: req.user.id } },
              limit: 100,
              depth: 0,
            });
            const orgIds = memberships.docs.map((m) =>
              typeof m.organization === 'object' ? m.organization.id : m.organization,
            );
            ownerFilter = { owner: { in: orgIds } };
          } else {
            const ctx = await resolveAuthContext(req);
            ownerFilter = { owner: { equals: ctx.ownerId } };
          }

          return {
            ...findArgs,
            where: { and: [findArgs.where || {}, ownerFilter] },
          };
        }

        // --- CREATE ---
        if (operation === 'create') {
          // Kept deliberately, even though `access.create` now denies admins.
          // beforeOperation runs BEFORE access control, so without this early
          // return an admin pressing "Create" would hit the throw inside
          // resolveAuthContext and get a 500 instead of the clean Forbidden
          // that machineOnlyCreateAccess produces one step later.
          if (isAdmin({ req })) return args;

          const ctx = await resolveAuthContext(req);
          const createArgs = args as any;

          createArgs.data = {
            ...(createArgs.data || {}),
            owner: ctx.ownerId,
            app: ctx.appId,
          };
          return createArgs;
        }

        // --- UPDATE ---
        if (operation === 'update') {
          if (req.context?.skipOwnerFilter) return args;

          // Note: We do NOT skip logic for Admins here, because Access Control
          // already blocked Dashboard Admins. This code runs only for API Context.

          let ctx;
          try {
            ctx = await resolveAuthContext(req);
          } catch (e) {
            // Should not happen due to 'access.update' check, but safety first
            throw new Error('Update Forbidden: Machine Context Required', { cause: e });
          }

          const updateArgs = args as any;

          // Security: API Client can ONLY update their own records.
          return {
            ...updateArgs,
            where: {
              and: [
                updateArgs.where || {},
                {
                  owner: {
                    equals: ctx.ownerId,
                  },
                },
              ],
            },
          };
        }

        return args;
      },
    ],
  },
  fields: [
    ...coreFields,
    {
      type: 'tabs',
      tabs: [
        { label: 'EVM', fields: evmFields },
        { label: 'Solana', fields: solanaFields },
        { label: 'Starknet', fields: starknetFields },
      ],
    },
  ],
  custom: {
    drizzle: {
      partitioned: true,
      partitionKey: 'created_at',
    },
  },
};
