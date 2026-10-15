import { describe, expect, it } from 'vitest';

import { BATCH_HASH_TIMEOUT_MS, batchTracking } from './eip5792';

describe('batchTracking (EIP-5792)', () => {
  const syncedAt = '2026-10-10T08:00:00.000Z';
  const at = (ms: number) => new Date(new Date(syncedAt).getTime() + ms);

  it('tracks a batch on-chain once the app reported the hash of its transaction', () => {
    expect(batchTracking({ hash: `0x${'ab'.repeat(32)}`, createdAt: syncedAt }, at(BATCH_HASH_TIMEOUT_MS * 5))).toBe(
      'track',
    );
  });

  it('waits for the hash, then fails the batch an hour after it was synced', () => {
    expect(batchTracking({ hash: null, createdAt: syncedAt }, at(5 * 60_000))).toBe('wait');
    expect(batchTracking({ hash: null, createdAt: syncedAt }, at(BATCH_HASH_TIMEOUT_MS - 1))).toBe('wait');
    expect(batchTracking({ hash: null, createdAt: syncedAt }, at(BATCH_HASH_TIMEOUT_MS))).toBe('expire');
  });
});
