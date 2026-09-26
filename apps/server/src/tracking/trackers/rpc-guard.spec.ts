import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isUsableRpcUrl } from './rpc-guard';

const dns = vi.hoisted(() => ({
  lookup: vi.fn(),
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

vi.mock('dns/promises', () => dns);

function resolveTo(addresses: string[]) {
  dns.lookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  dns.resolve4.mockResolvedValue(addresses.filter((a) => !a.includes(':')));
  dns.resolve6.mockResolvedValue(addresses.filter((a) => a.includes(':')));
}

describe('isUsableRpcUrl', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ALLOW_INTERNAL_WEBHOOKS', 'false');
    resolveTo([]);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockRestore();
  });

  it('accepts an endpoint whose every address is public', async () => {
    resolveTo(['104.18.2.3', '2606:4700::6812:203']);
    expect(await isUsableRpcUrl('https://eth.rpc.example.com/v1/key', '[TEST]', 'App Overwrite')).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['internal Docker service name', 'http://redis-api:6379', ['172.18.0.4']],
    ['name resolving to RFC 1918', 'https://rpc.attacker.example/', ['10.0.0.5']],
    ['name with one private answer among public ones', 'https://rpc.attacker.example/', ['8.8.8.8', '192.168.0.10']],
    ['name resolving to a ULA IPv6', 'https://rpc.attacker.example/', ['fd00::10']],
    ['name resolving to IPv4-mapped loopback', 'https://rpc.attacker.example/', ['::ffff:127.0.0.1']],
    ['name that does not resolve', 'https://gone.attacker.example/', []],
  ])('rejects a %s', async (_case, url, addresses) => {
    resolveTo(addresses);
    expect(await isUsableRpcUrl(url, '[TEST]', 'App Overwrite')).toBe(false);
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://127.0.0.1:8545',
    'http://[::1]:8545',
    'http://[fe80::1]:8545',
    'http://[::ffff:a9fe:a9fe]/',
    'http://0x7f000001:8545',
    'http://localhost:8899',
  ])('rejects the IP literal or loopback URL %s without a DNS query', async (url) => {
    expect(await isUsableRpcUrl(url, '[TEST]', 'App Overwrite')).toBe(false);
    expect(dns.resolve4).not.toHaveBeenCalled();
  });

  it('rejects a non-http scheme and an unparsable value', async () => {
    expect(await isUsableRpcUrl('file:///etc/passwd', '[TEST]', 'App Overwrite')).toBe(false);
    expect(await isUsableRpcUrl('not a url', '[TEST]', 'App Overwrite')).toBe(false);
  });

  it('requires https in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    resolveTo(['104.18.2.3']);
    expect(await isUsableRpcUrl('http://rpc.example.com/', '[TEST]', 'App Overwrite')).toBe(false);
    expect(await isUsableRpcUrl('https://rpc.example.com/', '[TEST]', 'App Overwrite')).toBe(true);
  });

  it('lets private and plain-http endpoints through when ALLOW_INTERNAL_WEBHOOKS=true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_INTERNAL_WEBHOOKS', 'true');
    expect(await isUsableRpcUrl('http://host.docker.internal:8545', '[TEST]', 'App Overwrite')).toBe(true);
    expect(await isUsableRpcUrl('http://127.0.0.1:8545', '[TEST]', 'App Overwrite')).toBe(true);
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('logs the source and the reason, never the URL with its API key', async () => {
    await isUsableRpcUrl('http://127.0.0.1:8545/v2/super-secret-key', '[EVM TRACKER]', 'App Overwrite');
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('[EVM TRACKER] Skipping App Overwrite RPC');
    expect(line).not.toContain('super-secret-key');
    expect(line).not.toContain('127.0.0.1');
  });
});
