import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { TransactionStatus } from '@tuwaio/pulsar-core';
import { Job, Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE } from '../database/database.constants';
import * as schema from '../database/schema/index';
import { AmlService } from '../tracking/aml.service';
import { RouterService } from '../tracking/router.service';
import { WebhookDispatcherService } from '../tracking/webhook-dispatcher.service';

interface TrackingJobData {
  appId: string;
  ownerId: string;
  txKey: string;
}

@Processor('{tracking-fast}', {
  concurrency: parseInt(process.env.TRACKING_FAST_CONCURRENCY || '25', 10),
})
export class TrackingFastProcessor extends WorkerHost {
  private readonly logger = new Logger(TrackingFastProcessor.name);

  constructor(
    private readonly routerService: RouterService,
    @InjectQueue('{tracking-lazy}') private readonly lazyQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<TrackingJobData>): Promise<void> {
    const { appId, ownerId, txKey } = job.data;
    this.logger.log(`[TrackingWorker][fast] Phase 1: Processing tx: ${txKey} (appId: ${appId})`);

    try {
      await this.routerService.checkAndInitializeTrackerInWorker(appId, txKey);
    } catch (err) {
      this.logger.error(`[TrackingWorker][fast] Phase 1 failed for ${txKey}:`, err);
      throw err;
    } finally {
      this.logger.log(`[TrackingWorker][fast] Phase 1 finished for ${txKey}. Scheduling Phase 2 (lazy) fallback.`);
      await this.lazyQueue.add(
        'process-tx',
        { appId, ownerId, txKey },
        {
          jobId: `${appId}-${txKey}`,
          delay: 10000, // Phase 2 starts 10s after Phase 1 completion
          removeOnComplete: true,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 60000,
          },
        },
      );
    }
  }
}

@Processor('{tracking-lazy}', {
  concurrency: parseInt(process.env.TRACKING_LAZY_CONCURRENCY || '15', 10),
})
export class TrackingLazyProcessor extends WorkerHost {
  private readonly logger = new Logger(TrackingLazyProcessor.name);

  constructor(private readonly routerService: RouterService) {
    super();
  }

  async process(job: Job<TrackingJobData>): Promise<void> {
    const { appId, txKey } = job.data;
    this.logger.log(`[TrackingWorker][lazy] Processing tx: ${txKey} (appId: ${appId})`);
    await this.routerService.checkAndInitializeTrackerInWorker(appId, txKey);
  }
}

interface AmlJobData {
  appId: string;
  ownerId: string;
  fromAddress: string;
  chainId: string;
  txKey: string;
  customApiKey?: string | null;
  customApiSecret?: string | null;
}

@Processor('{aml-screening}', { concurrency: 10 })
export class AmlProcessor extends WorkerHost {
  private readonly logger = new Logger(AmlProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly amlService: AmlService,
    private readonly webhookDispatcher: WebhookDispatcherService,
  ) {
    super();
  }

  async process(job: Job<AmlJobData>): Promise<void> {
    const { appId, ownerId, fromAddress, chainId, txKey, customApiKey, customApiSecret } = job.data;
    this.logger.log(`[AMLWorker] Starting AML check for txKey: ${txKey} (appId: ${appId})`);

    try {
      const result = await this.amlService.checkAml(fromAddress, chainId, customApiKey, customApiSecret);

      const amlStatus = result.isHighRisk ? 'flagged' : 'passed';
      const riskScore = result.isHighRisk ? '100' : '0';

      this.logger.log(
        `[AMLWorker] AML check completed for txKey ${txKey}: status=${amlStatus}, highRisk=${result.isHighRisk}`,
      );

      const [updatedTx] = await this.db
        .update(schema.transactions)
        .set({
          amlStatus,
          amlRiskScore: riskScore,
          amlProviderData: result,
        })
        .where(
          and(
            eq(schema.transactions.appId, appId),
            eq(schema.transactions.ownerId, ownerId),
            eq(schema.transactions.txKey, txKey),
          ),
        )
        .returning();

      if (updatedTx && !updatedTx.pending) {
        const finalStatus = updatedTx.status as TransactionStatus;
        await this.webhookDispatcher.dispatchTerminalWebhook(updatedTx, finalStatus);
      }
    } catch (err) {
      this.logger.error(`[AMLWorker] Error in AML check for txKey ${txKey}:`, err);
      const [updatedTx] = await this.db
        .update(schema.transactions)
        .set({
          amlStatus: 'failed',
          amlProviderData: { error: err instanceof Error ? err.message : String(err) },
        })
        .where(
          and(
            eq(schema.transactions.appId, appId),
            eq(schema.transactions.ownerId, ownerId),
            eq(schema.transactions.txKey, txKey),
          ),
        )
        .returning();

      if (updatedTx && !updatedTx.pending) {
        const finalStatus = updatedTx.status as TransactionStatus;
        await this.webhookDispatcher.dispatchTerminalWebhook(updatedTx, finalStatus);
      }
    }
  }
}
