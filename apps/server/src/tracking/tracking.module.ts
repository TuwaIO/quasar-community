import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getToken, makeCounterProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';

import {
  PULSAR_ACTIVE_TRACKERS_METRIC,
  PULSAR_SYNC_LAG_METRIC,
  PULSAR_TX_COUNT_METRIC,
  PULSAR_TX_ERROR_METRIC,
} from '../constants';
import { DatabaseModule } from '../database/database.module';
import { AmlService } from './aml.service';
import { RouterService } from './router.service';
import { TrackingService } from './tracking.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    BullModule.registerQueue({ name: '{webhook-delivery}' }),
  ],
  providers: [
    TrackingService,
    WebhookDispatcherService,
    RouterService,
    AmlService,
    makeGaugeProvider({
      name: PULSAR_SYNC_LAG_METRIC,
      help: 'Lag between block timestamp and tracking time in seconds',
      labelNames: ['ecosystem', 'chainId'],
    }),
    makeCounterProvider({
      name: PULSAR_TX_COUNT_METRIC,
      help: 'Total number of transactions tracked',
      labelNames: ['ecosystem', 'chainId', 'status'],
    }),
    makeCounterProvider({
      name: PULSAR_TX_ERROR_METRIC,
      help: 'Total number of transaction tracking failures',
      labelNames: ['ecosystem', 'chainId', 'appId'],
    }),
    makeGaugeProvider({
      name: PULSAR_ACTIVE_TRACKERS_METRIC,
      help: 'Number of currently active transaction trackers',
    }),
  ],
  exports: [TrackingService, WebhookDispatcherService, RouterService, AmlService, getToken(PULSAR_TX_COUNT_METRIC)],
})
export class TrackingModule {}
