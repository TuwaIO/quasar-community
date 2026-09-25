import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueOptions } from 'bullmq';

import { createBullMQConnection } from '../common/bullmq-connection.factory';
import { TrackingModule } from '../tracking/tracking.module';
import { MonitoringController } from './monitoring/monitoring.controller';
import { HistoryController } from './pulsar/history/history.controller';
import { SyncController } from './pulsar/sync/sync.controller';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): QueueOptions => ({
        connection: createBullMQConnection(configService) as unknown as QueueOptions['connection'],
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: '{tracking-fast}' }, { name: '{tracking-lazy}' }, { name: '{aml-screening}' }),
    TrackingModule,
  ],
  controllers: [
  HistoryController,
  SyncController,
  MonitoringController,
],
})
export class EngineModule {}
