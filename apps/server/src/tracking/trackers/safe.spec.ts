import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initializePollingTracker: vi.fn() }));

vi.mock('@tuwaio/pulsar-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tuwaio/pulsar-core')>()),
  initializePollingTracker: (args: unknown) => mocks.initializePollingTracker(args),
}));

import { processSafeTx } from './safe';

const metric = () => ({ inc: vi.fn(), set: vi.fn() }) as any;
const tx: any = { txKey: '0xsafe', chainId: 1, from: '0xwallet', appId: 'app-1', ownerId: 'org-1', adapter: 'evm' };
const track = () => processSafeTx(tx, vi.fn(), vi.fn(), metric(), metric(), metric());

describe('processSafeTx and the Safe Transaction Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not contact the Safe Transaction Service unless SAFE_TRANSACTION_SERVICE_ENABLED is true', async () => {
    vi.stubEnv('SAFE_TRANSACTION_SERVICE_ENABLED', '');
    await expect(track()).rejects.toThrow('Safe Transaction Service');
    expect(mocks.initializePollingTracker).not.toHaveBeenCalled();
  });

  it('tracks through the Safe Transaction Service when it is switched on', async () => {
    vi.stubEnv('SAFE_TRANSACTION_SERVICE_ENABLED', 'true');
    await track();
    expect(mocks.initializePollingTracker).toHaveBeenCalledTimes(1);
  });
});
