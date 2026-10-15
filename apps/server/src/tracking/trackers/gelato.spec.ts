import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createGelatoClient: vi.fn((config: { apiKey: string }) => ({ config })),
  initializePollingTracker: vi.fn(),
}));

vi.mock('@tuwaio/pulsar-evm', () => ({
  createGelatoClient: (config: { apiKey: string }) => mocks.createGelatoClient(config),
  gelatoFetcher: vi.fn(() => vi.fn()),
  GelatoStatusCode: { Success: 'success', Rejected: 'rejected', Reverted: 'reverted' },
}));

vi.mock('@tuwaio/pulsar-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tuwaio/pulsar-core')>()),
  initializePollingTracker: (args: unknown) => mocks.initializePollingTracker(args),
}));

// Stored keys are plain in these tests; `enc:` marks the ones the tracker has to decrypt.
vi.mock('@tuwaio/shared/encryption', () => ({
  decrypt: vi.fn((val?: string | null) => (typeof val === 'string' && val.startsWith('enc:') ? val.slice(4) : '')),
}));

import { processGelatoTx } from './gelato';

function makeDb(app: Record<string, unknown>) {
  const query: any = { from: () => query, where: () => query, limit: () => Promise.resolve([app]) };
  return { select: vi.fn(() => query) };
}

const metric = () => ({ inc: vi.fn(), set: vi.fn() }) as any;

async function track(app: Record<string, unknown>) {
  const tx: any = { txKey: 'task-1', chainId: 8453, appId: 'app-1', ownerId: 'org-1' };
  await processGelatoTx(tx, vi.fn(), vi.fn(), makeDb(app) as any, metric(), metric(), metric());
}

describe('processGelatoTx credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GELATO_API_KEY', 'system-gelato');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses the app's own Gelato key with the system keys off", async () => {
    vi.stubEnv('SYSTEM_PROVIDER_KEYS_ENABLED', '');
    await track({ id: 'app-1', gelatoApiKey: 'enc:app-gelato' });
    expect(mocks.createGelatoClient).toHaveBeenCalledWith({ apiKey: 'app-gelato' });
    expect(mocks.initializePollingTracker).toHaveBeenCalledTimes(1);
  });

  it("does not contact Gelato without the app's key while the system keys are off", async () => {
    vi.stubEnv('SYSTEM_PROVIDER_KEYS_ENABLED', '');
    await expect(track({ id: 'app-1' })).rejects.toThrow('Gelato API key');
    expect(mocks.createGelatoClient).not.toHaveBeenCalled();
    expect(mocks.initializePollingTracker).not.toHaveBeenCalled();
  });

  it('uses the system Gelato key when SYSTEM_PROVIDER_KEYS_ENABLED is true', async () => {
    vi.stubEnv('SYSTEM_PROVIDER_KEYS_ENABLED', 'true');
    await track({ id: 'app-1' });
    expect(mocks.createGelatoClient).toHaveBeenCalledWith({ apiKey: 'system-gelato' });
  });
});
