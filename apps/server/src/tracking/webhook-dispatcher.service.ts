import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { TransactionStatus } from '@tuwaio/pulsar-core';
import { constructWebhookPayload, WebhookPayload } from '@tuwaio/shared/utils';
import { Queue } from 'bullmq';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema/index';

type DbTransaction = typeof schema.transactions.$inferSelect;

interface WebhookEndpointInfo {
  id: string;
  url: string;
  signingSecret: string;
  organizationId: string;
  isSystemWebhook: boolean;
}

// Interface imported from @tuwaio/shared/utils

@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @InjectQueue('{webhook-delivery}') private readonly webhookQueue: Queue,
  ) {}

  private async fetchMatchingEndpoints(appId: string, action: string, txType: string): Promise<WebhookEndpointInfo[]> {
    try {
      const endpoints = await this.db
        .select({
          id: schema.webhookEndpoints.id,
          url: schema.webhookEndpoints.url,
          signingSecret: schema.webhookEndpoints.signingSecret,
          txType: schema.webhookEndpoints.txType,
          organizationId: schema.apps.organizationId,
          isSystemWebhook: schema.webhookEndpoints.isSystemWebhook,
        })
        .from(schema.webhookEndpoints)
        .innerJoin(schema.apps, eq(schema.webhookEndpoints.appId, schema.apps.id))
        .where(
          and(
            eq(schema.webhookEndpoints.appId, appId),
            eq(schema.webhookEndpoints.isActive, true),
            // Four ways to say "this endpoint wants this transaction":
            // the exact type, the `*` wildcard the admin now writes by
            // default, and the two legacy encodings of "unfiltered" that
            // predate it. NULL needs `isNull` rather than `= ''` — a bare
            // equality is never true against NULL, which is precisely why
            // endpoints saved with the field left blank used to receive
            // nothing at all.
            or(
              eq(schema.webhookEndpoints.txType, txType),
              eq(schema.webhookEndpoints.txType, '*'),
              eq(schema.webhookEndpoints.txType, ''),
              isNull(schema.webhookEndpoints.txType),
            ),
          ),
        );

      const endpointIds = endpoints.map((e) => e.id);
      if (endpointIds.length === 0) return [];

      const eventRows = await this.db
        .select()
        .from(schema.webhookEndpointsEvents)
        .where(
          and(
            or(...endpointIds.map((id) => eq(schema.webhookEndpointsEvents.parentId, id))),
            or(
              sql`${schema.webhookEndpointsEvents.value} = '*'`,
              sql`${schema.webhookEndpointsEvents.value} = ${'transaction:' + action.toLowerCase()}`,
            ),
          ),
        );

      const matchedIds = new Set(eventRows.map((e) => e.parentId));

      return endpoints
        .filter((e) => matchedIds.has(e.id))
        .map((e) => ({
          id: e.id,
          url: e.url,
          signingSecret: e.signingSecret,
          organizationId: e.organizationId,
          isSystemWebhook: Boolean(e.isSystemWebhook),
        }));
    } catch (err) {
      this.logger.error('[Webhook Dispatcher] Error fetching endpoints:', err);
      return [];
    }
  }

  async dispatchTerminalWebhook(tx: DbTransaction, finalStatus: TransactionStatus): Promise<void> {
    const action = finalStatus;
    const txType = tx.type;

    if (!txType) {
      this.logger.warn(`[Webhook Dispatcher] No tx.type for ${tx.txKey}, skipping dispatch.`);
      return;
    }

    const appId = tx.appId ?? undefined;

    if (!appId) {
      this.logger.warn(`[Webhook Dispatcher] Could not resolve appId for tx ${tx.txKey}, skipping dispatch.`);
      return;
    }

    const endpoints = await this.fetchMatchingEndpoints(appId, action, txType);
    if (endpoints.length === 0) return;

    const webhookPayload: WebhookPayload = constructWebhookPayload(tx, action);

    const externalEndpoints = endpoints;

    // Enqueue external deliveries with exponential backoff.
    await Promise.all(
      externalEndpoints.map((endpoint) =>
        this.webhookQueue.add(
          'delivery',
          {
            endpoint,
            payload: webhookPayload,
            txKey: tx.txKey,
            txType,
            appId,
            organizationId: endpoint.organizationId,
          },
          {
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 60000, // Start with 60s (1m)
            },
            removeOnComplete: { count: 100, age: 3600 },
            removeOnFail: { count: 500, age: 86400 }, // Keep last 500 failures for up to 24h
          },
        ),
      ),
    );

    if (externalEndpoints.length > 0) {
      this.logger.log(`[Webhook Dispatcher] Enqueued ${externalEndpoints.length} delivery jobs for tx ${tx.txKey}`);
    }
  }
}
