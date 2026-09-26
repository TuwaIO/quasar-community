import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processSolanaTx } from './solana';

const mocks = vi.hoisted(() => ({
  dns: { lookup: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn() },
  initializePollingTracker: vi.fn(),
}));

vi.mock('dns/promises', () => mocks.dns);

vi.mock('@tuwaio/pulsar-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tuwaio/pulsar-core')>()),
  initializePollingTracker: (args: unknown) => mocks.initializePollingTracker(args),
}));

vi.mock('@tuwaio/pulsar-solana', () => ({
  solanaFetcher: vi.fn(),
}));

// Stored values are plain in these tests; `enc:` marks the ones the tracker has to decrypt.
vi.mock('@tuwaio/shared/encryption', () => ({
  decrypt: vi.fn((val: string) => (typeof val === 'string' && val.startsWith('enc:') ? val.slice(4) : val)),
}));

const MAINNET_PUBLIC = 'https://api.mainnet-beta.solana.com';
const DEVNET_PUBLIC = 'https://api.devnet.solana.com';

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

const counter = () => ({ inc: vi.fn(), set: vi.fn() }) as any;

/** Runs the tracker and returns the single RPC URL it polls with. */
async function trackedRpcUrl(
  app: Record<string, unknown> | undefined,
  rpcConfigs: { rpcUrl: string }[] = [],
  txExtra: Record<string, unknown> = {},
): Promise<string> {
  const tx: any = {
    txKey: '5VERsig',
    chainId: 'solana:mainnet',
    appId: 'app-1',
    ownerId: 'org-1',
    ...txExtra,
  };
  await processSolanaTx(tx, vi.fn(), vi.fn(), makeDb(app, rpcConfigs) as any, counter(), counter(), counter());
  expect(mocks.initializePollingTracker).toHaveBeenCalledTimes(1);
  return mocks.initializePollingTracker.mock.calls[0][0].tx.rpcUrl;
}

describe('processSolanaTx RPC selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ALLOW_INTERNAL_WEBHOOKS', 'false');
    vi.stubEnv('ALCHEMY_API_KEY_FALLBACK', '');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dnsAnswers({
      'solana.customer.example': ['104.18.2.3'],
      'my-app.solana-mainnet.quiknode.pro': ['104.18.3.4'],
      'redis-api': ['172.18.0.4'],
      'rebind.attacker.example': ['10.0.0.5'],
      'v6.attacker.example': ['fe80::5'],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('client hint (tx.rpcUrl from the sync body)', () => {
    it.each([
      'http://169.254.169.254/latest/meta-data/',
      'http://redis-api:6379',
      'http://[::1]:8899',
      'https://solana.customer.example/',
    ])('is never used, even when it is %s', async (rpcUrl) => {
      expect(await trackedRpcUrl(undefined, [], { rpcUrl })).toBe(MAINNET_PUBLIC);
      expect(mocks.dns.lookup).not.toHaveBeenCalled();
    });

    it('does not outrank the system Alchemy key', async () => {
      vi.stubEnv('ALCHEMY_API_KEY_FALLBACK', 'system-key');
      expect(await trackedRpcUrl(undefined, [], { rpcUrl: 'https://solana.customer.example/' })).toBe(
        'https://solana-mainnet.g.alchemy.com/v2/system-key',
      );
    });

    it('uses the devnet public RPC for devnet', async () => {
      expect(await trackedRpcUrl(undefined, [], { chainId: 'solana:devnet', rpcUrl: 'http://10.0.0.1/' })).toBe(
        DEVNET_PUBLIC,
      );
    });

    it('no longer rescues a cluster without any other RPC', async () => {
      const tx: any = {
        txKey: '5VERsig',
        chainId: 'solana:testnet',
        appId: 'app-1',
        ownerId: 'org-1',
        rpcUrl: 'https://api.testnet.solana.com',
      };
      await expect(
        processSolanaTx(tx, vi.fn(), vi.fn(), makeDb(undefined) as any, counter(), counter(), counter()),
      ).rejects.toThrow('No valid RPC URLs found for chain solana:testnet');
      expect(mocks.initializePollingTracker).not.toHaveBeenCalled();
    });
  });

  describe('App RPC override', () => {
    it('is used first when it is public', async () => {
      expect(await trackedRpcUrl({ id: 'app-1' }, [{ rpcUrl: 'enc:https://solana.customer.example/key' }])).toBe(
        'https://solana.customer.example/key',
      );
    });

    it.each([
      ['an internal Docker service name', 'http://redis-api:6379'],
      ['a name whose DNS answer is private', 'https://rebind.attacker.example/'],
      ['a name with a link-local AAAA record', 'https://v6.attacker.example/'],
      ['a name that does not resolve', 'https://unknown.attacker.example/'],
      ['the cloud metadata IP', 'http://169.254.169.254/'],
      ['an IPv6 loopback literal', 'http://[::1]:8899'],
      ['an IPv4-mapped IPv6 literal', 'http://[::ffff:127.0.0.1]:8899'],
      ['a hex-encoded loopback', 'http://0x7f000001:8899'],
    ])('is skipped when it points at %s', async (_case, rpcUrl) => {
      expect(await trackedRpcUrl({ id: 'app-1' }, [{ rpcUrl: `enc:${rpcUrl}` }])).toBe(MAINNET_PUBLIC);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[SOLANA TRACKER] Skipping App Overwrite RPC'));
    });

    it('fails the cluster when the only RPC is unsafe', async () => {
      const tx: any = { txKey: '5VERsig', chainId: 'solana:localnet', appId: 'app-1', ownerId: 'org-1' };
      await expect(
        processSolanaTx(
          tx,
          vi.fn(),
          vi.fn(),
          makeDb({ id: 'app-1' }, [{ rpcUrl: 'enc:http://127.0.0.1:8899' }]) as any,
          counter(),
          counter(),
          counter(),
        ),
      ).rejects.toThrow('No valid RPC URLs found for chain solana:localnet');
    });

    it('may point at a local validator when ALLOW_INTERNAL_WEBHOOKS=true', async () => {
      vi.stubEnv('ALLOW_INTERNAL_WEBHOOKS', 'true');
      expect(
        await trackedRpcUrl({ id: 'app-1' }, [{ rpcUrl: 'enc:http://127.0.0.1:8899' }], { chainId: 'solana:localnet' }),
      ).toBe('http://127.0.0.1:8899');
    });

    it('must be https in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(await trackedRpcUrl({ id: 'app-1' }, [{ rpcUrl: 'enc:http://solana.customer.example/' }])).toBe(
        MAINNET_PUBLIC,
      );
    });
  });

  describe('App QuickNode', () => {
    it('is used when the endpoint is genuine', async () => {
      expect(
        await trackedRpcUrl({ id: 'app-1', quickNodeApiKey: 'enc:token', quickNodeAppName: 'my-app.solana-mainnet' }),
      ).toBe('https://my-app.solana-mainnet.quiknode.pro/token/');
    });

    it.each([
      ['an app name that rewrites the host', { quickNodeApiKey: 'enc:token', quickNodeAppName: '169.254.169.254#' }],
      ['an app name with userinfo', { quickNodeApiKey: 'enc:token', quickNodeAppName: 'x@127.0.0.1/' }],
      ['a full-URL key to a private host', { quickNodeApiKey: 'enc:http://192.168.1.5:8899/', quickNodeAppName: 'x' }],
    ])('is skipped for %s', async (_case, fields) => {
      expect(await trackedRpcUrl({ id: 'app-1', ...fields })).toBe(MAINNET_PUBLIC);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping App QuickNode RPC'));
    });
  });
});
