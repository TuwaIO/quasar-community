import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redlock from 'redlock';

import { REDLOCK } from '../redis/redis.constants';
import { DRIZZLE } from './database.constants';
import type * as schema from './schema/index';

@Injectable()
export class PartitionManagerService implements OnModuleInit {
  private readonly logger = new Logger(PartitionManagerService.name);
  private readonly ALLOWED_TABLES = ['transactions', 'webhook_deliveries'];

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDLOCK) private readonly redlock: Redlock,
  ) {}

  async onModuleInit() {
    // Run on startup, but with a small delay to ensure DB is ready
    setTimeout(() => this.ensurePartitions(), 5000);
  }

  /**
   * Automatically ensure partitions exist for the current and next month.
   * Uses Redlock to ensure only one instance performs the check.
   */
  async ensurePartitions() {
    const LOCK_KEY = 'lock:global:partition-manager';

    try {
      await (this.redlock as any).using([LOCK_KEY], 30000, async () => {
        this.logger.log('[PartitionManager] Checking and creating future partitions...');

        const now = new Date();
        const targetDates = [
          new Date(now.getFullYear(), now.getMonth(), 1), // Current month
          new Date(now.getFullYear(), now.getMonth() + 1, 1), // Next month
          new Date(now.getFullYear(), now.getMonth() + 2, 1), // Month after next
        ];

        for (const table of this.ALLOWED_TABLES) {
          for (const startDate of targetDates) {
            await this.createPartitionForMonth(table, startDate);
          }
        }

        this.logger.log('[PartitionManager] Partition check complete.');
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'ExecutionError') {
        this.logger.debug('[PartitionManager] Another instance is already managing partitions.');
      } else {
        this.logger.error('[PartitionManager] Critical error during partition management:', err);
      }
    }
  }

  private async createPartitionForMonth(table: string, startDate: Date) {
    if (!this.ALLOWED_TABLES.includes(table)) {
      throw new Error(`Table ${table} is not allowed for partitioning`);
    }

    const year = startDate.getFullYear();
    const month = (startDate.getMonth() + 1).toString().padStart(2, '0');
    const partitionName = `${table}_y${year}_m${month}`;

    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    try {
      // PL/pgSQL block with quote_ident for safe dynamic SQL execution
      await this.db.execute(
        sql.raw(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_class c 
            JOIN pg_namespace n ON n.oid = c.relnamespace 
            WHERE c.relname = quote_ident('${partitionName}')
          ) THEN
            EXECUTE format(
              'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
              '${partitionName}',
              '${table}',
              '${startStr}',
              '${endStr}'
            );
          END IF;
        END $$;
      `),
      );

      this.logger.debug(`[PartitionManager] Ensured partition ${partitionName} exists.`);
    } catch (err) {
      this.logger.error(`[PartitionManager] Failed to create partition ${partitionName}:`, err);
    }
  }
}
