import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { bullRootOptions } from '../common/bullmq-connection.factory';
import { WebhookRelayController } from './webhook-relay.controller';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: bullRootOptions,
      inject: [ConfigService],
    }),
  ],
  controllers: [
  WebhookRelayController,
],
})
export class WebhooksModule {}
