import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { makeCounterProvider, makeHistogramProvider, PrometheusModule } from '@willsoto/nestjs-prometheus';

import { InternalGuard } from './common/internal.guard';
import { IronDomeGuard } from './common/iron-dome.guard';
import { PrometheusInterceptor } from './common/prometheus.interceptor';
import { IRON_DOME_BLOCK_METRIC } from './constants';
import { CronModule } from './cron/cron.module';
import { DatabaseModule } from './database/database.module';
import { EngineModule } from './engine/engine.module';
import { InternalController } from './internal/internal.controller';
import { RedisModule } from './redis/redis.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WorkerModule } from './worker/worker.module';

@Module({
  imports: [
  PrometheusModule.register(),
  ConfigModule.forRoot({
      isGlobal: true,
  envFilePath: '../.env',
  expandVariables: true,
  }),
  ScheduleModule.forRoot(),
  SentryModule.forRoot(),
  DatabaseModule,
  RedisModule,
  WebhooksModule,
  WorkerModule,
  CronModule,
  EngineModule,
],
  controllers: [InternalController],
  providers: [
    { provide: APP_GUARD, useClass: IronDomeGuard },
    { provide: APP_GUARD, useClass: InternalGuard },
    {
      provide: APP_INTERCEPTOR,
      useClass: PrometheusInterceptor,
    },
    makeHistogramProvider({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5],
    }),
    makeCounterProvider({
      name: IRON_DOME_BLOCK_METRIC,
      help: 'Total number of requests blocked by Iron Dome',
      labelNames: ['code'],
    }),
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
