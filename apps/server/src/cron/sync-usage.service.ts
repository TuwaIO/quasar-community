import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { createHash, randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { Counter } from 'prom-client';
import Redlock from 'redlock';

import { DRIZZLE } from '../database/database.module';
import { organizations } from '../database/schema';
import * as schema from '../database/schema/index';
import { REDIS, REDLOCK } from '../redis/redis.constants';

@Injectable()
export class SyncUsageService implements OnApplicationShutdown {
  private readonly logger = new Logger(SyncUsageService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REDLOCK) private readonly redlock: Redlock,
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @InjectMetric('quota_negative_overdraft_limit_reached_total')
    private readonly overdraftCounter: Counter,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.logger.log('[Shutdown] Flushing all pending Redis usage to Postgres...');

    for await (const keys of this.scanStreamSafe('{*}:usage')) {
      if (keys.length === 0) continue;

      for (const key of keys) {
        const organizationId = key.split('}')[0].slice(1);
        this.logger.log(`[Shutdown] Synchronizing usage for Org ${organizationId}`);
        await this.syncSingleOrg(organizationId);
      }
    }

    this.logger.log('[Shutdown] All usage flushed successfully.');
  }

  private async *scanStreamSafe(pattern: string) {
    // Detect Cluster mode via constructor checking nodes method
    if (typeof (this.redis as any).nodes === 'function') {
      const masters = (this.redis as any).nodes('master');
      for (const node of masters) {
        const stream = node.scanStream({ match: pattern, count: 100 });
        for await (const keys of stream) {
          yield keys;
        }
      }
    } else {
      const stream = (this.redis as any).scanStream({ match: pattern, count: 100 });
      for await (const keys of stream) {
        yield keys;
      }
    }
  }

  /**
   * Synchronizes usage for a specific organization from Redis to Postgres.
   * This is used for threshold-based sync and during graceful shutdown.
   *
   * @param organizationId The organization ID to sync
   */
  async syncSingleOrg(organizationId: string): Promise<void> {
    const usageKey = `{${organizationId}}:usage`;
    const batchKey = `{${organizationId}}:usage:batch`;
    const syncKey = `{${organizationId}}:sync`;
    const syncBatchKey = `{${organizationId}}:sync:batch`;

    // Atomic move from usage bucket to sync bucket using Lua
    const script = `
      if redis.call('EXISTS', KEYS[1]) == 1 and redis.call('EXISTS', KEYS[2]) == 0 and redis.call('EXISTS', KEYS[3]) == 1 and redis.call('EXISTS', KEYS[4]) == 0 then
        redis.call('RENAME', KEYS[1], KEYS[3])
        redis.call('RENAME', KEYS[2], KEYS[4])
        return 1
      end
      return 0
    `;

    const canSync = await this.redis.eval(script, 4, usageKey, batchKey, syncKey, syncBatchKey);
    if (canSync !== 1) return;

    await this.processSyncKey(organizationId, syncKey, syncBatchKey);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncUsageToDb(): Promise<void> {
    const GLOBAL_LOCK = '{lock}:global:sync-usage';
    try {
      await (this.redlock as any).using([GLOBAL_LOCK], 60000, async () => {
        this.logger.log('[Cron] Starting distributed usage sync with Redlock...');

        await this.rescueStalledSyncs();

        let keysProcessed = 0;

        for await (const keys of this.scanStreamSafe('{*}:usage')) {
          if (keys.length === 0) continue;

          for (const key of keys) {
            const organizationId = key.split('}')[0].slice(1);
            const batchKey = `{${organizationId}}:usage:batch`;
            const syncKey = `{${organizationId}}:sync`;
            const syncBatchKey = `{${organizationId}}:sync:batch`;
            const canSync = await this.redis.eval(
              `if redis.call('EXISTS', KEYS[1]) == 1 and redis.call('EXISTS', KEYS[2]) == 0 and redis.call('EXISTS', KEYS[3]) == 1 and redis.call('EXISTS', KEYS[4]) == 0 then redis.call('RENAME', KEYS[1], KEYS[2]); redis.call('RENAME', KEYS[3], KEYS[4]); return 1 end; return 0`,
              4,
              key,
              syncKey,
              batchKey,
              syncBatchKey,
            );
            if (!canSync) continue;

            await this.processSyncKey(organizationId, syncKey, syncBatchKey);
            keysProcessed++;
          }
        }

        this.logger.log(`[Cron] Distributed usage sync phase complete. Processed ${keysProcessed} batches.`);
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'ExecutionError') {
        this.logger.debug('[Cron] Another instance is already syncing usage, skipping...');
      } else {
        this.logger.error('[Cron] Usage sync failure:', err);
      }
    }
  }

  private async rescueStalledSyncs() {
    for await (const keys of this.scanStreamSafe('{*}:sync')) {
      for (const syncKey of keys) {
        const organizationId = syncKey.split('}')[0].slice(1);
        this.logger.warn(`[Cron] Rescuing stalled sync for Org ${organizationId}`);
        await this.processSyncKey(organizationId, syncKey, `{${organizationId}}:sync:batch`);
      }
    }
  }

  private async processSyncKey(organizationId: string, syncKey: string, syncBatchKey: string) {
    const LOCK_KEY = `{${organizationId}}:lock:sync`;

    try {
      // Use Redlock for high-availability distributed consensus
      await (this.redlock as any).using([LOCK_KEY], 30000, async () => {
        let usage = 0;
        let batchId: string | null = null;
        let dbCommitted = false;
        try {
          const usageRaw = await this.redis.get(syncKey);
          usage = parseFloat(usageRaw || '0');
          batchId = await this.redis.get(syncBatchKey);

          if (usage <= 0) {
            await this.redis.del(syncKey, syncBatchKey);
            return;
          }

          if (!batchId) throw new Error(`Missing durable quota batch ID for ${organizationId}`);
          const durableBatchId = batchId;

          const contentDigest = createHash('sha256')
            .update(`${organizationId}|${durableBatchId}|usage|${usage}`)
            .digest('hex');

          // Ledger insert and quota mutation share one DB transaction. The
          // unique batch ID makes replay after a crash a database no-op.
          const [updated] = await this.db.transaction(async (trx) => {
            const [existing] = await trx
              .select()
              .from(schema.quotaUsageLedger)
              .where(eq(schema.quotaUsageLedger.batchId, durableBatchId))
              .limit(1);

            if (existing) {
              if (
                existing.organizationId !== organizationId ||
                Number(existing.amount) !== usage ||
                existing.contentDigest !== contentDigest
              ) {
                throw new Error(`Quota batch mismatch requires manual review: ${durableBatchId}`);
              }
              return await trx
                .select({ quotaBalance: organizations.quotaBalance })
                .from(organizations)
                .where(eq(organizations.id, organizationId))
                .limit(1);
            }

            await (trx.insert(schema.quotaUsageLedger) as any).values({
              id: randomUUID(),
              organizationId,
              batchId: durableBatchId,
              amount: String(usage),
              usageCategory: 'mixed',
              sourceWindow: durableBatchId,
              contentDigest,
              status: 'applied',
            });

            return await trx
              .update(organizations)
              .set({
                quotaBalance: sql`GREATEST(${organizations.quotaBalance} - ${usage}, -10000)`,
                quotaUsed: sql`${organizations.quotaUsed} + ${usage}`,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(organizations.id, organizationId))
              .returning({ quotaBalance: organizations.quotaBalance });
          });
          dbCommitted = true;

          if (updated && parseFloat(updated.quotaBalance) === -10000) {
            this.logger.warn(`[Cron] Org ${organizationId} hit the negative quota overdraft limit (-10000).`);
            this.overdraftCounter.inc();
          }

          // 2. Success! Delete the temporary sync key
          await this.redis.del(syncKey, syncBatchKey);

          // 3. Bust the limit cache to force re-hydration
          await this.redis.del(`{${organizationId}}:limit`);
        } catch (err) {
          if (dbCommitted) {
            // Never reclaim after the ledger/quota transaction committed. The
            // sync keys remain the rescue source if Redis cleanup failed, and
            // the unique ledger batch makes the next attempt a no-op.
            this.logger.error(
              `[Cron] Quota batch ${batchId ?? 'unknown'} committed but Redis acknowledgement failed; leaving sync keys for rescue.`,
              err,
            );
            return;
          }

          this.logger.error(`[Cron] Failed to sync usage for Org ${organizationId}. Reclaiming usage to Redis.`, err);
          // FAILED: Move the usage back to the main bucket so it's not lost
          try {
            await this.redis.incrbyfloat(`{${organizationId}}:usage`, usage);
            await this.redis.set(`{${organizationId}}:usage:batch`, batchId || randomUUID(), 'EX', 604800, 'NX');
            await this.redis.del(syncKey, syncBatchKey);
          } catch (redisErr) {
            this.logger.error(`[Cron] Critical failure during usage reclamation for Org ${organizationId}`, redisErr);
          }
        }
      });
    } catch {
      this.logger.debug(`[Cron] Could not acquire Redlock for Org ${organizationId}, skipping...`);
    }
  }
}
