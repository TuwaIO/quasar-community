import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';

/** Canonical set of job scheduler IDs managed by this service. */
const KNOWN_SCHEDULER_IDS = new Set(['unique-outbox-processor-job', 'unique-outbox-cleanup-job']);

@Injectable()
export class OutboxInitializerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OutboxInitializerService.name);

  constructor(@InjectQueue('{outbox}') private readonly outboxQueue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.pruneStaleSchedulers();

    await this.outboxQueue.upsertJobScheduler(
      'unique-outbox-processor-job',
      { every: 5000 },
      { name: 'process-events', data: {} },
    );
    await this.outboxQueue.upsertJobScheduler(
      'unique-outbox-cleanup-job',
      { pattern: '0 0 * * *' },
      { name: 'cleanup-events', data: {} },
    );
  }

  /**
   * Removes all job schedulers from the outbox queue that are not in
   * {@link KNOWN_SCHEDULER_IDS}. This prevents stale `bull:{outbox}:repeat:*`
   * hashes from accumulating in Redis indefinitely (TTL = -1).
   *
   * BullMQ does not auto-expire orphaned repeat keys when a scheduler is
   * replaced via `upsertJobScheduler`, so each deploy adds new keys without
   * removing old ones. Over time this produces tens of thousands of dead keys
   * that drive Redis memory pressure.
   */
  private async pruneStaleSchedulers(): Promise<void> {
    try {
      const schedulers = await this.outboxQueue.getJobSchedulers(0, -1);
      const stale = schedulers.filter((s) => !KNOWN_SCHEDULER_IDS.has(s.key));

      if (stale.length === 0) return;

      this.logger.log(`[OutboxInit] Pruning ${stale.length} stale job scheduler(s) from Redis...`);

      await Promise.all(stale.map((s) => this.outboxQueue.removeJobScheduler(s.key)));

      this.logger.log('[OutboxInit] Stale schedulers pruned successfully.');
    } catch (err) {
      // Non-fatal: log and continue. The queue will still work correctly.
      this.logger.warn(`[OutboxInit] Failed to prune stale schedulers: ${err}`);
    }
  }
}
