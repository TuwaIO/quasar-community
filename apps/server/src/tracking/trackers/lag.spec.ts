import { describe, expect, it } from 'vitest';

import { trackingLagSeconds } from './lag';

// The lag the engine reports for a tracked transaction (`pulsar_sync_lag_seconds`, alert Pulsar_SyncLag): the time
// from when the engine could have seen the transaction to when it did
describe('trackingLagSeconds', () => {
  const now = 1_800_000_000_000;

  it('counts from the block when the transaction landed while the engine was tracking it', () => {
    expect(trackingLagSeconds(now - 12_000, now - 60_000, now)).toBe(12);
  });

  it('counts from the start of tracking when the transaction landed before it was synced or retried', () => {
    // Mined a month ago, synced now: the age of the transaction is not a lag of the engine
    expect(trackingLagSeconds(now - 30 * 86_400_000, now - 3_000, now)).toBe(3);
  });

  it('is never negative', () => {
    expect(trackingLagSeconds(now + 5_000, now, now)).toBe(0);
  });
});
