import type { Transaction } from '@/payload-types';

export const STUCK_PENDING_THRESHOLD_SECONDS = 60;

/**
 * Returns true when a pending transaction has not progressed for at least a minute.
 * Transaction timestamps may be received in Unix seconds or milliseconds.
 */
export function isStuckPendingTransaction(tx: Pick<Transaction, 'pending' | 'localTimestamp'>, now = Date.now()) {
  if (!tx.pending || !Number.isFinite(tx.localTimestamp)) return false;

  const timestampMs = tx.localTimestamp > 1e12 ? tx.localTimestamp : tx.localTimestamp * 1000;
  const ageSeconds = (now - timestampMs) / 1000;

  return ageSeconds >= STUCK_PENDING_THRESHOLD_SECONDS;
}

/**
 * Whether tracking may be retried: the transaction finished in anything but
 * Success, or it has been pending past the stuck threshold. A fresh pending
 * transaction is still being tracked, and a successful one has nothing to retry.
 * Shared by the dashboard, the Payload admin and the retry route, so all three
 * agree on which transactions can be tracked again. Kept free of React so the
 * route can import it.
 */
export function canRetryTransaction(tx: Pick<Transaction, 'pending' | 'status' | 'localTimestamp'>, now = Date.now()) {
  return isStuckPendingTransaction(tx, now) || (!tx.pending && tx.status !== 'Success');
}
