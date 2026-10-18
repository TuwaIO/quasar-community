/**
 * The tracking lag the engine reports (`pulsar_sync_lag_seconds`): from the moment it could have detected the
 * transaction — when its block was produced, or when this tracking run started if the block is older, as for a
 * transaction synced or retried after it landed — until it detected it. Counting only from the block reported the
 * age of such a transaction as a lag of the engine.
 *
 * @param minedAtMs - The time of the block that holds the transaction.
 * @param trackingStartedAtMs - When this tracking run started.
 * @param nowMs - The time of detection.
 * @returns The lag in seconds, never negative.
 */
export function trackingLagSeconds(minedAtMs: number, trackingStartedAtMs: number, nowMs = Date.now()): number {
  return Math.max(0, nowMs - Math.max(minedAtMs, trackingStartedAtMs)) / 1000;
}
