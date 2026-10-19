import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';

import { DRIZZLE } from '../database/database.constants';
import { organizations } from '../database/schema';
import { apps } from '../database/schema';
import * as schema from '../database/schema/index';
import { REDIS } from '../redis/redis.module';

/** Jobs removed by one `clean` call: a short Redis script each. */
const CLEAN_BATCH = 1000;
/** Jobs removed from one queue in one run at most: a backlog goes over a few hours, never in one long block. */
const CLEAN_MAX_PER_RUN = 100_000;

@Injectable()
export class RedisCleanupService {
  private readonly logger = new Logger(RedisCleanupService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @InjectQueue('{outbox}') private readonly outboxQueue: Queue,
    @InjectQueue('{tracking-fast}') private readonly fastQueue: Queue,
    @InjectQueue('{tracking-lazy}') private readonly lazyQueue: Queue,
    @InjectQueue('{webhook-delivery}') private readonly webhooksQueue: Queue,
    @InjectQueue('{webhook-retry}') private readonly retryQueue: Queue,
    @InjectQueue('{aml-screening}') private readonly amlQueue: Queue,
  ) {}

  /**
   * Hourly BullMQ job cleanup.
   *
   * Removes stale completed and failed jobs from all queues to prevent
   * Redis memory accumulation between deploys. The global `defaultJobOptions`
   * in BullModule handle new jobs going forward; this cron catches any
   * jobs that slipped through before the policy was applied.
   *
   * `clean(grace, limit)` removes at most `limit` jobs, so it runs in batches of {@link CLEAN_BATCH} until a batch
   * comes back short, up to {@link CLEAN_MAX_PER_RUN} per queue and state: one call of 100 an hour fell behind the
   * outbox processor (720 jobs an hour) and the Redis shard of `{outbox}` filled up (2026-10-19).
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupBullMQOrphans(): Promise<void> {
    this.logger.log('[Redis Cleanup] Starting hourly BullMQ queue cleanup...');

    const queues: Array<{ name: string; queue: Queue }> = [
      { name: 'outbox', queue: this.outboxQueue },
      { name: 'tracking-fast', queue: this.fastQueue },
      { name: 'tracking-lazy', queue: this.lazyQueue },
      { name: 'webhook-delivery', queue: this.webhooksQueue },
      { name: 'webhook-retry', queue: this.retryQueue },
      { name: 'aml-screening', queue: this.amlQueue },
    ];

    let totalCleaned = 0;

    for (const { name, queue } of queues) {
      try {
        // Completed jobs older than an hour, failed ones older than a day
        const completed = await this.drain(queue, 3600 * 1000, 'completed');
        const failed = await this.drain(queue, 86400 * 1000, 'failed');
        const cleaned = completed + failed;
        if (cleaned > 0) {
          this.logger.log(`[Redis Cleanup] Queue "${name}": removed ${completed} completed, ${failed} failed`);
          totalCleaned += cleaned;
        }
      } catch (err) {
        // Non-fatal: log and continue to the next queue
        this.logger.warn(`[Redis Cleanup] Failed to clean queue "${name}": ${err}`);
      }
    }

    this.logger.log(`[Redis Cleanup] Hourly BullMQ cleanup done. Total jobs removed: ${totalCleaned}`);
  }

  /** Removes the jobs of a state older than `grace`, batch after batch; returns how many. */
  private async drain(queue: Queue, grace: number, state: 'completed' | 'failed'): Promise<number> {
    let removed = 0;
    while (removed < CLEAN_MAX_PER_RUN) {
      const batch = await queue.clean(grace, Math.min(CLEAN_BATCH, CLEAN_MAX_PER_RUN - removed), state);
      removed += batch.length;
      if (batch.length < CLEAN_BATCH) break;
    }
    return removed;
  }

  /**
   * Daily garbage collection of orphaned engine guard Redis keys.
   *
   * Removes `{orgId}:limit`, `{orgId}:usage`, and `{appId}:notified_low_quota`
   * keys belonging to deleted organizations/apps that no longer exist in the DB.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupOrphanedKeys(): Promise<void> {
    this.logger.log('[Redis Cleanup] Starting daily garbage collection...');

    let totalDeleted = 0;

    // --- 1. Organization-scoped keys ---
    const orgPatterns = ['{*}:limit', '{*}:usage'];

    for (const pattern of orgPatterns) {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;

        if (keys.length > 0) {
          const orgIds = [...new Set(keys.map((k) => k.split('}')[0].slice(1)))];

          if (orgIds.length === 0) continue;

          const existingOrgs = await this.db
            .select({ id: organizations.id })
            .from(organizations)
            .where(inArray(organizations.id, orgIds));

          const existingIds = new Set(existingOrgs.map((o) => o.id));
          const toDelete = keys.filter((k) => {
            const orgId = k.split('}')[0].slice(1);
            return !existingIds.has(orgId);
          });

          if (toDelete.length > 0) {
            await this.redis.del(...toDelete);
            totalDeleted += toDelete.length;
            this.logger.log(`[Redis Cleanup] Deleted ${toDelete.length} orphaned keys for pattern ${pattern}`);
          }
        }
      } while (cursor !== '0');
    }

    // --- 2. App-scoped notification keys ---
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', '{*}:notified_low_quota', 'COUNT', 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        // Key format: {appId}:notified_low_quota
        const appIds = [...new Set(keys.map((k) => k.split('}')[0].slice(1)))];

        if (appIds.length === 0) continue;

        const existingApps = await this.db.select({ id: apps.id }).from(apps).where(inArray(apps.id, appIds));

        const existingAppIds = new Set(existingApps.map((a) => a.id));
        const toDelete = keys.filter((k) => {
          const appId = k.split('}')[0].slice(1);
          return !existingAppIds.has(appId);
        });

        if (toDelete.length > 0) {
          await this.redis.del(...toDelete);
          totalDeleted += toDelete.length;
          this.logger.log(`[Redis Cleanup] Deleted ${toDelete.length} orphaned notified_low_quota keys`);
        }
      }
    } while (cursor !== '0');

    this.logger.log(`[Redis Cleanup] Garbage collection complete. Total keys removed: ${totalDeleted}`);
  }
}
