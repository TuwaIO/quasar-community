import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Queue } from 'bullmq';
import { Gauge } from 'prom-client';
import Redlock from 'redlock';

import { QUEUE_HEALTH_METRIC } from '../constants';
import { REDLOCK } from '../redis/redis.constants';

@Injectable()
export class QueueHealthCronService {
  private readonly logger = new Logger(QueueHealthCronService.name);

  constructor(
    @InjectQueue('{tracking-fast}') private readonly fastQueue: Queue,
    @InjectQueue('{tracking-lazy}') private readonly lazyQueue: Queue,
    @InjectQueue('{webhook-delivery}') private readonly webhooksQueue: Queue,
    @InjectQueue('{aml-screening}') private readonly amlQueue: Queue,
    @InjectQueue('{outbox}') private readonly outboxQueue: Queue,
    @InjectMetric(QUEUE_HEALTH_METRIC) private readonly queueGauge: Gauge<string>,
    @Inject(REDLOCK) private readonly redlock: Redlock,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async logQueueStats() {
    const lockKey = 'lock:queue-health-monitor';
    const lock = await this.redlock.acquire([lockKey], 45000).catch(() => null);

    if (!lock) {
      return;
    }

    try {
      const [fastStats, lazyStats, webhooksStats, amlStats, outboxStats] = await Promise.all([
        this.getQueueStats(this.fastQueue),
        this.getQueueStats(this.lazyQueue),
        this.getQueueStats(this.webhooksQueue),
        this.getQueueStats(this.amlQueue),
        this.getQueueStats(this.outboxQueue),
      ]);

      const statsMap = [
        { name: 'tracking-fast', stats: fastStats },
        { name: 'tracking-lazy', stats: lazyStats },
        { name: 'webhook-delivery', stats: webhooksStats },
        { name: 'aml-screening', stats: amlStats },
        { name: 'outbox', stats: outboxStats },
      ];

      for (const { name, stats } of statsMap) {
        this.queueGauge.set({ queueName: name, status: 'waiting' }, stats.waiting);
        this.queueGauge.set({ queueName: name, status: 'active' }, stats.active);
        this.queueGauge.set({ queueName: name, status: 'failed' }, stats.failed);
        this.queueGauge.set({ queueName: name, status: 'delayed' }, stats.delayed);

        this.logger.debug(
          `Queue Health | Name: ${name} | Waiting: ${stats.waiting} | Active: ${stats.active} | Failed: ${stats.failed} | Delayed: ${stats.delayed}`,
        );
      }
    } finally {
      if (lock) {
        // @ts-expect-error: @types/redlock@4 defines unlock(), but runtime redlock@5-beta uses release()
        await lock.release().catch(() => null);
      }
    }
  }

  private async getQueueStats(queue: Queue) {
    const [waiting, active, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    return { waiting, active, failed, delayed };
  }
}
