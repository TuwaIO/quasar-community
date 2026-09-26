import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertSafeOutboundUrl,
  isInternalHost,
  isPrivateOrBlockedIP,
  normalizeIP,
  outboundUrlPolicyFromEnv,
  UnsafeUrlError,
} from './ssrf';

const dns = vi.hoisted(() => ({
  lookup: vi.fn(),
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

vi.mock('dns/promises', () => dns);

/** Answers for one hostname: `system` is what getaddrinfo (and /etc/hosts) returns. */
function answer(records: { system?: string[]; a?: string[]; aaaa?: string[] }) {
  dns.lookup.mockResolvedValue(
    (records.system ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  );
  dns.resolve4.mockResolvedValue(records.a ?? []);
  dns.resolve6.mockResolvedValue(records.aaaa ?? []);
}

async function rejection(url: string, policy = {}) {
  const error = await assertSafeOutboundUrl(url, policy).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UnsafeUrlError);
  return (error as UnsafeUrlError).reason;
}

describe('ssrf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    answer({});
  });

  describe('normalizeIP', () => {
    it('unwraps IPv4-mapped IPv6, URL brackets and zone ids', () => {
      expect(normalizeIP('::ffff:127.0.0.1')).toBe('127.0.0.1');
      expect(normalizeIP('::ffff:7f00:0001')).toBe('127.0.0.1');
      expect(normalizeIP('[::1]')).toBe('::1');
      expect(normalizeIP('[fe80::1%25eth0]')).toBe('fe80::1');
      expect(normalizeIP('FE80::1%eth0')).toBe('fe80::1');
    });
  });

  describe('isPrivateOrBlockedIP', () => {
    it.each([
      '127.0.0.1',
      '10.1.2.3',
      '172.18.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '192.88.99.1',
      '255.255.255.255',
    ])('blocks IPv4 %s', (ip) => {
      expect(isPrivateOrBlockedIP(ip)).toBe(true);
    });

    it.each([
      '::',
      '::1',
      '0:0:0:0:0:0:0:1',
      '::ffff:127.0.0.1',
      '::ffff:a9fe:a9fe', // 169.254.169.254
      '::ffff:0:10.0.0.1', // IPv4-translated
      '::127.0.0.1', // IPv4-compatible (deprecated)
      '64:ff9b::10.0.0.1', // NAT64 of a private address
      '64:ff9b:1::1', // local-use NAT64
      '2002:a00:1::1', // 6to4 of 10.0.0.1
      '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
      '2001:db8::1',
      '3fff::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'fec0::1',
      'ff02::1',
      '100::1',
    ])('blocks IPv6 %s', (ip) => {
      expect(isPrivateOrBlockedIP(ip)).toBe(true);
    });

    it.each(['8.8.8.8', '104.26.10.228', '2606:4700:4700::1111', '2a00:1450:4001::200e', '64:ff9b::808:808'])(
      'allows public %s',
      (ip) => {
        expect(isPrivateOrBlockedIP(ip)).toBe(false);
      },
    );

    it.each(['::ffff:8.8.8.8', '::ffff:0808:0808', '2002:808:808::1', '2606:4700:4700:0:0:0:0:1111', '2001:200::1'])(
      'judges embedded or fully written public address %s as public',
      (ip) => {
        expect(isPrivateOrBlockedIP(ip)).toBe(false);
      },
    );

    it.each(['FD00::1', 'FE80::1%eth0', '[::1]', '0:0:0:0:0:ffff:7f00:1', '2001:1ff:ffff::1'])(
      'normalizes before judging %s',
      (ip) => {
        expect(isPrivateOrBlockedIP(ip)).toBe(true);
      },
    );

    it.each([
      '1::2::3',
      '1:2:3:4:5:6:7:8:9',
      '1:2:3:4:5:6:7',
      '::1.2.3.256',
      '::g',
      '12345::1',
      '1:2:3:4:5:6:7::8',
      '999.1.1.1',
    ])('treats the malformed address %s as blocked', (ip) => {
      expect(isPrivateOrBlockedIP(ip)).toBe(true);
    });

    it('treats anything that is not an IP address as blocked', () => {
      expect(isPrivateOrBlockedIP('rpc.example.com')).toBe(true);
      expect(isPrivateOrBlockedIP('1:2:3')).toBe(true);
      expect(isPrivateOrBlockedIP('')).toBe(true);
    });
  });

  describe('isInternalHost', () => {
    it('blocks localhost names and an empty host without asking DNS', async () => {
      expect(await isInternalHost('')).toBe(true);
      expect(await isInternalHost('.')).toBe(true);
      expect(await isInternalHost('localhost')).toBe(true);
      expect(await isInternalHost('rpc.localhost.')).toBe(true);
      expect(dns.lookup).not.toHaveBeenCalled();
    });

    it('blocks an internal service name that resolves to a Docker address', async () => {
      answer({ system: ['172.18.0.7'], a: ['172.18.0.7'] });
      expect(await isInternalHost('redis-api')).toBe(true);
    });

    it('blocks a name /etc/hosts maps privately even when public DNS disagrees', async () => {
      answer({ system: ['10.0.0.5'], a: ['93.184.216.34'] });
      expect(await isInternalHost('rpc.example.com')).toBe(true);
    });

    it('blocks a name with an AAAA record in a private range', async () => {
      answer({ a: ['93.184.216.34'], aaaa: ['fd00::5'] });
      expect(await isInternalHost('rpc.example.com')).toBe(true);
    });

    it('blocks a name that does not resolve', async () => {
      dns.lookup.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
      dns.resolve4.mockRejectedValue(new Error('queryA ENOTFOUND'));
      dns.resolve6.mockRejectedValue(new Error('queryAaaa ENOTFOUND'));
      expect(await isInternalHost('nowhere.invalid')).toBe(true);
    });

    it('blocks a name whose resolvers all hang past the timeout', async () => {
      vi.useFakeTimers();
      try {
        const hang = () => new Promise<never>(() => undefined);
        dns.lookup.mockImplementation(hang);
        dns.resolve4.mockImplementation(hang);
        dns.resolve6.mockImplementation(hang);
        const verdict = isInternalHost('slow.attacker.example');
        await vi.advanceTimersByTimeAsync(3000);
        expect(await verdict).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('still sees a private answer from one resolver when another hangs', async () => {
      vi.useFakeTimers();
      try {
        dns.lookup.mockImplementation(() => new Promise<never>(() => undefined));
        dns.resolve4.mockResolvedValue(['10.1.1.1']);
        dns.resolve6.mockResolvedValue([]);
        const verdict = isInternalHost('half.attacker.example');
        await vi.advanceTimersByTimeAsync(3000);
        expect(await verdict).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores a resolver that returns something other than a list', async () => {
      dns.lookup.mockReturnValue(undefined);
      dns.resolve4.mockResolvedValue(['93.184.216.34']);
      dns.resolve6.mockRejectedValue(new Error('queryAaaa ENODATA'));
      expect(await isInternalHost('rpc.example.com')).toBe(false);
    });

    it('allows a name whose every answer is public', async () => {
      answer({ system: ['93.184.216.34'], a: ['93.184.216.34'], aaaa: ['2606:2800:220:1:248:1893:25c8:1946'] });
      expect(await isInternalHost('rpc.example.com')).toBe(false);
    });
  });

  describe('assertSafeOutboundUrl', () => {
    it.each([
      'http://127.0.0.1:8545',
      'http://169.254.169.254/latest/meta-data/',
      'http://2130706433/', // 127.0.0.1 as a decimal integer
      'http://0x7f000001/',
      'http://127.1/',
      'http://[::1]:8545/',
      'http://[::ffff:10.0.0.1]/',
      'http://[fd00::1]/',
      'http://localhost:8899',
    ])('rejects the IP literal or loopback URL %s', async (url) => {
      expect(await rejection(url)).toBe('internal-address');
    });

    it.each([
      'http://rpc.example.com@127.0.0.1/', // userinfo, not the host
      'http://user:pass@10.0.0.1/',
      'http://[::ffff:7f00:1]/',
      'http://[0:0:0:0:0:ffff:a9fe:a9fe]/',
      'http://0177.0.0.1/', // octal
      'http://169.254.169.254./', // trailing dot
      'http://LOCALHOST/',
      'http://api.localhost/',
    ])('rejects the disguised internal URL %s', async (url) => {
      expect(await rejection(url)).toBe('internal-address');
    });

    it('rejects a nip.io-style name that resolves to loopback', async () => {
      answer({ system: ['127.0.0.1'], a: ['127.0.0.1'] });
      expect(await rejection('https://127.0.0.1.nip.io/')).toBe('internal-address');
    });

    it('trims surrounding whitespace before parsing', async () => {
      answer({ a: ['93.184.216.34'] });
      const url = await assertSafeOutboundUrl('  https://rpc.example.com/v1  ');
      expect(url.href).toBe('https://rpc.example.com/v1');
    });

    it('rejects a hostname whose DNS answer is private', async () => {
      answer({ a: ['10.0.0.5'] });
      expect(await rejection('https://rpc.attacker.example/')).toBe('internal-address');
    });

    it('rejects non-http schemes and garbage', async () => {
      expect(await rejection('file:///etc/passwd')).toBe('unsupported-protocol');
      expect(await rejection('gopher://rpc.example.com/')).toBe('unsupported-protocol');
      expect(await rejection('not a url')).toBe('invalid-url');
      expect(await rejection('https://abcd...wxyz')).toBe('internal-address');
    });

    it('requires https when the policy says so', async () => {
      answer({ a: ['93.184.216.34'] });
      expect(await rejection('http://rpc.example.com/', { requireHttps: true })).toBe('https-required');
      await expect(assertSafeOutboundUrl('https://rpc.example.com/', { requireHttps: true })).resolves.toBeInstanceOf(
        URL,
      );
    });

    it('lets everything http(s) through with allowInternal', async () => {
      const url = await assertSafeOutboundUrl('http://host.docker.internal:8545', {
        allowInternal: true,
        requireHttps: true,
      });
      expect(url.hostname).toBe('host.docker.internal');
      expect(await rejection('file:///etc/passwd', { allowInternal: true })).toBe('unsupported-protocol');
    });

    it('never puts the URL, which may carry an API key, into the error message', async () => {
      const error = (await assertSafeOutboundUrl('http://127.0.0.1/v2/secret-key').catch((e) => e)) as Error;
      expect(error.message).not.toContain('secret-key');
      expect(error.message).not.toContain('127.0.0.1');
    });
  });

  describe('outboundUrlPolicyFromEnv', () => {
    it('reads ALLOW_INTERNAL_WEBHOOKS and NODE_ENV', () => {
      expect(outboundUrlPolicyFromEnv({ NODE_ENV: 'production' })).toEqual({
        allowInternal: false,
        requireHttps: true,
      });
      expect(outboundUrlPolicyFromEnv({ NODE_ENV: 'development', ALLOW_INTERNAL_WEBHOOKS: 'true' })).toEqual({
        allowInternal: true,
        requireHttps: false,
      });
    });
  });
});
