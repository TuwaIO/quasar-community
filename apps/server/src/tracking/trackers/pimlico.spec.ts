import { TransactionStatus } from '@tuwaio/pulsar-core';
import { base } from 'viem/chains';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processPimlicoTx } from './pimlico';

const mockErc4337Tracker = vi.fn();
const mockEvmTracker = vi.fn();

const mocks = vi.hoisted(() => ({
  dns: { lookup: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn() },
  http: vi.fn((url: string) => ({ url })),
}));

vi.mock('dns/promises', () => mocks.dns);

vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  http: (url: string) => mocks.http(url),
  fallback: (transports: unknown[]) => transports,
}));

vi.mock('@tuwaio/pulsar-evm', () => ({
  erc4337Tracker: (args: any) => mockErc4337Tracker(args),
  evmTracker: (args: any) => mockEvmTracker(args),
}));

vi.mock('viem/actions', () => ({
  getBlock: vi.fn().mockResolvedValue({ timestamp: 1700000000n }),
}));

// `enc:` marks a stored URL the tracker decrypts to plain text; other values keep the old
// `decrypted_` marker so the key assertions stay readable.
vi.mock('@tuwaio/shared/encryption', () => ({
  decrypt: vi.fn((val: string) => (val.startsWith('enc:') ? val.slice(4) : `decrypted_${val}`)),
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

describe('processPimlicoTx outbound URL checks', () => {
  const hash = '0x3333333333333333333333333333333333333333333333333333333333333333';
  const PIMLICO_WITH_APP_KEY = 'https://api.pimlico.io/v2/8453/rpc?apikey=decrypted_encrypted_key';

  function dnsAnswers(table: Record<string, string[]>) {
    const pick = (host: string, v6: boolean) => (table[host] ?? []).filter((a) => a.includes(':') === v6);
    mocks.dns.lookup.mockImplementation(async (host: string) =>
      (table[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );
    mocks.dns.resolve4.mockImplementation(async (host: string) => pick(host, false));
    mocks.dns.resolve6.mockImplementation(async (host: string) => pick(host, true));
  }

  function makeDb(app: Record<string, unknown>, rpcConfigs: { rpcUrl: string }[] = []) {
    return {
      select: vi.fn(() => {
        const query: any = {
          from: () => query,
          where: () => query,
          limit: () => Promise.resolve([app]),
          then: (resolve: any, reject: any) => Promise.resolve(rpcConfigs).then(resolve, reject),
        };
        return query;
      }),
    };
  }

  /**
   * Loads a fresh copy of the tracker. Runs through the returned function share that copy's
   * wagmi config cache; each stops after stage 1 and returns its bundler URL and the stage 2 RPC
   * URLs handed to viem in that run, in order (none when the config came from the cache).
   */
  async function freshTracker() {
    vi.resetModules();
    const { processPimlicoTx: freshProcess } = await import('./pimlico');
    return async (
      txExtra: Record<string, unknown> = {},
      app: Record<string, unknown> = { id: 'app-1', pimlicoApiKey: 'encrypted_key' },
      rpcConfigs: { rpcUrl: string }[] = [],
    ): Promise<{ bundlerUrl: string; rpcUrls: string[] }> => {
      mocks.http.mockClear();
      mockErc4337Tracker.mockClear();
      mockErc4337Tracker.mockImplementation(async ({ onFailure }) => {
        await onFailure({ reason: 'stop after stage 1' });
      });
      const tx: any = { txKey: hash, chainId: 8453, appId: 'app-1', ownerId: 'owner-1', ...txExtra };
      const redis: any = { get: vi.fn(), del: vi.fn(), set: vi.fn() };
      const metric: any = { inc: vi.fn(), set: vi.fn() };
      await freshProcess(tx, vi.fn(), vi.fn(), makeDb(app, rpcConfigs) as any, redis, metric, metric, metric);
      expect(mockErc4337Tracker).toHaveBeenCalledTimes(1);
      return {
        bundlerUrl: mockErc4337Tracker.mock.calls[0][0].tx.bundlerUrl,
        rpcUrls: mocks.http.mock.calls.map(([url]) => url),
      };
    };
  }

  /** One run on a fresh tracker, so the config cache cannot hide the stage 2 transport list. */
  async function track(
    txExtra: Record<string, unknown> = {},
    app?: Record<string, unknown>,
    rpcConfigs: { rpcUrl: string }[] = [],
  ): Promise<{ bundlerUrl: string; rpcUrls: string[] }> {
    const run = await freshTracker();
    return run(txExtra, app, rpcConfigs);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ALLOW_INTERNAL_WEBHOOKS', 'false');
    vi.stubEnv('ALCHEMY_API_KEY_FALLBACK', '');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dnsAnswers({
      'bundler.customer.example': ['104.18.2.3'],
      'rpc.customer.example': ['104.18.2.4'],
      'my-app.quiknode.pro': ['104.18.3.4'],
      'redis-api': ['172.18.0.4'],
      'rebind.attacker.example': ['10.0.0.5'],
      'v6.attacker.example': ['fc00::7'],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('passes a public client bundler URL through to stage 1', async () => {
    const { bundlerUrl } = await track({ bundlerUrl: 'https://bundler.customer.example/rpc?key=1' });
    expect(bundlerUrl).toBe('https://bundler.customer.example/rpc?key=1');
  });

  it.each([
    ['an internal Docker service name', 'http://redis-api:6379'],
    ['a name whose DNS answer is private', 'https://rebind.attacker.example/rpc'],
    ['a name with a ULA AAAA record', 'https://v6.attacker.example/rpc'],
    ['a name that does not resolve', 'https://unknown.attacker.example/rpc'],
    ['the cloud metadata IP', 'http://169.254.169.254/latest/meta-data/'],
    ['an IPv6 loopback literal', 'http://[::1]:4337'],
    ['an IPv4-mapped IPv6 literal', 'http://[::ffff:192.168.0.1]:4337'],
    ['localhost', 'http://localhost:4337'],
  ])('falls back to Pimlico when the client bundler URL points at %s', async (_case, url) => {
    const { bundlerUrl } = await track({ bundlerUrl: url });
    expect(bundlerUrl).toBe(PIMLICO_WITH_APP_KEY);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[PIMLICO TRACKER] Skipping Client Bundler RPC'));
  });

  it('rejects a plain-http client bundler URL in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { bundlerUrl } = await track({ bundlerUrl: 'http://bundler.customer.example/rpc' });
    expect(bundlerUrl).toBe(PIMLICO_WITH_APP_KEY);
  });

  it('allows a local bundler when ALLOW_INTERNAL_WEBHOOKS=true', async () => {
    vi.stubEnv('ALLOW_INTERNAL_WEBHOOKS', 'true');
    const { bundlerUrl } = await track({ bundlerUrl: 'http://127.0.0.1:4337' });
    expect(bundlerUrl).toBe('http://127.0.0.1:4337');
  });

  it('does not resolve DNS when no client bundler URL is sent', async () => {
    const { bundlerUrl } = await track();
    expect(bundlerUrl).toBe(PIMLICO_WITH_APP_KEY);
    expect(mocks.dns.lookup).not.toHaveBeenCalled();
  });

  it('keeps a public App RPC override for stage 2', async () => {
    const { rpcUrls } = await track({}, undefined, [{ rpcUrl: 'enc:https://rpc.customer.example/key' }]);
    expect(rpcUrls).toContain('https://rpc.customer.example/key');
  });

  it.each([
    ['an internal Docker service name', 'http://redis-api:6379'],
    ['the cloud metadata IP', 'http://169.254.169.254/'],
    ['an IPv6 loopback literal', 'http://[::1]:8545'],
    ['a name whose DNS answer is private', 'https://rebind.attacker.example/'],
  ])('drops an App RPC override pointing at %s from stage 2', async (_case, url) => {
    const { rpcUrls } = await track({}, undefined, [{ rpcUrl: `enc:${url}` }]);
    expect(rpcUrls).not.toContain(url);
    expect(rpcUrls.length).toBeGreaterThan(0);
  });

  it('drops a QuickNode endpoint whose app name rewrites the host', async () => {
    const { rpcUrls } = await track(
      {},
      {
        id: 'app-1',
        pimlicoApiKey: 'encrypted_key',
        quickNodeApiKey: 'enc:token',
        quickNodeAppName: '169.254.169.254#',
      },
    );
    expect(rpcUrls.some((url) => url.includes('169.254.169.254'))).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping App QuickNode RPC'));
  });

  describe('stage 2 priority order', () => {
    const PUBLIC_FALLBACK = base.rpcUrls.default.http[0];
    const OVERRIDE = 'https://rpc.customer.example/v1/key';
    const QUICKNODE = 'https://my-app.quiknode.pro/token/';

    it('hands the RPCs to fallback() in priority order, not alphabetically', async () => {
      vi.stubEnv('ALCHEMY_API_KEY_FALLBACK', 'system-key');
      const { rpcUrls } = await track(
        {},
        {
          id: 'app-1',
          pimlicoApiKey: 'encrypted_key',
          alchemyApiKey: 'enc:app-key',
          quickNodeApiKey: 'enc:token',
          quickNodeAppName: 'my-app',
        },
        [{ rpcUrl: `enc:${OVERRIDE}` }],
      );
      // Sorted, both Alchemy URLs would come first and the customer's own RPC last.
      expect(rpcUrls).toEqual([
        OVERRIDE,
        'https://base-mainnet.g.alchemy.com/v2/app-key',
        QUICKNODE,
        'https://base-mainnet.g.alchemy.com/v2/system-key',
        PUBLIC_FALLBACK,
      ]);
    });

    it('does not share a cached config between the same RPCs in a different order', async () => {
      const run = await freshTracker();
      const first = await run(
        {},
        { id: 'app-1', pimlicoApiKey: 'encrypted_key', quickNodeApiKey: `enc:${QUICKNODE}`, quickNodeAppName: 'x' },
        [{ rpcUrl: `enc:${OVERRIDE}` }],
      );
      const second = await run(
        {},
        { id: 'app-2', pimlicoApiKey: 'encrypted_key', quickNodeApiKey: `enc:${OVERRIDE}`, quickNodeAppName: 'x' },
        [{ rpcUrl: `enc:${QUICKNODE}` }],
      );
      expect(first.rpcUrls).toEqual([OVERRIDE, QUICKNODE, PUBLIC_FALLBACK]);
      expect(second.rpcUrls).toEqual([QUICKNODE, OVERRIDE, PUBLIC_FALLBACK]);
    });

    it('still reuses the cached config for the same RPCs in the same order', async () => {
      const run = await freshTracker();
      const first = await run({}, undefined, [{ rpcUrl: `enc:${OVERRIDE}` }]);
      const second = await run({}, undefined, [{ rpcUrl: `enc:${OVERRIDE}` }]);
      expect(first.rpcUrls).toEqual([OVERRIDE, PUBLIC_FALLBACK]);
      expect(second.rpcUrls).toEqual([]);
    });
  });
});
