/**
 * EIP-5792 batches (`wallet_sendCalls`): synced by their batch ID, which only the wallet resolves. The app reports the
 * hash of the transaction that executed the batch (`POST /v1/engine/pulsar/sync/:txKey/hash`); Quasar then tracks it
 * on-chain like an Ethereum transaction, writing to the batch's record.
 */

/** How long a batch waits for its hash before it fails, like an unknown Solana signature. */
export const BATCH_HASH_TIMEOUT_MS = 60 * 60 * 1000;

/** The error of a batch whose hash never arrived. */
export const BATCH_HASH_TIMEOUT_MESSAGE =
  'The app never reported the transaction of the batch: it may have failed in the wallet or never been sent.';

/** What the router does with a batch: track its transaction, wait for its hash, or fail it for good. */
export function batchTracking(
  tx: { hash?: string | null; createdAt: string },
  now: Date = new Date(),
): 'track' | 'wait' | 'expire' {
  if (tx.hash) return 'track';
  return now.getTime() - new Date(tx.createdAt).getTime() >= BATCH_HASH_TIMEOUT_MS ? 'expire' : 'wait';
}
