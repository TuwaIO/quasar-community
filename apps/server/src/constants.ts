export function getAlchemyKey(): string {
  return process.env.ALCHEMY_API_KEY_FALLBACK || '';
}

// --- Tracking Service: Horizontal Scaling Constants ---

/** Interval in ms between batch flushes to Postgres */
export const TRACKING_BATCH_FLUSH_INTERVAL_MS = 2_000;

/** Maximum number of entries to flush in a single batch */
export const TRACKING_BATCH_FLUSH_SIZE = 100;

/** TTL in seconds for the finished-tx deduplication key in Redis */
export const TRACKING_FINISHED_TX_TTL_SECONDS = 300; // 5 minutes

/** TTL in ms for the Redlock distributed lock per txKey */
export const TRACKING_REDLOCK_TTL_MS = 5_000;

/** Redis key prefix for terminal tx deduplication */
export const TRACKING_FINISHED_KEY_PREFIX = 'tracking:finished:';

/** Redlock resource prefix for tx-level distributed mutex */
export const TRACKING_LOCK_KEY_PREFIX = 'lock:tx:';

// --- Business Metrics ---
export const PULSAR_SYNC_LAG_METRIC = 'pulsar_sync_lag_seconds';
export const PULSAR_TX_COUNT_METRIC = 'pulsar_tx_total';
export const PULSAR_TX_ERROR_METRIC = 'pulsar_tx_errors_total';
export const PULSAR_ACTIVE_TRACKERS_METRIC = 'pulsar_active_trackers';

export const IRON_DOME_BLOCK_METRIC = 'iron_dome_blocks_total';
export const WEBHOOK_DELIVERY_METRIC = 'webhook_delivery_total';
export const WEBHOOK_LATENCY_METRIC = 'webhook_delivery_latency_seconds';
export const QUEUE_HEALTH_METRIC = 'queue_jobs_count';
