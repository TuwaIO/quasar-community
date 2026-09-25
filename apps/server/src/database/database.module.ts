import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { DRIZZLE, DRIZZLE_READ } from './database.constants';
import { PartitionManagerService } from './partition-manager.service';
import * as schema from './schema/index';
export { DRIZZLE, DRIZZLE_READ };

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: async (configService: ConfigService) => {
        const connectionString = configService.get<string>('DATABASE_URL');
        const pool = new Pool({
          connectionString,
          max: configService.get<number>('DATABASE_POOL_MAX') || 5,
          connectionTimeoutMillis: configService.get<number>('DATABASE_POOL_TIMEOUT') || 5000,
          idleTimeoutMillis: configService.get<number>('DATABASE_POOL_IDLE_TIMEOUT') || 10000,
        });
        return drizzle(pool, { schema });
      },
      inject: [ConfigService],
    },
    {
      provide: DRIZZLE_READ,
      useFactory: async (configService: ConfigService) => {
        const connectionString =
          configService.get<string>('DATABASE_URL_READ') || configService.get<string>('DATABASE_URL');
        const pool = new Pool({
          connectionString,
          max: configService.get<number>('DATABASE_POOL_MAX_READ') || 8,
          connectionTimeoutMillis: configService.get<number>('DATABASE_POOL_TIMEOUT') || 5000,
          idleTimeoutMillis: configService.get<number>('DATABASE_POOL_IDLE_TIMEOUT') || 10000,
        });
        return drizzle(pool, { schema });
      },
      inject: [ConfigService],
    },
    PartitionManagerService,
  ],
  exports: [DRIZZLE, DRIZZLE_READ, PartitionManagerService],
})
export class DatabaseModule {}
