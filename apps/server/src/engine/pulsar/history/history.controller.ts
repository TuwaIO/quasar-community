import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_READ } from '../../../database/database.constants';
import * as schema from '../../../database/schema/index';

@Controller('v1/engine/pulsar/history')
export class HistoryController {
  constructor(@Inject(DRIZZLE_READ) private readonly db: NodePgDatabase<typeof schema>) {}

  @Get()
  async getHistory(@Query() query: Record<string, string>, @Req() req: Record<string, unknown>) {
    const meta = req.ironDomeMeta as { ownerId: string; id: string };
    const { page = '1', limit = '10', status, txKey, walletAddress, chainId, appName } = query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 10));
    const offset = (pageNum - 1) * limitNum;

    const conditions = and(
      eq(schema.transactions.ownerId, meta.ownerId),
      eq(schema.transactions.appId, meta.id),
      ...(txKey ? [eq(schema.transactions.txKey, txKey)] : []),
      ...(status
        ? [eq(schema.transactions.status, status as (typeof schema.enumTransactionsStatus.enumValues)[number])]
        : []),
      ...(walletAddress ? [eq(schema.transactions.from, walletAddress)] : []),
      ...(chainId ? [eq(schema.transactions.chainId, chainId)] : []),
      ...(appName ? [eq(schema.transactions.appName, appName)] : []),
    );

    const [docs, [{ total }]] = await Promise.all([
      this.db
        .select()
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
