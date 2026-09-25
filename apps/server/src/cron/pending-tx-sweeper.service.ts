import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redlock from 'redlock';

import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema/index';
import { REDLOCK } from '../redis/redis.constants';

@Injectable()
export class PendingTxSweeperService {
  private readonly logger = new Logger(PendingTxSweeperService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @InjectQueue('{tracking-lazy}') private readonly lazyQueue: Queue,
    @Inject(REDLOCK) private readonly redlock: Redlock,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweepStalePendingTransactions() {
    const lockKey = 'lock:pending-tx-sweeper';
    const lock = await this.redlock.acquire([lockKey], 45000).catch(() => null);

    if (!lock) {
      return;
    }

    this.logger.log('Starting stale pending transactions sweep...');

    try {
      // Find all transactions that are pending and older than 1 hour
      const staleTransactions = await this.db
        .select({
          appId: schema.transactions.appId,
          ownerId: schema.transactions.ownerId,
          txKey: schema.transactions.txKey,
        })
        .from(schema.transactions)
        .where(
          and(eq(schema.transactions.pending, true), sql`${schema.transactions.createdAt} < NOW() - INTERVAL '1 hour'`),
        );

      if (staleTransactions.length === 0) {
        this.logger.log('No stale pending transactions found. Sweep complete.');
        return;
      }

      this.logger.log(`Found ${staleTransactions.length} stale pending transactions. Enqueuing for recovery...`);

      let enqueuedCount = 0;

      for (const tx of staleTransactions) {
        try {
          if (!tx.appId) {
            this.logger.warn(`Stale transaction ${tx.txKey} is missing appId. Skipping recovery enqueuing.`);
            continue;
          }
          await this.lazyQueue.add(
            'process-tx',
            { appId: tx.appId, ownerId: tx.ownerId, txKey: tx.txKey },
            {
              jobId: `${tx.appId}-${tx.txKey}`, // Use appId-txKey as jobId to prevent duplicate queueing if already in queue
              removeOnComplete: true,
              attempts: 3,
              backoff: {
                type: 'exponential',
                delay: 60000,
              },
            },
          );
          enqueuedCount++;
        } catch (err) {
          this.logger.error(`Failed to enqueue recovery for tx ${tx.txKey}:`, err);
        }
      }

      this.logger.log(
        `Sweep complete. Successfully enqueued ${enqueuedCount}/${staleTransactions.length} transactions for recovery.`,
      );
    } catch (error) {
      this.logger.error('Critical error during pending transactions sweep:', error);
    } finally {
      if (lock) {
        // @ts-expect-error: @types/redlock@4 defines unlock(), but runtime redlock@5-beta uses release()
        await lock.release().catch(() => null);
      }
    }
  }
}
