import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createId } from '@paralleldrive/cuid2';
import { QUOTA_DEFAULTS } from '@tuwaio/shared/constants';
import { decrypt } from '@tuwaio/shared/encryption';
import { isLocalhostUrl } from '@tuwaio/shared/utils';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Job } from 'bullmq';
import { createHmac } from 'crypto';
import { lookup as callbackLookup } from 'dns';
import { lookup, resolve4, resolve6 } from 'dns/promises';
import { and, desc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as http from 'http';
import * as https from 'https';
import { Redis } from 'ioredis';
import { isIP } from 'net';
import { Counter, Histogram } from 'prom-client';
import * as zlib from 'zlib';

import { WEBHOOK_DELIVERY_METRIC, WEBHOOK_LATENCY_METRIC } from '../constants';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema/index';
import { REDIS } from '../redis/redis.module';

export interface WebhookJobData {
  deliveryId?: string;
  endpoint: {
    id: string;
    url: string;
    signingSecret: string;
    organizationId: string;
    appId?: string;
  };
  payload: any;
  txKey: string;
  txType: string;
  appId: string;
  organizationId?: string;
}

/**
 * Normalizes an IPv4 or IPv6 address string.
 * Converts IPv4-mapped IPv6 (e.g. `::ffff:127.0.0.1` or hex `::ffff:7f00:0001`) into standard IPv4 decimal notation.
 */
export function normalizeIP(ip: string): string {
  let normalized = ip.trim().toLowerCase();

  // Strip IPv6 scope ID (e.g. fe80::1%eth0)
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex !== -1) {
    normalized = normalized.substring(0, zoneIndex);
  }

  // Handle IPv4-mapped IPv6
  if (normalized.startsWith('::ffff:')) {
    const rest = normalized.slice(7);
    if (rest.includes('.')) {
      return rest;
    }
    const parts = rest.split(':');
    if (parts.length === 2) {
      const high = parseInt(parts[0], 16);
      const low = parseInt(parts[1], 16);
      if (!isNaN(high) && !isNaN(low)) {
        const b1 = (high >> 8) & 0xff;
        const b2 = high & 0xff;
        const b3 = (low >> 8) & 0xff;
        const b4 = low & 0xff;
        return `${b1}.${b2}.${b3}.${b4}`;
      }
    }
  }

  return normalized;
}

/**
 * Checks if an IP address (IPv4 or IPv6) belongs to private, loopback, link-local, multicast,
 * CGNAT, reserved, documentation, or unspecified ranges.
 */
export function isPrivateOrBlockedIP(rawIp: string): boolean {
  const ip = normalizeIP(rawIp);

  // Check IPv4 format
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map((n) => parseInt(n, 10));
    if (octets.some((o) => o < 0 || o > 255)) return true;

    const [o1, o2, o3] = octets;

    // 0.0.0.0/8 (Current network / "this host")
    if (o1 === 0) return true;

    // 10.0.0.0/8 (Private-Use)
    if (o1 === 10) return true;

    // 100.64.0.0/10 (CGNAT / Shared Address Space: 100.64.0.0 - 100.127.255.255)
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;

    // 127.0.0.0/8 (Loopback: 127.0.0.0 - 127.255.255.255)
    if (o1 === 127) return true;

    // 169.254.0.0/16 (Link-Local: 169.254.0.0 - 169.254.255.255)
    if (o1 === 169 && o2 === 254) return true;

    // 172.16.0.0/12 (Private-Use: 172.16.0.0 - 172.31.255.255)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (o1 === 192 && o2 === 0 && o3 === 0) return true;

    // 192.0.2.0/24 (Documentation / TEST-NET-1)
    if (o1 === 192 && o2 === 0 && o3 === 2) return true;

    // 192.168.0.0/16 (Private-Use: 192.168.0.0 - 192.168.255.255)
    if (o1 === 192 && o2 === 168) return true;

    // 198.18.0.0/15 (Benchmarking: 198.18.0.0 - 198.19.255.255)
    if (o1 === 198 && (o2 === 18 || o2 === 19)) return true;

    // 198.51.100.0/24 (Documentation / TEST-NET-2)
    if (o1 === 198 && o2 === 51 && o3 === 100) return true;

    // 203.0.113.0/24 (Documentation / TEST-NET-3)
    if (o1 === 203 && o2 === 0 && o3 === 113) return true;

    // 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
    if (o1 >= 224 && o1 <= 239) return true;

    // 240.0.0.0/4 (Reserved for Future Use / Broadcast: 240.0.0.0 - 255.255.255.255)
    if (o1 >= 240) return true;

    return false;
  }

  // Check IPv6
  const lowIp = ip.toLowerCase();

  // Unspecified :: or 0:0:0:0:0:0:0:0
  if (lowIp === '::' || lowIp === '0:0:0:0:0:0:0:0') return true;

  // Loopback ::1 or 0:0:0:0:0:0:0:1
  if (lowIp === '::1' || lowIp === '0:0:0:0:0:0:0:1') return true;

  // Link-Local unicast: fe80::/10 (fe80:... to febf:...)
  if (/^fe[89ab][0-9a-f]:/i.test(lowIp) || lowIp.startsWith('fe80:')) return true;

  // Unique Local Address (ULA): fc00::/7 (fc00:... to fdff:...)
  if (/^f[cd][0-9a-f]{2}:/i.test(lowIp) || lowIp.startsWith('fc00:') || lowIp.startsWith('fd00:')) return true;

  // Multicast: ff00::/8
  if (lowIp.startsWith('ff')) return true;

  // Documentation: 2001:db8::/32
  if (lowIp.startsWith('2001:db8:') || lowIp.startsWith('2001:0db8:')) return true;

  // 6to4 relay (2002::/16) - check if mapped IPv4 is private
  if (lowIp.startsWith('2002:')) {
    const parts = lowIp.split(':');
    if (parts.length >= 3) {
      const high = parseInt(parts[1], 16);
      const low = parseInt(parts[2], 16);
      if (!isNaN(high) && !isNaN(low)) {
        const b1 = (high >> 8) & 0xff;
        const b2 = high & 0xff;
        const b3 = (low >> 8) & 0xff;
        const b4 = low & 0xff;
        if (isPrivateOrBlockedIP(`${b1}.${b2}.${b3}.${b4}`)) return true;
      }
    }
  }

  return false;
}

/**
 * Strips credentials and masks sensitive query parameters from URLs before logging.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';

    const sensitiveQueryKeys = [
      'key',
      'apikey',
      'api_key',
      'secret',
      'token',
      'access_token',
      'auth',
      'authorization',
      'sig',
      'signature',
      'credential',
    ];

    for (const [key] of parsed.searchParams.entries()) {
      const lowKey = key.toLowerCase();
      if (sensitiveQueryKeys.some((sk) => lowKey.includes(sk))) {
        parsed.searchParams.set(key, '***MASKED***');
      }
    }
    return parsed.toString();
  } catch {
    return '[INVALID_URL]';
  }
}

export interface WebhookRequestOptions {
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface WebhookRequestLimits {
  maxResponseBytes?: number;
  maxDecompressedBytes?: number;
  connectTimeoutMs?: number;
  headersTimeoutMs?: number;
  bodyTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxRedirects?: number;
}

const MAX_WEBHOOK_BODY_LIMIT = 64 * 1024 * 1024;
const MAX_WEBHOOK_TIMEOUT = 5 * 60 * 1000;

function positiveLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

function nonNegativeLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value) || value === undefined || value < 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

@Processor('{webhook-delivery}', {
  concurrency: parseInt(process.env.WEBHOOK_CONCURRENCY || '15', 10),
  limiter: {
    max: parseInt(process.env.WEBHOOK_LIMITER_MAX || '200', 10),
    duration: parseInt(process.env.WEBHOOK_LIMITER_DURATION || '1000', 10),
  },
})
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly configService: ConfigService,
    @InjectMetric(WEBHOOK_DELIVERY_METRIC) private readonly deliveryCounter: Counter<string>,
    @InjectMetric(WEBHOOK_LATENCY_METRIC) private readonly latencyHistogram: Histogram<string>,
  ) {
    super();
  }

  async makeRequest(
    urlStr: string,
    options: WebhookRequestOptions,
    customLimits?: WebhookRequestLimits,
  ): Promise<{ status: number; ok: boolean; text: () => Promise<string> }> {
    const allowInternal = this.configService.get<string>('ALLOW_INTERNAL_WEBHOOKS') === 'true';

    const limits: Required<WebhookRequestLimits> = {
      maxResponseBytes: positiveLimit(
        customLimits?.maxResponseBytes,
        positiveLimit(envNumber('WEBHOOK_MAX_RESPONSE_BYTES', 65536), 65536, MAX_WEBHOOK_BODY_LIMIT),
        MAX_WEBHOOK_BODY_LIMIT,
      ),
      maxDecompressedBytes: positiveLimit(
        customLimits?.maxDecompressedBytes,
        positiveLimit(envNumber('WEBHOOK_MAX_DECOMPRESSED_BYTES', 65536), 65536, MAX_WEBHOOK_BODY_LIMIT),
        MAX_WEBHOOK_BODY_LIMIT,
      ),
      connectTimeoutMs: positiveLimit(
        customLimits?.connectTimeoutMs,
        positiveLimit(envNumber('WEBHOOK_CONNECT_TIMEOUT_MS', 3000), 3000, MAX_WEBHOOK_TIMEOUT),
        MAX_WEBHOOK_TIMEOUT,
      ),
      headersTimeoutMs: positiveLimit(
        customLimits?.headersTimeoutMs,
        positiveLimit(envNumber('WEBHOOK_HEADERS_TIMEOUT_MS', 5000), 5000, MAX_WEBHOOK_TIMEOUT),
        MAX_WEBHOOK_TIMEOUT,
      ),
      bodyTimeoutMs: positiveLimit(
        customLimits?.bodyTimeoutMs,
        positiveLimit(envNumber('WEBHOOK_BODY_TIMEOUT_MS', 5000), 5000, MAX_WEBHOOK_TIMEOUT),
        MAX_WEBHOOK_TIMEOUT,
      ),
      totalTimeoutMs: positiveLimit(
        customLimits?.totalTimeoutMs,
        positiveLimit(envNumber('WEBHOOK_TOTAL_TIMEOUT_MS', 10000), 10000, MAX_WEBHOOK_TIMEOUT),
        MAX_WEBHOOK_TIMEOUT,
      ),
      maxRedirects: nonNegativeLimit(customLimits?.maxRedirects, 3, 10),
    };

    const startTime = Date.now();

    const executeSingleHop = async (
      currentUrl: string,
      redirectsRemaining: number,
    ): Promise<{ status: number; ok: boolean; text: () => Promise<string> }> => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(currentUrl);
      } catch {
        throw new Error('Invalid webhook URL');
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error(`Unsupported webhook URL protocol: ${parsedUrl.protocol}`);
      }

      // 1. SSRF Pre-flight Host Validation
      const isInternal = await this.isInternalHost(currentUrl);
      if (isInternal && !allowInternal) {
        throw new Error('SSRF Blocked: Internal IP detected');
      }

      const isHttps = parsedUrl.protocol === 'https:';
      if (!isHttps && !allowInternal && process.env.NODE_ENV === 'production') {
        throw new Error('Production webhooks MUST use HTTPS');
      }

      const client = isHttps ? https : http;

      return new Promise((resolve, reject) => {
        let isSettled = false;
        let connectTimer: NodeJS.Timeout | null = null;
        let headersTimer: NodeJS.Timeout | null = null;
        let bodyTimer: NodeJS.Timeout | null = null;
        let totalTimer: NodeJS.Timeout | null = null;

        const cleanupTimers = () => {
          if (connectTimer) clearTimeout(connectTimer);
          if (headersTimer) clearTimeout(headersTimer);
          if (bodyTimer) clearTimeout(bodyTimer);
          if (totalTimer) clearTimeout(totalTimer);
          connectTimer = null;
          headersTimer = null;
          bodyTimer = null;
          totalTimer = null;
        };

        const safeReject = (err: Error) => {
          if (isSettled) return;
          isSettled = true;
          cleanupTimers();
          reject(err);
        };

        const safeResolve = (res: { status: number; ok: boolean; text: () => Promise<string> }) => {
          if (isSettled) return;
          isSettled = true;
          cleanupTimers();
          resolve(res);
        };

        // Remaining overall budget
        const elapsedSoFar = Date.now() - startTime;
        const remainingTotalBudget = Math.max(100, limits.totalTimeoutMs - elapsedSoFar);

        totalTimer = setTimeout(() => {
          if (req) req.destroy();
          safeReject(new Error(`Total Request Timeout of ${limits.totalTimeoutMs}ms exceeded`));
        }, remainingTotalBudget);

        // Custom DNS Lookup Hook with SSRF validation
        const lookupOption = (hostname: string, opts: any, callback: any) => {
          callbackLookup(hostname, opts, (err, address, family) => {
            if (err) return callback(err, null, null as any);
            const addresses = Array.isArray(address)
              ? address
              : typeof address === 'string'
                ? [{ address, family }]
                : [];

            for (const addr of addresses) {
              if (isPrivateOrBlockedIP(addr.address) && !allowInternal) {
                return callback(new Error('SSRF Blocked: Internal IP resolved'), null, null as any);
              }
            }
            callback(null, address, family as any);
          });
        };

        const agent = new (isHttps ? https.Agent : http.Agent)({
          lookup: lookupOption,
          keepAlive: false,
        });

        const reqOpts: https.RequestOptions = {
          method: options.method || 'POST',
          headers: {
            'Accept-Encoding': 'gzip, deflate, br',
            ...options.headers,
          },
          agent,
        };

        const req = client.request(currentUrl, reqOpts, async (res) => {
          if (headersTimer) clearTimeout(headersTimer);
          headersTimer = null;

          const statusCode = res.statusCode || 0;

          // Handle Redirects
          if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
            cleanupTimers();
            res.destroy();

            if (redirectsRemaining <= 0) {
              safeReject(new Error(`Maximum redirect limit of ${limits.maxRedirects} exceeded`));
              return;
            }

            try {
              const redirectUrl = new URL(res.headers.location, currentUrl).toString();
              const redirectResult = await executeSingleHop(redirectUrl, redirectsRemaining - 1);
              safeResolve(redirectResult);
              return;
            } catch (redirErr) {
              safeReject(redirErr instanceof Error ? redirErr : new Error(String(redirErr)));
              return;
            }
          }

          // Setup Body Stream Limit Tracking
          const contentEncoding = (res.headers['content-encoding'] || '').toLowerCase();
          let transferBytes = 0;
          let decompressedBytes = 0;
          const chunks: Buffer[] = [];

          const resetBodyTimer = () => {
            if (bodyTimer) clearTimeout(bodyTimer);
            bodyTimer = setTimeout(() => {
              res.destroy();
              req.destroy();
              safeReject(new Error(`Body transfer idle timeout of ${limits.bodyTimeoutMs}ms exceeded`));
            }, limits.bodyTimeoutMs);
          };

          resetBodyTimer();

          let decompressStream: zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null = null;

          if (contentEncoding.includes('gzip')) {
            decompressStream = zlib.createGunzip();
          } else if (contentEncoding.includes('deflate')) {
            decompressStream = zlib.createInflate();
          } else if (contentEncoding.includes('br')) {
            decompressStream = zlib.createBrotliDecompress();
          }

          // Track raw transfer bytes from response socket
          res.on('data', (chunk: Buffer) => {
            resetBodyTimer();
            transferBytes += chunk.length;
            if (transferBytes > limits.maxResponseBytes) {
              res.destroy();
              if (decompressStream) decompressStream.destroy();
              req.destroy();
              safeReject(new Error(`Response transfer size exceeded limit of ${limits.maxResponseBytes} bytes`));
            }
          });

          if (decompressStream) {
            decompressStream.on('data', (chunk: Buffer) => {
              decompressedBytes += chunk.length;
              if (decompressedBytes > limits.maxDecompressedBytes) {
                res.destroy();
                decompressStream?.destroy();
                req.destroy();
                safeReject(
                  new Error(
                    `Decompressed response size exceeded limit of ${limits.maxDecompressedBytes} bytes (decompression bomb protection)`,
                  ),
                );
                return;
              }
              chunks.push(Buffer.from(chunk));
            });

            decompressStream.on('error', (err) => {
              res.destroy();
              req.destroy();
              safeReject(new Error(`Decompression error: ${err.message}`));
            });

            decompressStream.on('end', () => {
              cleanupTimers();
              const fullBuffer = Buffer.concat(chunks);
              safeResolve({
                status: statusCode,
                ok: statusCode >= 200 && statusCode < 300,
                text: async () => fullBuffer.toString('utf8'),
              });
            });

            res.pipe(decompressStream);
          } else {
            // Uncompressed stream
            res.on('data', (chunk: Buffer) => {
              chunks.push(Buffer.from(chunk));
            });

            res.on('end', () => {
              cleanupTimers();
              const fullBuffer = Buffer.concat(chunks);
              safeResolve({
                status: statusCode,
                ok: statusCode >= 200 && statusCode < 300,
                text: async () => fullBuffer.toString('utf8'),
              });
            });
          }

          res.on('error', (err) => {
            safeReject(err);
          });
        });

        // Set Connection and TTFB Timers
        connectTimer = setTimeout(() => {
          req.destroy();
          safeReject(new Error(`Connection timeout of ${limits.connectTimeoutMs}ms exceeded`));
        }, limits.connectTimeoutMs);

        req.on('socket', (socket) => {
          socket.once('connect', () => {
            if (connectTimer) clearTimeout(connectTimer);
            connectTimer = null;

            // Connected Peer IP SSRF verification
            const remoteAddress = socket.remoteAddress;
            if (remoteAddress && isPrivateOrBlockedIP(remoteAddress) && !allowInternal) {
              socket.destroy();
              req.destroy();
              safeReject(new Error(`SSRF Blocked: Connected socket IP ${remoteAddress} is internal`));
              return;
            }

            headersTimer = setTimeout(() => {
              req.destroy();
              safeReject(new Error(`Headers/TTFB timeout of ${limits.headersTimeoutMs}ms exceeded`));
            }, limits.headersTimeoutMs);
          });
        });

        req.on('error', (err) => {
          safeReject(err);
        });

        if (options.body) {
          req.write(options.body);
        }
        req.end();
      });
    };

    return executeSingleHop(urlStr, limits.maxRedirects);
  }

  async process(job: Job<WebhookJobData>): Promise<any> {
    const { endpoint, payload, txKey, txType, appId, organizationId } = job.data;

    // 0. Tenant Consistency Validation
    const expectedOrgId = organizationId || endpoint.organizationId;
    if (endpoint.organizationId && expectedOrgId && endpoint.organizationId !== expectedOrgId) {
      const err = new Error(
        `[Webhook Processor] Tenant mismatch: Job organization ${expectedOrgId} does not match endpoint organization ${endpoint.organizationId}`,
      );
      this.logger.error(err.message);
      throw err;
    }

    const expectedAppId = appId || endpoint.appId;
    if (endpoint.appId && expectedAppId && endpoint.appId !== expectedAppId) {
      const err = new Error(
        `[Webhook Processor] App mismatch: Job app ${expectedAppId} does not match endpoint app ${endpoint.appId}`,
      );
      this.logger.error(err.message);
      throw err;
    }

    // 1. Quota Tracking (charge only on first attempt, not on retries)
    if ((job.attemptsMade ?? 0) === 0) {
      const usageKey = `{${endpoint.organizationId}}:usage`;
      const batchKey = `{${endpoint.organizationId}}:usage:batch`;
      try {
        await this.redis.set(batchKey, createId(), 'EX', 604800, 'NX');
        await this.redis.incrbyfloat(usageKey, QUOTA_DEFAULTS.WEBHOOK_DELIVERY_WEIGHT);
        await this.redis.expire(usageKey, 604800);
      } catch (redisErr) {
        this.logger.error(`[Webhook Processor] Quota track failed for Org ${endpoint.organizationId}:`, redisErr);
      }
    }

    const payloadString = JSON.stringify(payload);
    let signature: string;
    try {
      const decryptedSecret = decrypt(endpoint.signingSecret);
      signature = createHmac('sha256', decryptedSecret || endpoint.signingSecret)
        .update(payloadString)
        .digest('hex');
    } catch (signErr) {
      this.logger.error(`[Webhook Processor] Signing failed for ${redactUrl(endpoint.url)}:`, signErr);
      return;
    }

    const startTime = Date.now();
    let httpStatus: number | undefined;
    let responseBody: string | undefined;
    let success = false;

    const allowInternal = this.configService.get<string>('ALLOW_INTERNAL_WEBHOOKS') === 'true';
    const isLocalhost = isLocalhostUrl(endpoint.url);
    const isProdRelay = isLocalhost && process.env.NODE_ENV === 'production' && !allowInternal;

    try {
      if (isProdRelay) {
        // Native Quasar Local Dev Relay path for production
        const channel = `relay:webhook:${endpoint.id}`;
        const deliveryId = job.data.deliveryId || createId();
        const eventType = payload.action ? String(payload.action) : txType || 'transaction:confirmed';
        const relayPayload = JSON.stringify({
          deliveryId,
          endpointId: endpoint.id,
          url: endpoint.url,
          data: payload,
          payload,
          signature,
          event: eventType,
          txKey,
          txType,
          timestamp: Date.now(),
        });

        await this.redis.publish(channel, relayPayload);
        httpStatus = 200;
        success = true;
        responseBody = 'Relayed to local CLI listener via SSE';

        this.logger.log(`[Webhook Processor] Relayed webhook to Redis channel ${channel} (tx: ${txKey})`);
      } else {
        const res = await this.makeRequest(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Quasar-Webhook-Worker/1.0 (TuwaIO)',
            'x-quasar-signature': signature,
            'x-quasar-event': payload.action ? String(payload.action) : '',
          },
          body: payloadString,
        });

        httpStatus = res.status;
        success = res.ok;
        const rawResponse = await res.text().catch(() => '');
        responseBody = rawResponse.length > 1000 ? rawResponse.substring(0, 1000) + '... (truncated)' : rawResponse;

        if (!success) {
          this.logger.warn(
            `[Webhook Processor] Delivery failed to ${redactUrl(endpoint.url)} with status ${httpStatus}`,
          );
          throw new Error(`Webhook delivery failed with HTTP status ${httpStatus}`);
        } else {
          this.logger.log(
            `[Webhook Processor] Successfully delivered webhook to ${redactUrl(endpoint.url)} (tx: ${txKey})`,
          );
        }
      }

      const executionTimeMs = Date.now() - startTime;

      // Metrics
      const labels = {
        status: success ? 'success' : 'failure',
      };
      this.deliveryCounter.inc(labels);
      this.latencyHistogram.observe(labels, executionTimeMs / 1000);
    } catch (err: any) {
      if (!responseBody) {
        responseBody = err?.message || String(err);
      }
      this.logger.error(`[Webhook Processor] Delivery error to ${redactUrl(endpoint.url)}:`, err);
      throw err;
    } finally {
      // 4. Log Delivery Record to DB
      try {
        const sanitizePayload = (obj: unknown): unknown => {
          if (!obj || typeof obj !== 'object') return obj;
          if (Array.isArray(obj)) {
            return obj.map((item) => sanitizePayload(item));
          }
          const srcObj = obj as Record<string, unknown>;
          const result: Record<string, unknown> = {};
          const sensitiveKeys = [
            'secret',
            'token',
            'password',
            'key',
            'privatekey',
            'secretkey',
            'apikey',
            'signingsecret',
            'credential',
          ];
          for (const key of Object.keys(srcObj)) {
            const lowKey = key.toLowerCase();
            const value = srcObj[key];

            const isSensitive = sensitiveKeys.some((sk) => {
              if (!lowKey.includes(sk)) return false;

              // Exclude common safe keys containing 'key'
              if (sk === 'key' && (lowKey.includes('txkey') || lowKey.includes('publickey'))) {
                return false;
              }

              // Exclude common safe keys containing 'token'
              if (sk === 'token') {
                if (
                  lowKey.includes('address') ||
                  lowKey.includes('symbol') ||
                  lowKey.includes('id') ||
                  lowKey.includes('name') ||
                  lowKey.includes('decimals')
                ) {
                  return false;
                }
                // Check if it's an address or tx hash/signature (EVM or Solana)
                if (typeof value === 'string') {
                  if (/^0x[a-fA-F0-9]{32,128}$/.test(value)) return false;
                  if (/^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(value)) return false;
                }
              }

              return true;
            });

            if (isSensitive) {
              result[key] = '***MASKED***';
            } else if (typeof value === 'object' && value !== null) {
              result[key] = sanitizePayload(value);
            } else {
              result[key] = value;
            }
          }
          return result;
        };

        const safePayload = sanitizePayload(payload);

        const sanitizeResponseBody = (body: string | undefined): string | null => {
          if (!body) return null;
          try {
            const parsed = JSON.parse(body);
            const safeParsed = sanitizePayload(parsed);
            return JSON.stringify(safeParsed);
          } catch {
            const sensitivePatterns = [
              /("?secret"?\s*[:=]\s*)"?[^"\s,;&]+"?/gi,
              /("?token"?\s*[:=]\s*)"?[^"\s,;&]+"?/gi,
              /("?password"?\s*[:=]\s*)"?[^"\s,;&]+"?/gi,
              /("?key"?\s*[:=]\s*)"?[^"\s,;&]+"?/gi,
              /("?privatekey"?\s*[:=]\s*)"?[^"\s,;&]+"?/gi,
              /("?secretkey"?\s*[:=]\s*)"?[^"\s,;&]+"?/gi,
              /("?apikey"?\s*[:=]\s*)"?[^"\s,;&]+"?/gi,
              /("?signingsecret"?\s*[:=]\s*)"?[^"\s,;&]+"?/gi,
              /("?credential"?\s*[:=]\s*)"?[^"\s,;&]+"?/gi,
            ];
            let sanitizedBody = body;
            for (const pattern of sensitivePatterns) {
              sanitizedBody = sanitizedBody.replace(pattern, '$1"***MASKED***"');
            }
            return sanitizedBody;
          }
        };

        const safeResponseBody = sanitizeResponseBody(responseBody);
        const deliveryId = job.data.deliveryId;

        let existingDelivery;
        if (this.db.query?.webhookDeliveries?.findFirst) {
          if (deliveryId) {
            existingDelivery = await this.db.query.webhookDeliveries.findFirst({
              where: eq(schema.webhookDeliveries.id, deliveryId),
            });
          } else {
            existingDelivery = await this.db.query.webhookDeliveries.findFirst({
              where: and(
                eq(schema.webhookDeliveries.txKey, txKey),
                eq(schema.webhookDeliveries.endpointId, endpoint.id),
                eq(schema.webhookDeliveries.eventType, txType),
              ),
              orderBy: [desc(schema.webhookDeliveries.createdAt)],
            });
          }
        }

        const currentAttempts = existingDelivery?.attempts ? Number(existingDelivery.attempts) : 0;
        const newAttempts = currentAttempts + 1;

        if (existingDelivery) {
          await this.db
            .update(schema.webhookDeliveries)
            .set({
              httpStatus: httpStatus != null ? String(httpStatus) : null,
              success,
              requestPayload: safePayload,
              responseBody: safeResponseBody,
              executionTimeMs: String(Date.now() - startTime),
              attempts: String(newAttempts),
            })
            .where(
              and(
                eq(schema.webhookDeliveries.id, existingDelivery.id),
                eq(schema.webhookDeliveries.createdAt, existingDelivery.createdAt),
              ),
            );
        } else {
          await this.db.insert(schema.webhookDeliveries).values({
            id: createId(),
            endpointId: endpoint.id,
            txKey: txKey,
            httpStatus: httpStatus != null ? String(httpStatus) : null,
            success,
            requestPayload: safePayload,
            responseBody: safeResponseBody,
            executionTimeMs: String(Date.now() - startTime),
            eventType: txType,
            attempts: String(newAttempts),
          });
        }
      } catch (dbErr) {
        this.logger.error(`[Webhook Processor] DB Log failed:`, dbErr);
      }
    }
  }

  async isInternalHost(url: string): Promise<boolean> {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;
      if (isIP(hostname) !== 0) return isPrivateOrBlockedIP(hostname);

      const [ips4, ips6] = await Promise.all([
        resolve4(hostname).catch(() => [] as string[]),
        resolve6(hostname).catch(() => [] as string[]),
      ]);

      const allIPs = [...ips4, ...ips6];
      if (allIPs.length === 0) {
        const result = await lookup(hostname, { all: true }).catch(() => []);
        return result.length === 0 || result.some((r) => isPrivateOrBlockedIP(r.address));
      }
      return allIPs.some((ip) => isPrivateOrBlockedIP(ip));
    } catch {
      return true;
    }
  }
}
