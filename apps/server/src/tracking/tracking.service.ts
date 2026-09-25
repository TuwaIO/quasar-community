import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { UpdatableTransactionFields } from '@tuwaio/quasar-sdk';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis, { Cluster } from 'ioredis';
import Redlock from 'redlock';

import {
  TRACKING_BATCH_FLUSH_INTERVAL_MS,
  TRACKING_BATCH_FLUSH_SIZE,
  TRACKING_FINISHED_KEY_PREFIX,
  TRACKING_FINISHED_TX_TTL_SECONDS,
  TRACKING_LOCK_KEY_PREFIX,
  TRACKING_REDLOCK_TTL_MS,
} from '../constants';
import { DRIZZLE } from '../database/database.constants';
import * as schema from '../database/schema/index';
import { REDIS, REDLOCK } from '../redis/redis.constants';

type TransactionRow = typeof schema.transactions.$inferSelect;

/**
 * Represents a pending database update buffered for batch flush.
 */
interface BatchEntry {
  appId: string;
  txKey: string;
  ownerId: string;
  data: Partial<TransactionRow>;
  isTerminal: boolean;
}

/**
 * Horizontally-scalable transaction tracking service.
 *
 * State management:
 * - Terminal tx deduplication: Redis keys with TTL (replaces in-memory Set)
 * - Concurrent write protection: Redlock distributed locks (replaces in-memory Map)
 * - DB write optimization: Local batch buffer with periodic flush (replaces immediate updates)
 */
@Injectable()
export class TrackingService implements OnModuleDestroy {
  private readonly logger = new Logger(TrackingService.name);

  /**
   * Local write buffer. Protected by Redlock at the txKey level,
   * so concurrent writes to the same key from different replicas are impossible.
   * On crash, lazy queue re-fires terminal events — acceptable data loss window.
   */
  private readonly batchBuffer = new Map<string, BatchEntry>();

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis | Cluster,
    @Inject(REDLOCK) private readonly redlock: Redlock,
  ) {}

  /**
   * Fetch a transaction by txKey + ownerId (tenant-scoped).
   */
  async fetchDbTx(txKey: string, ownerId: string): Promise<TransactionRow | null> {
    const [tx] = await this.db
      .select()
      .from(schema.transactions)
      .where(and(eq(schema.transactions.txKey, txKey), eq(schema.transactions.ownerId, ownerId)))
      .limit(1);
    return tx ?? null;
  }

  /**
   * Internal use only (Workers/System). Bypasses ownerId check to resolve context.
   */
  async fetchDbTxInternal(appId: string, txKey: string): Promise<TransactionRow | null> {
    const [tx] = await this.db
      .select()
      .from(schema.transactions)
      .where(and(eq(schema.transactions.appId, appId), eq(schema.transactions.txKey, txKey)))
      .limit(1);
    return tx ?? null;
  }

  /**
   * Queue a transaction update for batched write to Postgres.
   *
   * Acquires a distributed lock (Redlock) on the txKey to prevent concurrent
   * writes across replicas. Checks Redis for terminal tx dedup before processing.
   * Updates are buffered locally and flushed every TRACKING_BATCH_FLUSH_INTERVAL_MS.
   *
   * @param appId - Application ID for app scoping
   * @param txKey - Unique transaction identifier
   * @param ownerId - Organization/tenant ID for row-level scoping
   * @param updateData - Partial transaction fields to update
   * @param isTerminal - If true, marks the tx as finished in Redis with TTL
   */
  async updateDbTx(
    appId: string,
    txKey: string,
    ownerId: string,
    updateData: UpdatableTransactionFields,
    isTerminal = false,
  ): Promise<void> {
    const finishedKey = `${TRACKING_FINISHED_KEY_PREFIX}${appId}:${txKey}`;

    // Check if tx is already in terminal state (distributed dedup)
    if (!isTerminal) {
      const isFinished = await this.redis.exists(finishedKey).catch(() => 0);
      if (isFinished) {
        return;
      }
    }

    // Acquire distributed lock for this txKey
    const lockKey = `${TRACKING_LOCK_KEY_PREFIX}${appId}:${txKey}`;
    const lock = await this.redlock.acquire([lockKey], TRACKING_REDLOCK_TTL_MS).catch((err) => {
      this.logger.warn(`[REDLOCK] Failed to acquire lock for ${lockKey}, skipping update:`, err);
      return null;
    });

    if (!lock) {
      return;
    }

    try {
      const bufferKey = JSON.stringify({ appId, ownerId, txKey });

      if (isTerminal) {
        // Evict any pending in-flight buffered entry
        this.batchBuffer.delete(bufferKey);

        // Synchronous durable write to PostgreSQL for terminal lifecycle transitions
        await this.db.transaction(async (trx) => {
          await trx
            .update(schema.transactions)
            .set(updateData as unknown as Partial<TransactionRow>)
            .where(
              and(
                eq(schema.transactions.txKey, txKey),
                eq(schema.transactions.appId, appId),
                eq(schema.transactions.ownerId, ownerId),
              ),
            );
        });

        // Write terminal marker to Redis only after successful DB commit (best-effort cache acceleration)
        await this.redis.set(finishedKey, '1', 'EX', TRACKING_FINISHED_TX_TTL_SECONDS).catch((err) => {
          this.logger.warn(`[REDIS] Failed to set terminal marker for ${finishedKey} after DB commit:`, err);
        });
      } else {
        // Buffer non-terminal updates — latest data wins for the same appId + ownerId + txKey
        const existing = this.batchBuffer.get(bufferKey);
        if (existing) {
          existing.data = { ...existing.data, ...(updateData as unknown as Partial<TransactionRow>) };
          existing.isTerminal ||= isTerminal;
        } else {
          this.batchBuffer.set(bufferKey, {
            appId,
            txKey,
            ownerId,
            data: updateData as unknown as Partial<TransactionRow>,
            isTerminal: false,
          });
        }
      }
    } finally {
      try {
        // @ts-expect-error: @types/redlock@4 defines unlock(), but runtime redlock@5-beta uses release()
        await lock.release();
      } catch (err) {
        this.logger.warn(`[REDLOCK] Failed to release lock for ${appId}:${txKey}:`, err);
      }
    }
  }

  /**
   * Resets the terminal deduplication key in Redis for a given transaction,
   * allowing the tracker to re-process it after a retry request.
   *
   * Also evicts any buffered (stale) update for this txKey from the local
   * batch buffer to prevent overwriting the reset with old data.
   *
   * @param appId - Application ID
   * @param txKey - Unique transaction identifier
   */
  async resetTerminalTx(appId: string, txKey: string): Promise<void> {
    const finishedKey = `${TRACKING_FINISHED_KEY_PREFIX}${appId}:${txKey}`;
    const lockKey = `${TRACKING_LOCK_KEY_PREFIX}${appId}:${txKey}`;

    // 1. Delete the terminal dedup key so the tracker will process updates again
    await this.redis.del(finishedKey);

    // 2. Also release any residual Redlock key (best-effort, no lock acquisition)
    await this.redis.del(lockKey).catch(() => {});

    // 3. Evict stale buffered updates for this txKey to prevent overwriting the reset
    for (const bufferKey of this.batchBuffer.keys()) {
      try {
        const parsed = JSON.parse(bufferKey) as { appId: string; txKey: string };
        if (parsed.appId === appId && parsed.txKey === txKey) {
          this.batchBuffer.delete(bufferKey);
          this.logger.debug(`[RESET] Evicted stale buffer entry for ${appId}:${txKey}`);
        }
      } catch {
        // Ignore malformed keys
      }
    }

    this.logger.log(`[RESET] Terminal key cleared for ${appId}:${txKey}. Ready for re-tracking.`);
  }

  /**
   * Periodic batch flush — drains the local buffer and writes to Postgres
   * in a single transaction. Runs every TRACKING_BATCH_FLUSH_INTERVAL_MS.
   */
  @Interval(TRACKING_BATCH_FLUSH_INTERVAL_MS)
  async flushBatchBuffer(): Promise<void> {
    if (this.batchBuffer.size === 0) {
      return;
    }

    // 1. Create a snapshot of entries to flush
    const snapshot = new Map<string, BatchEntry>();
    for (const [key, entry] of this.batchBuffer) {
      snapshot.set(key, entry);
      this.batchBuffer.delete(key);
      if (snapshot.size >= TRACKING_BATCH_FLUSH_SIZE) {
        break;
      }
    }

    const entries = Array.from(snapshot.values());
    this.logger.debug(`[BATCH FLUSH] Flushing ${entries.length} entries to Postgres`);

    try {
      // 2. Perform batch update in a single transaction
      await this.db.transaction(async (trx) => {
        for (const entry of entries) {
          await trx
            .update(schema.transactions)
            .set(entry.data)
            .where(
              and(
                eq(schema.transactions.txKey, entry.txKey),
                eq(schema.transactions.appId, entry.appId),
                eq(schema.transactions.ownerId, entry.ownerId),
              ),
            );
        }
      });

      // Redis is acceleration/dedup state only. Persist the terminal update
      // first; a failed marker write leaves the durable DB state authoritative
      // and allows a later retry to reconcile the marker.
      for (const entry of entries) {
        if (entry.isTerminal) {
          const finishedKey = `${TRACKING_FINISHED_KEY_PREFIX}${entry.appId}:${entry.txKey}`;
          await this.redis.set(finishedKey, '1', 'EX', TRACKING_FINISHED_TX_TTL_SECONDS);
        }
      }
      // Success: Snapshot is effectively cleared as we already deleted from batchBuffer
    } catch (err) {
      this.logger.error(`[BATCH FLUSH] Failed to flush ${entries.length} entries. Merging back to buffer.`, err);

      // 3. On failure, merge snapshot back into the main buffer.
      // If a newer update arrived in the meantime, it wins (we merge snapshot data as 'older').
      for (const [key, entry] of snapshot) {
        const current = this.batchBuffer.get(key);
        if (current) {
          // Merge: snapshot data is older, so current (newer) data takes precedence for overlapping fields
          current.data = { ...entry.data, ...current.data };
          current.isTerminal ||= entry.isTerminal;
        } else {
          this.batchBuffer.set(key, entry);
        }
      }
    }
  }

  /**
   * Graceful shutdown: flush remaining buffer to prevent data loss.
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('[SHUTDOWN] Flushing remaining batch buffer...');
    // Flush all remaining entries (may exceed TRACKING_BATCH_FLUSH_SIZE)
    while (this.batchBuffer.size > 0) {
      await this.flushBatchBuffer();
    }
    this.logger.log('[SHUTDOWN] Batch buffer flushed.');
  }
}
