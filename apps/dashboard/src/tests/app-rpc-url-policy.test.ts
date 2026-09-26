import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATCH as patchApp } from '@/app/api/v1/organizations/[orgId]/apps/[appId]/route';
import { POST as createApp } from '@/app/api/v1/organizations/[orgId]/apps/route';
import { Apps } from '@/collections/ContextEngine/Apps';

const mocks = vi.hoisted(() => ({
  dns: { lookup: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn() },
  authenticateRequest: vi.fn(),
  verifyOrgAccess: vi.fn(),
}));

vi.mock('dns/promises', () => ({ ...mocks.dns, default: mocks.dns }));

vi.mock('@/lib/redis', () => ({
  redisApi: { pipeline: vi.fn() },
  redis: { pipeline: vi.fn() },
  bgRedisSync: vi.fn(),
  getLimitKey: (orgId: string) => `{${orgId}}:limit`,
  getInternalSecret: vi.fn(),
}));

vi.mock('@tuwaio/shared/encryption', () => ({
  encrypt: vi.fn((val: string) => (!val || val.startsWith('qenc:') ? val : `qenc:${val}`)),
  decrypt: vi.fn((val: string) => (typeof val === 'string' && val.startsWith('qenc:') ? val.slice(5) : val)),
}));

vi.mock('@/lib/auth-utils', () => ({
  authenticateRequest: mocks.authenticateRequest,
  verifyOrgAccess: mocks.verifyOrgAccess,
}));

vi.mock('@/lib/apiWrapper', () => ({
  withRateLimit: (fn: unknown) => fn,
}));

vi.mock('@/lib/organizations', () => ({
  getUserOrgRole: vi.fn(),
}));

type Hook = (args: Record<string, unknown>) => Promise<Record<string, any>>;
const beforeChange = Apps.hooks!.beforeChange![0] as unknown as Hook;

function dnsAnswers(table: Record<string, string[]>) {
  const pick = (host: string, v6: boolean) => (table[host] ?? []).filter((a) => a.includes(':') === v6);
  mocks.dns.lookup.mockImplementation(async (host: string) =>
    (table[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  );
  mocks.dns.resolve4.mockImplementation(async (host: string) => pick(host, false));
  mocks.dns.resolve6.mockImplementation(async (host: string) => pick(host, true));
}

const payloadReq = { payload: { count: vi.fn().mockResolvedValue({ totalDocs: 0 }) } };

function create(data: Record<string, unknown>) {
  return beforeChange({ data: { organization: 'org_1', ...data }, req: payloadReq, operation: 'create' });
}

function update(data: Record<string, unknown>, originalDoc: Record<string, unknown>) {
  return beforeChange({ data, req: payloadReq, operation: 'update', originalDoc });
}

async function rejectionOf(promise: Promise<unknown>) {
  const error = (await promise.catch((e: unknown) => e)) as { status?: number; message?: string };
  expect(error).toBeInstanceOf(Error);
  return error;
}

describe('Apps collection: outbound RPC URLs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ALLOW_INTERNAL_WEBHOOKS', 'false');
    dnsAnswers({
      'rpc.customer.example': ['104.18.2.3'],
      'redis-api': ['172.18.0.4'],
      'rebind.attacker.example': ['10.0.0.5'],
      'mixed.attacker.example': ['104.18.2.3', '169.254.169.254'],
      'v6.attacker.example': ['fd00::9'],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('rpcConfigs at write time', () => {
    it('accepts and encrypts a public endpoint', async () => {
      const data = await create({ rpcConfigs: [{ chainId: '1', rpcUrl: 'https://rpc.customer.example/v2/key' }] });
      expect(data.rpcConfigs[0].rpcUrl).toBe('qenc:https://rpc.customer.example/v2/key');
    });

    it.each([
      ['an internal Docker service name', 'http://redis-api:6379'],
      ['a name whose DNS answer is private', 'https://rebind.attacker.example/'],
      ['a name with one private answer', 'https://mixed.attacker.example/'],
      ['a name with a ULA AAAA record', 'https://v6.attacker.example/'],
      ['a name that does not resolve', 'https://unknown.attacker.example/'],
      ['the cloud metadata IP', 'http://169.254.169.254/latest/meta-data/'],
      ['an IPv4 loopback literal', 'http://127.0.0.1:8545'],
      ['a decimal-encoded loopback', 'http://2130706433:8545'],
      ['an IPv6 loopback literal', 'http://[::1]:8545'],
      ['an IPv4-mapped IPv6 literal', 'http://[::ffff:10.0.0.1]/'],
      ['a link-local IPv6 literal', 'http://[fe80::1]/'],
      ['localhost', 'http://localhost:8545'],
    ])('rejects %s with a 400', async (_case, rpcUrl) => {
      const error = await rejectionOf(create({ rpcConfigs: [{ chainId: '1', rpcUrl }] }));
      expect(error.status).toBe(400);
      expect(error.message).toBe('RPC URL for chain 1 rejected: URL must point to a public host.');
    });

    it('rejects a non-http scheme and an unparsable value', async () => {
      expect(
        (await rejectionOf(create({ rpcConfigs: [{ chainId: '1', rpcUrl: 'file:///etc/passwd' }] }))).message,
      ).toBe('RPC URL for chain 1 rejected: URL must use http:// or https://.');
      expect((await rejectionOf(create({ rpcConfigs: [{ chainId: '1', rpcUrl: 'not a url' }] }))).message).toBe(
        'RPC URL for chain 1 rejected: URL is not a valid URL.',
      );
    });

    it('names the offending chain when only one of several URLs is unsafe', async () => {
      const error = await rejectionOf(
        create({
          rpcConfigs: [
            { chainId: '1', rpcUrl: 'https://rpc.customer.example/' },
            { chainId: '137', rpcUrl: 'http://redis-api:6379' },
          ],
        }),
      );
      expect(error.message).toContain('chain 137');
    });

    it('requires https in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const error = await rejectionOf(
        create({ rpcConfigs: [{ chainId: '1', rpcUrl: 'http://rpc.customer.example/' }] }),
      );
      expect(error.status).toBe(400);
      expect(error.message).toContain('must use https://');
    });

    it('accepts a local node when ALLOW_INTERNAL_WEBHOOKS=true', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ALLOW_INTERNAL_WEBHOOKS', 'true');
      const data = await create({ rpcConfigs: [{ chainId: '31337', rpcUrl: 'http://host.docker.internal:8545' }] });
      expect(data.rpcConfigs[0].rpcUrl).toBe('qenc:http://host.docker.internal:8545');
    });

    it('never echoes the URL, which may carry an API key', async () => {
      const error = await rejectionOf(
        create({ rpcConfigs: [{ chainId: '1', rpcUrl: 'http://127.0.0.1/v2/super-secret-key' }] }),
      );
      expect(error.message).not.toContain('super-secret-key');
      expect(error.message).not.toContain('127.0.0.1');
    });

    it('does not re-check a masked value restored from the stored document', async () => {
      const data = await update(
        { rpcConfigs: [{ chainId: '1', rpcUrl: 'https://...1234' }] },
        { rpcConfigs: [{ chainId: '1', rpcUrl: 'qenc:http://legacy-row.internal/' }] },
      );
      expect(data.rpcConfigs[0].rpcUrl).toBe('qenc:http://legacy-row.internal/');
      expect(mocks.dns.lookup).not.toHaveBeenCalled();
    });

    it('checks a new URL submitted on update', async () => {
      const error = await rejectionOf(
        update(
          { rpcConfigs: [{ chainId: '1', rpcUrl: 'http://169.254.169.254/' }] },
          { rpcConfigs: [{ chainId: '1', rpcUrl: 'qenc:https://rpc.customer.example/' }] },
        ),
      );
      expect(error.status).toBe(400);
    });

    it('rejects a masked value whose row cannot be restored instead of storing it', async () => {
      const error = await rejectionOf(
        update(
          { rpcConfigs: [{ chainId: '10', rpcUrl: 'https://...1234' }] },
          { rpcConfigs: [{ chainId: '1', rpcUrl: 'qenc:https://rpc.customer.example/' }] },
        ),
      );
      expect(error.status).toBe(400);
    });

    it('leaves an update without rpcConfigs alone', async () => {
      await update({ name: 'Renamed' }, { rpcConfigs: [{ chainId: '1', rpcUrl: 'qenc:http://10.0.0.1/' }] });
      expect(mocks.dns.lookup).not.toHaveBeenCalled();
    });
  });

  describe('quickNodeApiKey at write time', () => {
    it('rejects a full-URL key that points at a private host', async () => {
      const error = await rejectionOf(create({ quickNodeApiKey: 'http://10.0.0.8:8545/' }));
      expect(error.status).toBe(400);
      expect(error.message).toBe('QuickNode endpoint URL rejected: URL must point to a public host.');
    });

    it('accepts a public full-URL key', async () => {
      const data = await create({ quickNodeApiKey: 'https://rpc.customer.example/token/' });
      expect(data.quickNodeApiKey).toBe('qenc:https://rpc.customer.example/token/');
    });

    it('does not resolve a bare token', async () => {
      await create({ quickNodeApiKey: 'abc123token', quickNodeAppName: 'my-app' });
      expect(mocks.dns.lookup).not.toHaveBeenCalled();
    });

    it('does not re-check a masked key restored on update', async () => {
      const data = await update({ quickNodeApiKey: 'http://1...5678' }, { quickNodeApiKey: 'qenc:http://10.0.0.8/' });
      expect(data.quickNodeApiKey).toBe('qenc:http://10.0.0.8/');
      expect(mocks.dns.lookup).not.toHaveBeenCalled();
    });
  });

  describe('quickNodeAppName validation', () => {
    const field = Apps.fields.find((f) => 'name' in f && f.name === 'quickNodeAppName') as unknown as {
      validate: (value: unknown, options: { siblingData?: Record<string, unknown> }) => true | string;
    };
    const validate = (value: unknown, siblingData: Record<string, unknown> = { quickNodeApiKey: 'token' }) =>
      field.validate(value, { siblingData });

    it.each(['my-app', 'docs-demo.solana-mainnet', 'my_qn_app', 'App123'])('accepts %s', (name) => {
      expect(validate(name)).toBe(true);
    });

    it.each([
      '169.254.169.254#',
      'redis-api/',
      'evil.example?',
      'x@127.0.0.1',
      'host:8545',
      '[::1]',
      'my app',
      ' my-app',
      'a..b',
      '.leading',
      'back\\slash',
    ])('rejects %s', (name) => {
      expect(validate(name)).toMatch(/only/);
    });

    it('checks the name even without a key', () => {
      expect(validate('169.254.169.254#', {})).toMatch(/only/);
      expect(validate('', {})).toBe(true);
    });

    it('still requires a name next to a bare token', () => {
      expect(validate('')).toMatch(/Required/);
      expect(validate('', { quickNodeApiKey: 'https://rpc.customer.example/token/' })).toBe(true);
    });
  });

  describe('app routes answer 400 for a rejected URL', () => {
    let payloadCreate: ReturnType<typeof vi.fn>;
    let payloadUpdate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Both run the real collection hook, as Payload's local API does.
      payloadCreate = vi.fn(async ({ data }) => ({ ...(await create(data)), id: 'app_1', secretKey: 'qenc:sk' }));
      payloadUpdate = vi.fn(async ({ data }) =>
        update(data, { rpcConfigs: [{ chainId: '1', rpcUrl: 'qenc:https://rpc.customer.example/' }] }),
      );
      mocks.authenticateRequest.mockResolvedValue({
        payload: {
          create: payloadCreate,
          update: payloadUpdate,
          findByID: vi.fn().mockResolvedValue({ id: 'app_1', organization: 'org_1' }),
        },
        user: { id: 'user_1', email: 'owner@example.com' },
      });
      mocks.verifyOrgAccess.mockResolvedValue(true);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const post = (body: Record<string, unknown>) =>
      createApp(
        new Request('http://localhost/api/v1/organizations/org_1/apps', {
          method: 'POST',
          body: JSON.stringify({ name: 'App', organizationId: 'org_1', ...body }),
        }),
        { params: Promise.resolve({ orgId: 'org_1' }) },
      );

    const patch = (body: Record<string, unknown>) =>
      patchApp(
        new Request('http://localhost/api/v1/organizations/org_1/apps/app_1', {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ orgId: 'org_1', appId: 'app_1' }) },
      );

    it('POST returns 400 with the reason for an internal RPC URL', async () => {
      const res = await post({ rpcConfigs: [{ chainId: '1', rpcUrl: 'http://169.254.169.254/' }] });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'RPC URL for chain 1 rejected: URL must point to a public host.' });
    });

    it('POST creates the app for a public RPC URL', async () => {
      const res = await post({ rpcConfigs: [{ chainId: '1', rpcUrl: 'https://rpc.customer.example/' }] });
      expect(res.status).toBe(201);
    });

    it('POST still hides unexpected errors behind a 500', async () => {
      payloadCreate.mockRejectedValueOnce(new Error('connection refused to postgres:5432'));
      const res = await post({});
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    });

    it('PATCH returns 400 with the reason for an internal RPC URL', async () => {
      const res = await patch({ rpcConfigs: [{ chainId: '1', rpcUrl: 'http://[::1]:8545' }] });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('RPC URL for chain 1 rejected: URL must point to a public host.');
    });

    it('PATCH returns 400 for a QuickNode URL to a private host', async () => {
      const res = await patch({ quickNodeApiKey: 'http://redis-api:6379/' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('QuickNode endpoint URL rejected');
    });

    it('PATCH keeps answering 500 for errors without a client status', async () => {
      payloadUpdate.mockRejectedValueOnce(new Error('boom'));
      const res = await patch({ name: 'Renamed' });
      expect(res.status).toBe(500);
    });
  });
});
