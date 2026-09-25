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
        const [completedCleaned, failedCleaned] = await Promise.all([
          // Remove completed jobs older than 1 hour, keep at most 100
          queue.clean(3600 * 1000, 100, 'completed'),
          // Remove failed jobs older than 24 hours, keep at most 500
          queue.clean(86400 * 1000, 500, 'failed'),
        ]);
        const cleaned = completedCleaned.length + failedCleaned.length;
        if (cleaned > 0) {
          this.logger.log(
            `[Redis Cleanup] Queue "${name}": removed ${completedCleaned.length} completed, ${failedCleaned.length} failed`,
          );
          totalCleaned += cleaned;
        }
      } catch (err) {
        // Non-fatal: log and continue to the next queue
        this.logger.warn(`[Redis Cleanup] Failed to clean queue "${name}": ${err}`);
      }
    }

    this.logger.log(`[Redis Cleanup] Hourly BullMQ cleanup done. Total jobs removed: ${totalCleaned}`);
  }

  /**
   * Daily garbage collection of orphaned Iron Dome Redis keys.
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
