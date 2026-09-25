import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueOptions } from 'bullmq';

import { createBullMQConnection } from '../common/bullmq-connection.factory';
import { WebhookRelayController } from './webhook-relay.controller';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): QueueOptions => ({
        connection: createBullMQConnection(configService) as unknown as QueueOptions['connection'],
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
  WebhookRelayController,
],
})
export class WebhooksModule {}
