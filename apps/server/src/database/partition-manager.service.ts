import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createPartitionSql, monthlyPartition, type PartitionedTable } from '@tuwaio/shared/partitions';
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

        // Calendar months in UTC, the time zone PostgreSQL reads the date bounds in. With local months a process east
        // of UTC wrote every bound a day early, and after a time zone change a new partition overlapped the last one
        // and was not created.
        const now = new Date();
        const targetDates = [
          new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), // Current month
          new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)), // Next month
          new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1)), // Month after next
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

    const partition = monthlyPartition(table as PartitionedTable, startDate);
    const partitionName = partition.name;

    try {
      await this.db.execute(sql.raw(createPartitionSql(partition)));

      this.logger.debug(`[PartitionManager] Ensured partition ${partitionName} exists.`);
    } catch (err) {
      this.logger.error(`[PartitionManager] Failed to create partition ${partitionName}:`, err);
    }
  }
}
