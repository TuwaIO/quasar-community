import { Controller, ForbiddenException, Get, Inject, Query, Req } from '@nestjs/common';
import { and, count, desc, eq, getTableColumns, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getAddress, isAddress } from 'viem';

import { DRIZZLE_READ } from '../../../database/database.constants';
import * as schema from '../../../database/schema/index';
import { solanaChainIdAliases } from '../../../lib/solana-chain';

/**
 * Every form a wallet address may be stored in. Clients sync an EVM sender checksummed or in lower case, so both are
 * matched (through the `from` index, unlike `lower(from)`); a Solana address is case-sensitive and matched as it is.
 */
function walletAddressForms(address: string): string[] {
  if (!isAddress(address, { strict: false })) return [address];
  return [...new Set([address, address.toLowerCase(), getAddress(address)])];
}

// Not returned: the endpoints and keys an app may send with a transaction (needed only to track it), the raw data of the
// AML provider and the internal IDs of the app and its organization
const HIDDEN_FIELDS = new Set(['ownerId', 'appId', 'rpcUrl', 'bundlerUrl', 'pimlicoApiKey', 'amlProviderData']);
const HISTORY_FIELDS = Object.fromEntries(
  Object.entries(getTableColumns(schema.transactions)).filter(([name]) => !HIDDEN_FIELDS.has(name)),
);

@Controller('v1/engine/pulsar/history')
export class HistoryController {
  constructor(@Inject(DRIZZLE_READ) private readonly db: NodePgDatabase<typeof schema>) {}

  @Get()
  async getHistory(@Query() query: Record<string, string>, @Req() req: Record<string, unknown>) {
    const meta = req.engineMeta as { ownerId: string; id: string; credentialType?: string };
    // The history holds the data of every user of the app: only the secret key, which stays on the app's server, reads it
    if (meta.credentialType === 'public') {
      throw new ForbiddenException('Reading the history needs the secret key of the app; call it from your server.');
    }
    const { page = '1', limit = '10', status, txKey, walletAddress, chainId, appName } = query;

    const pageNum = Math.max(1, Math.floor(Number(page)) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
    const offset = (pageNum - 1) * limitNum;

    const conditions = and(
      eq(schema.transactions.ownerId, meta.ownerId),
      eq(schema.transactions.appId, meta.id),
      ...(txKey ? [eq(schema.transactions.txKey, txKey)] : []),
      ...(status
        ? [eq(schema.transactions.status, status as (typeof schema.enumTransactionsStatus.enumValues)[number])]
        : []),
      ...(walletAddress ? [inArray(schema.transactions.from, walletAddressForms(walletAddress))] : []),
      // A Solana cluster is stored under its moniker or its CAIP-2 chain ID
      ...(chainId ? [inArray(schema.transactions.chainId, solanaChainIdAliases(chainId))] : []),
      ...(appName ? [eq(schema.transactions.appName, appName)] : []),
    );

    const [docs, [{ total }]] = await Promise.all([
      this.db
        .select(HISTORY_FIELDS)
        .from(schema.transactions)
        .where(conditions)
        .orderBy(desc(schema.transactions.localTimestamp))
        .limit(limitNum)
        .offset(offset),
      this.db.select({ total: count() }).from(schema.transactions).where(conditions),
    ]);

    const totalDocs = Number(total);
    const totalPages = Math.ceil(totalDocs / limitNum);

    return {
      success: true,
      docs: docs.map((tx) => {
        if (String(tx.chainId).split(':').length > 1) {
          return tx;
        }
        return {
          ...tx,
          chainId: Number(tx.chainId),
        };
      }),
      totalDocs,
      totalPages,
      page: pageNum,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
    };
  }
}
