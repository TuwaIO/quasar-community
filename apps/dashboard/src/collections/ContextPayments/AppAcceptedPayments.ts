import { createId } from '@tuwaio/shared/cuid';
import type { CollectionConfig } from 'payload';

import { isMemberOfOrganization, isOrgOwner } from '@/lib/access';

/**
 * Per-App accepted payment methods.
 * Tenant-isolated: every record scoped to an organization.
 * Write access restricted to org owners only.
 *
 * Part of the Payments App, which is dormant in every edition — see the
 * `create` note below.
 */
export const AppAcceptedPayments: CollectionConfig = {
  slug: 'app-accepted-payments',
  disableDuplicate: true,
  admin: {
    group: 'Payments',
    useAsTitle: 'name',
    defaultColumns: ['name', 'symbol', 'chainId', 'app', 'organization', 'isActive'],
    description:
      'Future feature (Payments App). Creation is disabled in every edition until the payment flow ships; ' +
      'existing records stay editable so a configuration can be corrected.',
  },
  access: {
    read: isMemberOfOrganization,
    // Disabled in every edition, on purpose, and not because of the community
    // split: the Payments App this belongs to is declared but not yet
    // delivered (open-source-plans/03-billing-vs-payments.md, 06-roadmap.md).
    //
    // Creating a row here is not inert — it advertises a wallet address as a
    // live payment destination for an app whose collection flow does not exist
    // yet, so funds sent to it would be received with nothing to settle them
    // against. Until that ships, the safe number of ways to declare one is
    // zero.
    //
    // `update`/`delete` deliberately stay open to org owners: a record created
    // before this gate closed must remain correctable and removable.
    create: () => false,
    update: isOrgOwner,
    delete: isOrgOwner,
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
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      required: true,
      index: true,
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'e.g., "USDC on Base", "Native ETH on Mainnet"',
      },
    },
    {
      name: 'walletAddressToReceivePayment',
      type: 'text',
      required: true,
      admin: {
        description: 'The destination wallet address (Hex string) that will receive direct transfers.',
      },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !value) return 'This field is required.';
        if (!/^0x[a-fA-F0-9]+$/.test(value)) {
          return 'Must be a valid hex address starting with 0x.';
        }
        return true;
      },
    },
    {
      name: 'tokenAddress',
      type: 'text',
      required: true,
      admin: {
        description: 'Hex string of the ERC20 token, or strictly "native" for ETH/SOL.',
      },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !value) return 'This field is required.';
        if (value === 'native') return true;
        if (!/^0x[a-fA-F0-9]+$/.test(value)) {
          return 'Must be a valid hex address starting with 0x, or "native".';
        }
        return true;
      },
    },
    {
      name: 'chainId',
      type: 'number',
      required: true,
    },
    {
      name: 'symbol',
      type: 'text',
      required: true,
      admin: {
        description: 'e.g., "USDC", "ETH"',
      },
    },
    {
      name: 'decimals',
      type: 'number',
      required: true,
      defaultValue: 6,
    },
    {
      name: 'markup',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Percentage markup added to this payment method (e.g. 1.5 for 1.5%).',
      },
    },
    {
      name: 'discount',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Percentage discount subtracted from this payment method (e.g. 1.0 for 1.0%).',
      },
    },
    {
      name: 'priceFeedAddress',
      type: 'text',
      required: true,
      admin: {
        description: 'Chainlink Price Feed aggregator address (Hex string) for USD exchange rate conversions on-chain.',
      },
      validate: (value: unknown) => {
        if (!value || typeof value !== 'string' || !/^0x[a-fA-F0-9]+$/.test(value)) {
          return 'Must be a valid hex address starting with 0x.';
        }
        return true;
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Toggle to enable/disable this payment method.',
      },
    },
  ],
};
