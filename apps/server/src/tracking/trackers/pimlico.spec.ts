import { TransactionStatus } from '@tuwaio/pulsar-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processPimlicoTx } from './pimlico';

const mockErc4337Tracker = vi.fn();
const mockEvmTracker = vi.fn();

vi.mock('@tuwaio/pulsar-evm', () => ({
  erc4337Tracker: (args: any) => mockErc4337Tracker(args),
  evmTracker: (args: any) => mockEvmTracker(args),
}));

vi.mock('viem/actions', () => ({
  getBlock: vi.fn().mockResolvedValue({ timestamp: 1700000000n }),
}));

vi.mock('@tuwaio/shared/encryption', () => ({
  decrypt: vi.fn((val: string) => `decrypted_${val}`),
}));

vi.mock('@wagmi/core', () => ({
  createConfig: vi.fn(() => ({})),
}));

describe('processPimlicoTx', () => {
  let db: any;
  let redis: any;
  let lagGauge: any;
  let txCounter: any;
  let errorCounter: any;
  let onTerminalState: any;
  let updateDbTx: any;

  const validHash1 = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const validHash2 = '0x2222222222222222222222222222222222222222222222222222222222222222';

  beforeEach(() => {
    vi.clearAllMocks();

    const mockQuery: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 'app-1',
          pimlicoApiKey: 'encrypted_key',
          alchemyApiKey: null,
          infuraApiKey: null,
        },
      ]),
      then: (resolve: any) => resolve([]),
    };
    mockQuery.where.mockReturnValue(mockQuery);

    db = {
      select: vi.fn().mockReturnValue(mockQuery),
    };

    redis = {
      get: vi.fn().mockResolvedValue('12'),
      del: vi.fn().mockResolvedValue(1),
    };

    lagGauge = { set: vi.fn() };
    txCounter = { inc: vi.fn() };
    errorCounter = { inc: vi.fn() };
    onTerminalState = vi.fn().mockResolvedValue(undefined);
    updateDbTx = vi.fn().mockResolvedValue(undefined);
  });

  it('runs two-stage tracking: stage 1 mempool receipt then stage 2 evm tracking', async () => {
    mockErc4337Tracker.mockImplementation(async ({ onSuccess }) => {
      await onSuccess({ hash: validHash1 });
    });

    mockEvmTracker.mockImplementation(async ({ onSuccess }) => {
      await onSuccess({}, { blockNumber: 100n, status: 'success' }, {});
    });

    const tx: any = {
      txKey: validHash1,
      chainId: 8453,
      appId: 'app-1',
      ownerId: 'owner-1',
    };

    await processPimlicoTx(tx, onTerminalState, updateDbTx, db, redis, lagGauge, txCounter, errorCounter);

    // Stage 1 was invoked
    expect(mockErc4337Tracker).toHaveBeenCalledTimes(1);
    expect(updateDbTx).toHaveBeenCalledWith(validHash1, { hash: validHash1 });

    // Stage 2 was invoked
    expect(mockEvmTracker).toHaveBeenCalledTimes(1);
    expect(updateDbTx).toHaveBeenCalledWith(
      validHash1,
      expect.objectContaining({
        hash: validHash1,
        status: TransactionStatus.Success,
        pending: false,
      }),
      true,
    );
    expect(onTerminalState).toHaveBeenCalledWith(TransactionStatus.Success);
  });

  it('skips stage 1 when hash is already present on tx and runs stage 2 directly', async () => {
    mockEvmTracker.mockImplementation(async ({ onSuccess }) => {
      await onSuccess({}, { blockNumber: 100n, status: 'success' }, {});
    });

    const tx: any = {
      txKey: validHash1,
      hash: validHash2,
      chainId: 8453,
      appId: 'app-1',
      ownerId: 'owner-1',
    };

    await processPimlicoTx(tx, onTerminalState, updateDbTx, db, redis, lagGauge, txCounter, errorCounter);

    // Stage 1 skipped
    expect(mockErc4337Tracker).not.toHaveBeenCalled();

    // Stage 2 invoked directly
    expect(mockEvmTracker).toHaveBeenCalledTimes(1);
    expect(onTerminalState).toHaveBeenCalledWith(TransactionStatus.Success);
  });

  it('handles stage 1 user operation failure gracefully', async () => {
    mockErc4337Tracker.mockImplementation(async ({ onFailure }) => {
      await onFailure({ reason: 'AA21 prefund too low', hash: validHash1 });
    });

    const tx: any = {
      txKey: validHash1,
      chainId: 8453,
      appId: 'app-1',
      ownerId: 'owner-1',
    };

    await processPimlicoTx(tx, onTerminalState, updateDbTx, db, redis, lagGauge, txCounter, errorCounter);

    expect(mockErc4337Tracker).toHaveBeenCalledTimes(1);
    expect(mockEvmTracker).not.toHaveBeenCalled();

    expect(updateDbTx).toHaveBeenCalledWith(
      validHash1,
      expect.objectContaining({
        status: TransactionStatus.Failed,
        pending: false,
        isError: true,
      }),
      true,
    );
    expect(onTerminalState).toHaveBeenCalledWith(TransactionStatus.Failed);
    expect(errorCounter.inc).toHaveBeenCalledWith({ ecosystem: 'ERC4337', chainId: '8453' });
  });

  it('throws error when appId is missing', async () => {
    const tx: any = {
      txKey: validHash1,
      chainId: 8453,
    };

    await expect(
      processPimlicoTx(tx, onTerminalState, updateDbTx, db, redis, lagGauge, txCounter, errorCounter),
    ).rejects.toThrow('Missing appId');
  });
});
