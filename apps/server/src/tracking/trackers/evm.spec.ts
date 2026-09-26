import { mainnet } from 'viem/chains';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dns: { lookup: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn() },
  http: vi.fn((url: string) => ({ url })),
  evmTracker: vi.fn(),
}));

vi.mock('dns/promises', () => mocks.dns);

vi.mock('@tuwaio/pulsar-evm', () => ({
  evmTracker: (args: unknown) => mocks.evmTracker(args),
}));

vi.mock('@wagmi/core', () => ({
  createConfig: vi.fn(() => ({})),
}));

// Stored values are plain in these tests; `enc:` marks the ones the tracker has to decrypt.
vi.mock('@tuwaio/shared/encryption', () => ({
  decrypt: vi.fn((val: string) => (typeof val === 'string' && val.startsWith('enc:') ? val.slice(4) : val)),
}));

vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  http: (url: string) => mocks.http(url),
  fallback: (transports: unknown[]) => transports,
}));

const PUBLIC_FALLBACK = mainnet.rpcUrls.default.http[0];

/** Hostname → answers; anything not listed does not resolve. */
function dnsAnswers(table: Record<string, string[]>) {
  const pick = (host: string, v6: boolean) => (table[host] ?? []).filter((a) => a.includes(':') === v6);
  mocks.dns.lookup.mockImplementation(async (host: string) =>
    (table[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  );
  mocks.dns.resolve4.mockImplementation(async (host: string) => pick(host, false));
  mocks.dns.resolve6.mockImplementation(async (host: string) => pick(host, true));
}

function makeDb(app: Record<string, unknown> | undefined, rpcConfigs: { rpcUrl: string }[] = []) {
  return {
    select: vi.fn(() => {
      const query: any = {
        from: () => query,
        where: () => query,
        limit: () => Promise.resolve(app ? [app] : []),
        then: (resolve: any, reject: any) => Promise.resolve(rpcConfigs).then(resolve, reject),
      };
      return query;
    }),
  };
}

const counter = () => ({ inc: vi.fn(), set: vi.fn() });

/**
 * Loads a fresh copy of the tracker. Runs through the returned function share that copy's wagmi
 * config cache, and each returns the RPC URLs handed to viem in that run, in order (none when
 * the config came from the cache).
 */
async function freshTracker() {
  vi.resetModules();
  const { processEvmTx } = await import('./evm');
  return async (
    app: Record<string, unknown> | undefined,
    rpcConfigs: { rpcUrl: string }[] = [],
    txExtra: Record<string, unknown> = {},
  ): Promise<string[]> => {
    mocks.http.mockClear();
    const tx: any = { txKey: '0xabc', chainId: 1, appId: 'app-1', ownerId: 'org-1', ...txExtra };
    const redis: any = { set: vi.fn(), get: vi.fn(), del: vi.fn() };
    await processEvmTx(
      tx,
      vi.fn(),
      vi.fn(),
      makeDb(app, rpcConfigs) as any,
      redis,
      counter() as any,
      counter() as any,
      counter() as any,
    );
    return mocks.http.mock.calls.map(([url]) => url);
  };
}

/** One run on a fresh tracker, so the config cache cannot hide the transport list. */
async function trackedRpcUrls(
  app: Record<string, unknown> | undefined,
  rpcConfigs: { rpcUrl: string }[] = [],
  txExtra: Record<string, unknown> = {},
): Promise<string[]> {
  const run = await freshTracker();
  return run(app, rpcConfigs, txExtra);
}

describe('processEvmTx RPC selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ALLOW_INTERNAL_WEBHOOKS', 'false');
    vi.stubEnv('ALCHEMY_API_KEY_FALLBACK', '');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dnsAnswers({
      'rpc.customer.example': ['104.18.2.3'],
      'my-app.quiknode.pro': ['104.18.3.4'],
      'redis-api': ['172.18.0.4'],
      'rebind.attacker.example': ['10.0.0.5'],
      'mixed.attacker.example': ['104.18.2.3', '192.168.1.20'],
      'v6.attacker.example': ['fd00::5'],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses a public App RPC override ahead of the fallbacks', async () => {
    const urls = await trackedRpcUrls({ id: 'app-1' }, [{ rpcUrl: 'enc:https://rpc.customer.example/v1/key' }]);
    expect(urls).toEqual(expect.arrayContaining(['https://rpc.customer.example/v1/key', PUBLIC_FALLBACK]));
    expect(mocks.evmTracker).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an internal Docker service name', 'http://redis-api:6379'],
    ['a name whose DNS answer is private', 'https://rebind.attacker.example/'],
    ['a name with one private answer', 'https://mixed.attacker.example/'],
    ['a name with a ULA AAAA record', 'https://v6.attacker.example/'],
    ['a name that does not resolve', 'https://unknown.attacker.example/'],
    ['the cloud metadata IP', 'http://169.254.169.254/latest/meta-data/'],
    ['an IPv4 loopback literal', 'http://127.0.0.1:8545'],
    ['an integer-encoded loopback', 'http://2130706433:8545'],
    ['an IPv6 loopback literal', 'http://[::1]:8545'],
    ['an IPv4-mapped IPv6 literal', 'http://[::ffff:10.0.0.1]:8545'],
    ['a ULA IPv6 literal', 'http://[fd12:3456::1]:8545'],
    ['localhost', 'http://localhost:8545'],
    ['a non-http scheme', 'file:///etc/passwd'],
  ])('skips an App RPC override pointing at %s and still tracks', async (_case, rpcUrl) => {
    const urls = await trackedRpcUrls({ id: 'app-1' }, [{ rpcUrl: `enc:${rpcUrl}` }]);
    expect(urls).not.toContain(rpcUrl);
    expect(urls).toEqual([PUBLIC_FALLBACK]);
    expect(mocks.evmTracker).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[EVM TRACKER] Skipping App Overwrite RPC'));
  });

  it('keeps the safe overrides when only one of several is unsafe', async () => {
    const urls = await trackedRpcUrls({ id: 'app-1' }, [
      { rpcUrl: 'enc:http://169.254.169.254/' },
      { rpcUrl: 'enc:https://rpc.customer.example/v1/key' },
    ]);
    expect(urls).toContain('https://rpc.customer.example/v1/key');
    expect(urls).not.toContain('http://169.254.169.254/');
  });

  it('skips a QuickNode app name that rewrites the host', async () => {
    const urls = await trackedRpcUrls({
      id: 'app-1',
      quickNodeApiKey: 'enc:token',
      quickNodeAppName: '169.254.169.254#',
    });
    expect(urls).toEqual([PUBLIC_FALLBACK]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping App QuickNode RPC'));
  });

  it('skips a QuickNode app name that points at an internal host', async () => {
    const urls = await trackedRpcUrls({ id: 'app-1', quickNodeApiKey: 'enc:token', quickNodeAppName: 'redis-api/' });
    expect(urls).toEqual([PUBLIC_FALLBACK]);
  });

  it('skips a QuickNode key that is a full URL to a private host', async () => {
    const urls = await trackedRpcUrls({
      id: 'app-1',
      quickNodeApiKey: 'enc:http://10.0.0.8:8545/',
      quickNodeAppName: 'ignored',
    });
    expect(urls).toEqual([PUBLIC_FALLBACK]);
  });

  it('keeps a genuine QuickNode endpoint', async () => {
    const urls = await trackedRpcUrls({ id: 'app-1', quickNodeApiKey: 'enc:token', quickNodeAppName: 'my-app' });
    expect(urls).toContain('https://my-app.quiknode.pro/token/');
  });

  it('never calls DNS for the Alchemy and public fallbacks the operator controls', async () => {
    vi.stubEnv('ALCHEMY_API_KEY_FALLBACK', 'system-key');
    const urls = await trackedRpcUrls({ id: 'app-1', alchemyApiKey: 'enc:app-key' });
    expect(urls).toEqual(
      expect.arrayContaining([
        'https://eth-mainnet.g.alchemy.com/v2/app-key',
        'https://eth-mainnet.g.alchemy.com/v2/system-key',
        PUBLIC_FALLBACK,
      ]),
    );
    expect(mocks.dns.lookup).not.toHaveBeenCalled();
  });

  it('ignores an rpcUrl sent in the sync body', async () => {
    const urls = await trackedRpcUrls({ id: 'app-1' }, [], { rpcUrl: 'http://169.254.169.254/' });
    expect(urls).toEqual([PUBLIC_FALLBACK]);
  });

  it('rejects a plain-http override in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const urls = await trackedRpcUrls({ id: 'app-1' }, [{ rpcUrl: 'enc:http://rpc.customer.example/' }]);
    expect(urls).toEqual([PUBLIC_FALLBACK]);
  });

  it('allows a local node override when ALLOW_INTERNAL_WEBHOOKS=true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_INTERNAL_WEBHOOKS', 'true');
    const urls = await trackedRpcUrls({ id: 'app-1' }, [{ rpcUrl: 'enc:http://host.docker.internal:8545' }]);
    expect(urls).toContain('http://host.docker.internal:8545');
  });

  describe('priority order', () => {
    const OVERRIDE = 'https://rpc.customer.example/v1/key';
    const QUICKNODE = 'https://my-app.quiknode.pro/token/';

    it('hands the RPCs to fallback() in priority order, not alphabetically', async () => {
      vi.stubEnv('ALCHEMY_API_KEY_FALLBACK', 'system-key');
      const urls = await trackedRpcUrls(
        { id: 'app-1', alchemyApiKey: 'enc:app-key', quickNodeApiKey: 'enc:token', quickNodeAppName: 'my-app' },
        [{ rpcUrl: `enc:${OVERRIDE}` }],
      );
      // Sorted, both Alchemy URLs would come first and the customer's own RPC last.
      expect(urls).toEqual([
        OVERRIDE,
        'https://eth-mainnet.g.alchemy.com/v2/app-key',
        QUICKNODE,
        'https://eth-mainnet.g.alchemy.com/v2/system-key',
        PUBLIC_FALLBACK,
      ]);
    });

    it('does not share a cached config between the same RPCs in a different order', async () => {
      const run = await freshTracker();
      const first = await run({ id: 'app-1', quickNodeApiKey: `enc:${QUICKNODE}`, quickNodeAppName: 'x' }, [
        { rpcUrl: `enc:${OVERRIDE}` },
      ]);
      const second = await run({ id: 'app-2', quickNodeApiKey: `enc:${OVERRIDE}`, quickNodeAppName: 'x' }, [
        { rpcUrl: `enc:${QUICKNODE}` },
      ]);
      expect(first).toEqual([OVERRIDE, QUICKNODE, PUBLIC_FALLBACK]);
      expect(second).toEqual([QUICKNODE, OVERRIDE, PUBLIC_FALLBACK]);
    });

    it('still reuses the cached config for the same RPCs in the same order', async () => {
      const run = await freshTracker();
      const app = { id: 'app-1' };
      expect(await run(app, [{ rpcUrl: `enc:${OVERRIDE}` }])).toEqual([OVERRIDE, PUBLIC_FALLBACK]);
      expect(await run(app, [{ rpcUrl: `enc:${OVERRIDE}` }])).toEqual([]);
    });
  });
});
