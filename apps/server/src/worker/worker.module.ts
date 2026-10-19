import { BullModule } from '@nestjs/bullmq';
import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { makeCounterProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';

import { bullRootOptions } from '../common/bullmq-connection.factory';
import { WEBHOOK_DELIVERY_METRIC, WEBHOOK_LATENCY_METRIC } from '../constants';
import { TrackingModule } from '../tracking/tracking.module';
import { AmlProcessor, TrackingFastProcessor, TrackingLazyProcessor } from './tracking-worker.service';
import { WebhookProcessor } from './webhook.processor';
import { WebhookRetryProcessor } from './webhook-retry.processor';

const isWorker = process.env.ENABLE_WORKERS !== 'false';

const providers: Provider[] = [
  makeCounterProvider({
    name: WEBHOOK_DELIVERY_METRIC,
    help: 'Total number of webhook deliveries',
    labelNames: ['status'],
  }),
  makeHistogramProvider({
    name: WEBHOOK_LATENCY_METRIC,
    help: 'Latency of webhook deliveries in seconds',
    labelNames: ['status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  }),
];

if (isWorker) {
  providers.push(TrackingFastProcessor, TrackingLazyProcessor, AmlProcessor, WebhookProcessor, WebhookRetryProcessor);
}

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: bullRootOptions,
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: '{tracking-fast}' },
      { name: '{tracking-lazy}' },
      { name: '{webhook-delivery}' },
      { name: '{webhook-retry}' },
      { name: '{aml-screening}' },
    ),
    TrackingModule,
  ],
  providers,
  exports: [BullModule],
})
export class WorkerModule {}
