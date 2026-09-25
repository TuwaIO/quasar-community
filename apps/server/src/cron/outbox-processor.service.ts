import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { and, eq, isNull, lt, lte, or } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';

import { DRIZZLE } from '../database/database.constants';
import * as schema from '../database/schema/index';
import { REDIS } from '../redis/redis.module';

interface SyncRedisQuotaPayload {
  organizationId?: string;
  quotaToAdd?: number;
  newRps?: number;
  newBalance?: number;
}

@Processor('{outbox}')
export class OutboxProcessorService extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessorService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue('{webhook-retry}') private readonly retryQueue: Queue,
  ) {
    super();
  }
  async process(job: Job): Promise<void> {
    if (job.name === 'cleanup-events') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      await this.db
        .delete(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.status, 'processed'),
            lt(schema.outboxEvents.updatedAt, sevenDaysAgo.toISOString()),
          ),
        );
      this.logger.log('[OutboxProcessor] Cleanup job completed: removed processed events older than 7 days.');
      return;
    }

    const pendingEvents = await this.db
      .select({
        id: schema.outboxEvents.id,
        eventType: schema.outboxEvents.eventType,
        payload: schema.outboxEvents.payload,
        attempts: schema.outboxEvents.attempts,
      })
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.status, 'pending'),
          or(
            isNull(schema.outboxEvents.nextAttemptAt),
            lte(schema.outboxEvents.nextAttemptAt, new Date().toISOString()),
          ),
        ),
      )
      .limit(20); // Process in batches

    if (pendingEvents.length === 0) return;

    this.logger.log(`[OutboxProcessor] Processing ${pendingEvents.length} pending event(s).`);

    for (const event of pendingEvents) {
      try {
        if (event.eventType === 'sync-redis-quota') {
          const data = event.payload as SyncRedisQuotaPayload;
          const { organizationId, quotaToAdd, newRps } = data;

          if (organizationId) {
            // 1. Bust the Iron Dome RPS limit cache for the whole organization
            await this.redis.del(`{${organizationId}}:limit`);
            this.logger.log(`[OutboxProcessor] Busted Iron Dome cache: {${organizationId}}:limit`);

            // 2. Fetch all apps for this organization to update their individual redis caches
            const orgApps = await this.db
              .select({
                id: schema.apps.id,
                secretKeyHash: schema.apps.secretKeyHash,
                publicKey: schema.apps.publicKey,
              })
              .from(schema.apps)
              .where(eq(schema.apps.organizationId, organizationId));

            for (const app of orgApps) {
              await this.syncAppRedis(
                app.secretKeyHash,
                app.publicKey,
                app.id,
                quotaToAdd || 0,
                organizationId,
                newRps,
                true,
              );
            }

            this.logger.log(
              `[OutboxProcessor] Synced Organization ${organizationId} shared quota to ${orgApps.length} app(s). ` +
                `Quota Change: +${quotaToAdd || 0}, New RPS: ${newRps ?? 'unchanged'}`,
            );

            // 3. Trigger webhook retry for the organization since they just received quota
            await this.retryQueue.add('retry-org', { organizationId });
            this.logger.log(`[OutboxProcessor] Triggered {webhook-retry} for Organization ${organizationId}`);
          }
        } else {
          this.logger.warn(`[OutboxProcessor] Unknown eventType: ${event.eventType} — marking as failed.`);
          await this.db
            .update(schema.outboxEvents)
            .set({ status: 'failed' })
            .where(eq(schema.outboxEvents.id, event.id));
          continue;
        }

        // Mark event as processed
        await this.db
          .update(schema.outboxEvents)
          .set({ status: 'processed', updatedAt: new Date().toISOString() })
          .where(eq(schema.outboxEvents.id, event.id));
      } catch (err) {
        this.logger.error(`[OutboxProcessor] Failed to process event ${event.id}:`, err);
        const currentAttempts = typeof event.attempts === 'string' ? parseInt(event.attempts, 10) : event.attempts || 0;
        const attempts = (currentAttempts || 0) + 1;
        let nextAttemptAt: string | null = null;
        let status: 'pending' | 'failed' | 'processed' = 'pending';

        if (attempts === 1)
          nextAttemptAt = new Date(Date.now() + 60000).toISOString(); // 1m
        else if (attempts === 2)
          nextAttemptAt = new Date(Date.now() + 300000).toISOString(); // 5m
        else if (attempts === 3)
          nextAttemptAt = new Date(Date.now() + 3600000).toISOString(); // 1h
        else status = 'failed';

        await this.db
          .update(schema.outboxEvents)
          .set({
            attempts: attempts.toString(),
            nextAttemptAt,
            status,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.outboxEvents.id, event.id));
      }
    }
  }

  private async syncAppRedis(
    secretKeyHash: string | null,
    publicKey: string | null,
    appId: string,
    quotaToAdd: number,
    organizationId?: string,
    newRps?: number,
    silent = false,
  ) {
    const metaSecretKey = secretKeyHash ? `{${secretKeyHash}}:meta` : null;
    const metaPublicKey = publicKey ? `{${publicKey}}:meta` : null;
    const notifiedKey = `{${appId}}:notified_low_quota`;

    // Bust metadata cache so they will re-hydrate on next API request
    if (metaSecretKey) await this.redis.del(metaSecretKey);
    if (metaPublicKey) await this.redis.del(metaPublicKey);

    // Reset low-quota notification flag so user can be re-notified if needed
    await this.redis.del(notifiedKey);

    if (!silent) {
      this.logger.log(
        `[OutboxProcessor] Synced App Quota: Org=${organizationId ?? 'N/A'} — ` +
          `Quota Change: +${quotaToAdd}, New RPS: ${newRps ?? 'unchanged'}`,
      );
    }
  }
}
