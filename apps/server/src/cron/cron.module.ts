import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { makeCounterProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';
import { QueueOptions } from 'bullmq';

import { createBullMQConnection } from '../common/bullmq-connection.factory';
import { SecretRotationService } from '../common/secret-rotation.service';
import { QUEUE_HEALTH_METRIC } from '../constants';
import { DatabaseModule } from '../database/database.module';
import { OutboxInitializerService } from './outbox-initializer.service';
import { OutboxProcessorService } from './outbox-processor.service';
import { PartitionCronService } from './partition-cron.service';
import { PendingTxSweeperService } from './pending-tx-sweeper.service';
import { QueueHealthCronService } from './queue-health-cron.service';
import { RedisCleanupService } from './redis-cleanup.service';
import { SyncUsageService } from './sync-usage.service';

const isWorker = process.env.ENABLE_WORKERS !== 'false';

const providers: any[] = [
  SyncUsageService,
  SecretRotationService,
  makeGaugeProvider({
    name: QUEUE_HEALTH_METRIC,
    help: 'Current number of tasks in queues',
    labelNames: ['queueName', 'status'],
  }),
  makeCounterProvider({
    name: 'quota_negative_overdraft_limit_reached_total',
    help: 'Total number of times organizations hit the negative quota overdraft limit',
  }),
];

if (isWorker) {
  providers.push(
    OutboxProcessorService,
    OutboxInitializerService,
    RedisCleanupService,
    PartitionCronService,
    QueueHealthCronService,
    PendingTxSweeperService,
  );
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): QueueOptions => ({
        connection: createBullMQConnection(configService) as unknown as QueueOptions['connection'],
        defaultJobOptions: {
          // Auto-clean completed and failed jobs to prevent Redis memory accumulation.
          // Per-job overrides will take precedence over these defaults.
          removeOnComplete: { count: 100, age: 3600 },
          removeOnFail: { count: 500, age: 86400 },
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: '{outbox}' },
      { name: '{tracking-fast}' },
      { name: '{tracking-lazy}' },
      { name: '{webhook-delivery}' },
      { name: '{webhook-retry}' },
      { name: '{aml-screening}' },
    ),
    DatabaseModule,
  ],
  providers,
  exports: [SecretRotationService, SyncUsageService],
})
export class CronModule {}
