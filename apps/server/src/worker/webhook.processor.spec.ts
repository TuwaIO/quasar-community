import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { QUOTA_DEFAULTS } from '@tuwaio/shared/constants';
import { isPrivateOrBlockedIP, normalizeIP } from '@tuwaio/shared/ssrf';
import { getToken } from '@willsoto/nestjs-prometheus';
import { Job } from 'bullmq';
import * as http from 'http';
import { Redis } from 'ioredis';
import { AddressInfo } from 'net';
import { Counter, Histogram } from 'prom-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, MockProxy } from 'vitest-mock-extended';
import * as zlib from 'zlib';

import { WEBHOOK_DELIVERY_METRIC, WEBHOOK_LATENCY_METRIC } from '../constants';
import { DRIZZLE } from '../database/database.module';
import { REDIS } from '../redis/redis.module';
import { redactUrl, WebhookProcessor } from './webhook.processor';

// Mock DNS resolution to control SSRF behavior
const mockResolve4 = vi.fn();
const mockResolve6 = vi.fn();
const mockLookup = vi.fn();
vi.mock('dns/promises', () => ({
  resolve4: (...args: any[]) => mockResolve4(...args),
  resolve6: (...args: any[]) => mockResolve6(...args),
  lookup: (...args: any[]) => mockLookup(...args),
}));

// Mock Encryption
vi.mock('@tuwaio/shared/encryption', () => ({
  decrypt: vi.fn((val: string) => `decrypted_${val}`),
}));

describe('WebhookProcessor — Security, Streaming Limits & SSRF Hardening (WEB-01)', () => {
  let processor: WebhookProcessor;
  let redis: MockProxy<Redis>;
  let db: MockProxy<any>;
  let configService: MockProxy<ConfigService> & { get: any };
  let deliveryCounter: MockProxy<Counter<string>>;
  let latencyHistogram: MockProxy<Histogram<string>>;

  beforeEach(async () => {
    redis = mock<Redis>();
    db = mock<any>();
    configService = mock<ConfigService>() as any;
    deliveryCounter = mock<Counter<string>>();
    latencyHistogram = mock<Histogram<string>>();

    mockResolve4.mockReset();
    mockResolve6.mockReset();
    mockLookup.mockReset();

    mockResolve4.mockResolvedValue(['8.8.8.8']);
    mockResolve6.mockResolvedValue([]);

    db.insert.mockReturnThis();
    db.values.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookProcessor,
        { provide: REDIS, useValue: redis },
        { provide: DRIZZLE, useValue: db },
        { provide: ConfigService, useValue: configService },
        { provide: getToken(WEBHOOK_DELIVERY_METRIC), useValue: deliveryCounter },
        { provide: getToken(WEBHOOK_LATENCY_METRIC), useValue: latencyHistogram },
      ],
    }).compile();

    processor = module.get<WebhookProcessor>(WebhookProcessor);
  });

  const createMockJob = (
    url: string,
    payload: any = {},
    overrides?: { orgId?: string; appId?: string; endpointOrgId?: string; endpointAppId?: string },
  ): Job<any> => {
    const orgId = overrides?.orgId ?? 'org_123';
    const appId = overrides?.appId ?? 'app_123';
    return {
      data: {
        endpoint: {
          id: 'endpoint_1',
          url,
          signingSecret: 'my_signing_secret',
          organizationId: overrides?.endpointOrgId ?? orgId,
          appId: overrides?.endpointAppId ?? appId,
        },
        payload,
        txKey: 'tx_999',
        txType: 'transaction:confirmed',
        appId,
        organizationId: orgId,
      },
      attemptsMade: 0,
      opts: {
        attempts: 5,
      },
    } as any;
  };

  describe('IP Classification & SSRF Defense Rules (isPrivateOrBlockedIP & normalizeIP)', () => {
    it('normalizes IPv4-mapped IPv6 strings to standard IPv4', () => {
      expect(normalizeIP('::ffff:127.0.0.1')).toBe('127.0.0.1');
      expect(normalizeIP('::ffff:10.0.0.1')).toBe('10.0.0.1');
      expect(normalizeIP('::ffff:7f00:1')).toBe('127.0.0.1');
      expect(normalizeIP('::ffff:7f00:0001')).toBe('127.0.0.1');
      expect(normalizeIP('fe80::1%eth0')).toBe('fe80::1');
    });

    it('identifies and blocks all private, loopback, CGNAT, link-local, and reserved ranges', () => {
      // Loopback
      expect(isPrivateOrBlockedIP('127.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedIP('127.0.0.2')).toBe(true);
      expect(isPrivateOrBlockedIP('127.255.255.255')).toBe(true);
      expect(isPrivateOrBlockedIP('::1')).toBe(true);
      expect(isPrivateOrBlockedIP('::ffff:127.0.0.1')).toBe(true);

      // Unspecified
      expect(isPrivateOrBlockedIP('0.0.0.0')).toBe(true);
      expect(isPrivateOrBlockedIP('::')).toBe(true);

      // RFC 1918 Private ranges
      expect(isPrivateOrBlockedIP('10.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedIP('10.255.255.255')).toBe(true);
      expect(isPrivateOrBlockedIP('172.16.0.1')).toBe(true);
      expect(isPrivateOrBlockedIP('172.20.100.5')).toBe(true);
      expect(isPrivateOrBlockedIP('172.31.255.255')).toBe(true);
      expect(isPrivateOrBlockedIP('192.168.1.1')).toBe(true);
      expect(isPrivateOrBlockedIP('192.168.254.254')).toBe(true);

      // CGNAT (100.64.0.0/10)
      expect(isPrivateOrBlockedIP('100.64.0.1')).toBe(true);
      expect(isPrivateOrBlockedIP('100.100.50.1')).toBe(true);
      expect(isPrivateOrBlockedIP('100.127.255.254')).toBe(true);

      // Link-Local
      expect(isPrivateOrBlockedIP('169.254.169.254')).toBe(true);
      expect(isPrivateOrBlockedIP('fe80::1')).toBe(true);
      expect(isPrivateOrBlockedIP('fe80::200:5aee:feaa:20a2')).toBe(true);

      // Multicast & Reserved/Broadcast
      expect(isPrivateOrBlockedIP('224.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedIP('239.255.255.250')).toBe(true);
      expect(isPrivateOrBlockedIP('240.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedIP('255.255.255.255')).toBe(true);
      expect(isPrivateOrBlockedIP('ff02::1')).toBe(true);

      // Documentation & Benchmarking
      expect(isPrivateOrBlockedIP('192.0.2.1')).toBe(true);
      expect(isPrivateOrBlockedIP('198.51.100.1')).toBe(true);
      expect(isPrivateOrBlockedIP('203.0.113.1')).toBe(true);
      expect(isPrivateOrBlockedIP('198.18.0.1')).toBe(true);
      expect(isPrivateOrBlockedIP('2001:db8::1')).toBe(true);

      // Unique Local IPv6 (ULA)
      expect(isPrivateOrBlockedIP('fc00::1')).toBe(true);
      expect(isPrivateOrBlockedIP('fd00::1')).toBe(true);
    });

    it('allows valid public IPv4 and IPv6 addresses', () => {
      expect(isPrivateOrBlockedIP('8.8.8.8')).toBe(false);
      expect(isPrivateOrBlockedIP('1.1.1.1')).toBe(false);
      expect(isPrivateOrBlockedIP('93.184.216.34')).toBe(false);
      expect(isPrivateOrBlockedIP('104.26.10.228')).toBe(false);
      expect(isPrivateOrBlockedIP('2606:4700:4700::1111')).toBe(false);
    });
  });

  describe('URL & Diagnostic Sanitization (redactUrl)', () => {
    it('redacts basic-auth credentials and secret query parameters', () => {
      const sensitiveUrl =
        'https://admin:mySecretPass123@example.com/api/webhook?apiKey=sk_live_123&token=tok_456&signature=sig_789&eventId=evt_1';
      const redacted = redactUrl(sensitiveUrl);

      expect(redacted).not.toContain('admin');
      expect(redacted).not.toContain('mySecretPass123');
      expect(redacted).not.toContain('sk_live_123');
      expect(redacted).not.toContain('tok_456');
      expect(redacted).not.toContain('sig_789');
      expect(redacted).toContain('https://***:***@example.com/api/webhook');
      expect(redacted).toContain('apiKey=***MASKED***');
      expect(redacted).toContain('token=***MASKED***');
      expect(redacted).toContain('signature=***MASKED***');
      expect(redacted).toContain('eventId=evt_1');
    });
  });

  describe('Worker Processing & SSRF Rejection', () => {
    it('rejects internal URLs when ALLOW_INTERNAL_WEBHOOKS is false', async () => {
      configService.get.mockReturnValue('false');
      mockResolve4.mockResolvedValue(['127.0.0.1']);

      const job = createMockJob('http://localhost/webhook');
      await expect(processor.process(job)).rejects.toThrow('SSRF Blocked: Internal IP detected');
    });

    it('rejects IPv4-mapped IPv6 and CGNAT hostnames', async () => {
      configService.get.mockReturnValue('false');

      mockResolve6.mockResolvedValue(['::ffff:127.0.0.1']);
      mockResolve4.mockResolvedValue([]);
      await expect(processor.process(createMockJob('http://mapped-ipv6.local/webhook'))).rejects.toThrow(
        'SSRF Blocked: Internal IP detected',
      );

      mockResolve6.mockResolvedValue([]);
      mockResolve4.mockResolvedValue(['100.64.1.5']); // CGNAT
      await expect(processor.process(createMockJob('http://cgnat.local/webhook'))).rejects.toThrow(
        'SSRF Blocked: Internal IP detected',
      );
    });

    it('rejects mixed public and private DNS answers', async () => {
      configService.get.mockReturnValue('false');
      mockResolve4.mockResolvedValue(['93.184.216.34', '10.0.0.5']);

      const job = createMockJob('https://mixed-dns.example.com/webhook');
      await expect(processor.process(job)).rejects.toThrow('SSRF Blocked: Internal IP detected');
    });

    it('rejects job when tenant organization does not match endpoint organization', async () => {
      configService.get.mockReturnValue('false');
      mockResolve4.mockResolvedValue(['8.8.8.8']);

      const forgedJob = createMockJob(
        'https://public.example.com/webhook',
        {},
        {
          orgId: 'org_victim',
          endpointOrgId: 'org_attacker',
        },
      );

      await expect(processor.process(forgedJob)).rejects.toThrow('Tenant mismatch');
    });

    it('rejects job when app does not match endpoint app', async () => {
      configService.get.mockReturnValue('false');
      mockResolve4.mockResolvedValue(['8.8.8.8']);

      const forgedJob = createMockJob(
        'https://public.example.com/webhook',
        {},
        {
          appId: 'app_victim',
          endpointAppId: 'app_attacker',
        },
      );

      await expect(processor.process(forgedJob)).rejects.toThrow('App mismatch');
    });

    it('relays localhost webhooks to Redis Pub/Sub in production without outbound HTTP', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      configService.get.mockReturnValue('false');

      try {
        const localhostJob = createMockJob('http://localhost:3000/api/webhooks/quasar', {
          action: 'increment',
          txKey: '0xabc123',
        });

        await processor.process(localhostJob);

        expect(redis.publish).toHaveBeenCalledWith(
          `relay:webhook:${localhostJob.data.endpoint.id}`,
          expect.stringContaining('"event":"increment"'),
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('Streaming Limits, Decompression Bombs & Timeouts (Live HTTP Server)', () => {
    let server: http.Server;
    let serverPort: number;

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        if (url.pathname === '/oversized-plain') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          // Stream 10 chunks of 10KB (total 100KB > 64KB limit)
          const chunk = Buffer.alloc(10 * 1024, 'a');
          const interval = setInterval(() => {
            if (!res.writableEnded) {
              res.write(chunk);
            }
          }, 20);

          setTimeout(() => {
            clearInterval(interval);
            res.end();
          }, 500);
        } else if (url.pathname === '/decompression-bomb') {
          // Send tiny compressed body (e.g. 1KB) that expands to 200KB
          const bigData = Buffer.alloc(200 * 1024, 'x');
          const gzipped = zlib.gzipSync(bigData);

          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'Content-Encoding': 'gzip',
          });
          res.end(gzipped);
        } else if (url.pathname === '/slow-headers') {
          // Never send headers, test connect/headers timeout
        } else if (url.pathname === '/slow-body') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.write('initial chunk');
          // Then hang without ending or sending more chunks
        } else if (url.pathname === '/redirect-loop') {
          res.writeHead(302, { Location: `http://127.0.0.1:${serverPort}/redirect-loop` });
          res.end();
        } else if (url.pathname === '/redirect-to-ssrf') {
          res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
          res.end();
        } else if (url.pathname === '/valid') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ received: true }));
        }
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          serverPort = (server.address() as AddressInfo).port;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('aborts plain response streaming immediately when exceeding maxResponseBytes', async () => {
      configService.get.mockReturnValue('true'); // Allow local connection for test server

      const targetUrl = `http://127.0.0.1:${serverPort}/oversized-plain`;
      await expect(
        processor.makeRequest(
          targetUrl,
          { method: 'POST', headers: {}, body: '{}' },
          { maxResponseBytes: 32 * 1024 }, // 32 KB limit
        ),
      ).rejects.toThrow(/Response transfer size exceeded limit/);
    });

    it('aborts gzipped response stream when decompressed size exceeds maxDecompressedBytes (decompression bomb protection)', async () => {
      configService.get.mockReturnValue('true');

      const targetUrl = `http://127.0.0.1:${serverPort}/decompression-bomb`;
      await expect(
        processor.makeRequest(
          targetUrl,
          { method: 'POST', headers: {}, body: '{}' },
          { maxDecompressedBytes: 32 * 1024 }, // 32 KB limit
        ),
      ).rejects.toThrow(/Decompressed response size exceeded limit/);
    });

    it('aborts request on headers timeout', async () => {
      configService.get.mockReturnValue('true');

      const targetUrl = `http://127.0.0.1:${serverPort}/slow-headers`;
      await expect(
        processor.makeRequest(
          targetUrl,
          { method: 'POST', headers: {}, body: '{}' },
          { headersTimeoutMs: 150, totalTimeoutMs: 500 },
        ),
      ).rejects.toThrow(/Headers\/TTFB timeout/);
    });

    it('aborts request on body transfer idle timeout', async () => {
      configService.get.mockReturnValue('true');

      const targetUrl = `http://127.0.0.1:${serverPort}/slow-body`;
      await expect(
        processor.makeRequest(
          targetUrl,
          { method: 'POST', headers: {}, body: '{}' },
          { bodyTimeoutMs: 150, totalTimeoutMs: 500 },
        ),
      ).rejects.toThrow(/Body transfer idle timeout/);
    });

    it('rejects when maximum redirects are exceeded', async () => {
      configService.get.mockReturnValue('true');

      const targetUrl = `http://127.0.0.1:${serverPort}/redirect-loop`;
      await expect(
        processor.makeRequest(
          targetUrl,
          { method: 'POST', headers: {}, body: '{}' },
          { maxRedirects: 2, totalTimeoutMs: 1000 },
        ),
      ).rejects.toThrow(/Maximum redirect limit/);
    });

    it('blocks redirect attempting SSRF to link-local metadata address', async () => {
      configService.get.mockReturnValue('false'); // Disallow SSRF
      mockResolve4.mockResolvedValue(['169.254.169.254']);

      const targetUrl = `http://127.0.0.1:${serverPort}/redirect-to-ssrf`;
      await expect(
        processor.makeRequest(targetUrl, { method: 'POST', headers: {}, body: '{}' }, { totalTimeoutMs: 1000 }),
      ).rejects.toThrow(/SSRF Blocked/);
    });

    it('rejects non-HTTP webhook protocols before any network request', async () => {
      configService.get.mockReturnValue('true');

      await expect(
        processor.makeRequest('ftp://public.example.com/webhook', { method: 'POST', headers: {}, body: '{}' }),
      ).rejects.toThrow(/Unsupported webhook URL protocol/);
    });
  });

  describe('Quota Tracking & DB Logging Sanitization', () => {
    it('increments usage quota on first attempt', async () => {
      configService.get.mockReturnValue('false');
      mockResolve4.mockResolvedValue(['8.8.8.8']);

      vi.spyOn(processor, 'makeRequest').mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      const job = createMockJob('https://public-api.example.com/webhook');
      await processor.process(job);

      expect(redis.incrbyfloat).toHaveBeenCalledWith('{org_123}:usage', QUOTA_DEFAULTS.WEBHOOK_DELIVERY_WEIGHT);
      expect(redis.expire).toHaveBeenCalledWith('{org_123}:usage', 604800);
    });

    it('masks sensitive fields in requestPayload and responseBody before DB persistence', async () => {
      configService.get.mockReturnValue('false');
      mockResolve4.mockResolvedValue(['8.8.8.8']);

      vi.spyOn(processor, 'makeRequest').mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ secretKey: 'dont-leak-me', status: 'saved' }),
      });

      const sensitivePayload = {
        secretKey: 'my-super-secret-key-value',
        password: 'mypassword123',
        apiKey: 'api_key_123',
        publicToken: 'token123',
        txKey: '0xd99642a8d5b16b8c6e17c751dba39f735e85bc661b4b77b22057',
      };

      const job = createMockJob('https://public-api.example.com/webhook', sensitivePayload);
      await processor.process(job);

      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          requestPayload: expect.objectContaining({
            secretKey: '***MASKED***',
            password: '***MASKED***',
            apiKey: '***MASKED***',
            publicToken: '***MASKED***',
            txKey: '0xd99642a8d5b16b8c6e17c751dba39f735e85bc661b4b77b22057',
          }),
          responseBody: JSON.stringify({ secretKey: '***MASKED***', status: 'saved' }),
        }),
      );
    });
  });
});
