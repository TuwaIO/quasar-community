import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { constructWebhookPayload } from '@tuwaio/shared/utils';
import { Job, Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema/index';

@Processor('{webhook-retry}')
export class WebhookRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookRetryProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @InjectQueue('{webhook-delivery}') private readonly deliveryQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ organizationId: string }>): Promise<void> {
    const { organizationId } = job.data;

    this.logger.log(`[WebhookRetry] Starting automated retry for Organization ${organizationId}`);

    // 1. Get all apps for this organization
    const orgApps = await this.db.query.apps.findMany({
      where: eq(schema.apps.organizationId, organizationId),
      columns: { id: true },
    });

    const appIds = orgApps.map((a) => a.id);
    if (appIds.length === 0) return;

    // 2. Get all endpoints for these apps
    const endpoints = await this.db.query.webhookEndpoints.findMany({
      where: inArray(schema.webhookEndpoints.appId, appIds),
    });

    if (endpoints.length === 0) return;
    const endpointMap = new Map(endpoints.map((ep) => [ep.id, ep]));
    const endpointIds = Array.from(endpointMap.keys());

    // 3. Find failed deliveries
    const failedDeliveries = await this.db.query.webhookDeliveries.findMany({
      where: and(
        inArray(schema.webhookDeliveries.endpointId, endpointIds),
        eq(schema.webhookDeliveries.success, false),
      ),
    });

    // 4. Find successful deliveries to avoid re-delivering ones that already succeeded
    const successfulDeliveries = await this.db.query.webhookDeliveries.findMany({
      where: and(inArray(schema.webhookDeliveries.endpointId, endpointIds), eq(schema.webhookDeliveries.success, true)),
      columns: { txKey: true, endpointId: true },
    });

    const successSet = new Set(successfulDeliveries.map((d) => `${d.endpointId}:${d.txKey}`));

    // 5. Filter out already successful ones and deduplicate by txKey+endpointId
    const toRetry = new Map<string, (typeof failedDeliveries)[0]>();

    for (const delivery of failedDeliveries) {
      const key = `${delivery.endpointId}:${delivery.txKey}`;
      if (!successSet.has(key)) {
        toRetry.set(key, delivery);
      }
    }

    if (toRetry.size === 0) {
      this.logger.log(`[WebhookRetry] No pending failed webhooks to retry for Organization ${organizationId}`);
      return;
    }

    this.logger.log(`[WebhookRetry] Found ${toRetry.size} webhooks to retry for Organization ${organizationId}`);

    // 6. Enqueue each failed webhook with strict tenant isolation
    for (const delivery of toRetry.values()) {
      const endpoint = endpointMap.get(delivery.endpointId);
      if (!endpoint || endpoint.isActive === false) {
        this.logger.warn(`[WebhookRetry] Endpoint ${delivery.endpointId} missing or inactive. Skipping retry.`);
        continue;
      }

      // Strict tenant-scoped transaction lookup (WEB-02):
      // Must be scoped by txKey AND appId AND ownerId (organizationId) to prevent cross-tenant collisions
      const tx = await this.db.query.transactions.findFirst({
        where: and(
          eq(schema.transactions.txKey, delivery.txKey),
          eq(schema.transactions.appId, endpoint.appId),
          eq(schema.transactions.ownerId, organizationId),
        ),
      });

      if (!tx) {
        this.logger.warn(
          `[WebhookRetry] Transaction ${delivery.txKey} not found for Org ${organizationId} and App ${endpoint.appId}. Skipping retry.`,
        );
        continue;
      }

      let originalAction = tx.status;
      if (typeof delivery.requestPayload === 'object' && delivery.requestPayload !== null) {
        originalAction = (delivery.requestPayload as any).action || tx.status;
      }

      const webhookPayload = constructWebhookPayload(tx, originalAction ?? undefined);

      const queue = this.deliveryQueue;
      const jobData = {
            endpoint: {
              id: endpoint.id,
              url: endpoint.url,
              signingSecret: endpoint.signingSecret,
              organizationId,
              appId: endpoint.appId,
            },
            payload: webhookPayload,
            txKey: delivery.txKey,
            txType: delivery.eventType,
            appId: endpoint.appId,
            organizationId,
          };

      await queue.add('deliver-webhook', jobData, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      });
    }

    this.logger.log(`[WebhookRetry] Successfully enqueued ${toRetry.size} webhooks for Organization ${organizationId}`);
  }
}
