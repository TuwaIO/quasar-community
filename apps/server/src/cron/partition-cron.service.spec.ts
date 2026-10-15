import { describe, expect, it, vi } from 'vitest';

import { PartitionCronService } from './partition-cron.service';

describe('PartitionCronService', () => {
  it('creates the coming partitions and drops the expired ones every day', async () => {
    const partitionManager = {
      ensurePartitions: vi.fn().mockResolvedValue(undefined),
      dropExpiredPartitions: vi.fn().mockResolvedValue(undefined),
    };

    await new PartitionCronService(partitionManager as never).handlePartitionMaintenance();

    expect(partitionManager.ensurePartitions).toHaveBeenCalledTimes(1);
    expect(partitionManager.dropExpiredPartitions).toHaveBeenCalledTimes(1);
  });
});
