import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { QUOTA_DEFAULTS, TUWA_HEADERS } from '@tuwaio/shared/constants';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import { Counter } from 'prom-client';

import { IRON_DOME_BLOCK_METRIC } from '../constants';
import { DRIZZLE_READ } from '../database/database.module';
import * as schema from '../database/schema/index';
import { REDIS } from '../redis/redis.module';
import { IS_INTERNAL_ONLY_KEY } from './internal.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SecretRotationService } from './secret-rotation.service';

interface ProxyMetadata {
  id: string; // App ID
  ownerId: string; // Organization ID
  scopes: string[];
  credentialType: 'public' | 'secret' | 'internal';
  trackMode: 'fast' | 'lazy' | 'default';
  ipWhitelist: string[];
  domainsWhitelist: string[];
  appKind: string;
  paymentSettings: AppFull['paymentSettings'] | null;
}

export interface AppFull {
  id: string;
  organizationId: string;
  isActive: boolean | null;
  /** 'live' | 'test' — decides the per-sync quota weight. */
  environment: string | null;
  secretKey: string | null;
  publicKey: string | null;
  /**
   * The organization's active RPS limit (`organizations.rps_limit`), copied
   * here when the app is hydrated. `apps` has no RPS column of its own.
   */
  rpsLimit: string | number | null;
  ownerEmail: string | null;
  ownerName: string | null;
  name: string | null;
  ipWhitelist: string[];
  domainsWhitelist: string[];
  kind: string | null;
  paymentSettings: {
    amlEnabled?: boolean;
    goPlusApiKey?: string | null;
    goPlusApiSecret?: string | null;
    appInvoiceTemplate?: unknown;
  } | null;
}

@Injectable()
export class IronDomeGuard implements CanActivate {
  private readonly logger = new Logger(IronDomeGuard.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DRIZZLE_READ) private readonly db: NodePgDatabase<typeof schema>,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly secretRotation: SecretRotationService,
    @InjectMetric(IRON_DOME_BLOCK_METRIC) private readonly blockCounter: Counter<string>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<
      Record<string, unknown> & {
        headers: Record<string, string | undefined>;
        method: string;
        url: string;
        ip: string;
        ironDomeMeta?: ProxyMetadata;
      }
    >();

    const path = req.url?.split('?')[0];
    if (path === '/metrics' || path === '/metrics/') {
      if (req.headers['x-forwarded-for'] || req.headers['x-real-ip']) {
        throw new ForbiddenException('Metrics endpoint is internal only');
      }
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isInternal = this.reflector.getAllAndOverride<boolean>(IS_INTERNAL_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic || isInternal) return true;

    // 1. Internal Bypass (Hybrid Mode)
    const validSecrets = await this.getValidSecrets();
    const incomingSecret = req.headers[TUWA_HEADERS.INTERNAL_SECRET];
    const apiKey =
      req.headers[TUWA_HEADERS.API_KEY] || req.headers[TUWA_HEADERS.PUBLIC_KEY] || req.headers[TUWA_HEADERS.SECRET_KEY];
    const isIncomingSecretValid = incomingSecret
      ? await this.secretRotation.validateSecret(incomingSecret as string)
      : false;

    // Bypass only if internal secret is valid AND no API key is provided
    if (isIncomingSecretValid && !apiKey) {
      // Populate metadata to prevent crashes in controllers
      req.ironDomeMeta = {
        id: 'system',
        ownerId: 'system',
        scopes: [],
        credentialType: 'internal',
        trackMode: 'default',
        ipWhitelist: [],
        domainsWhitelist: [],
        appKind: 'basic',
        paymentSettings: null,
      };

      // For hybrid routes like test-ping, inject system headers if missing
      req.headers[TUWA_HEADERS.PUBLIC_KEY] = req.headers[TUWA_HEADERS.PUBLIC_KEY] || 'quasar-system-account';
      req.headers[TUWA_HEADERS.REMAINING_QUOTA] = req.headers[TUWA_HEADERS.REMAINING_QUOTA] || '999999';
      const metadata = JSON.stringify(req.ironDomeMeta);
      req.headers[TUWA_HEADERS.METADATA] = req.headers[TUWA_HEADERS.METADATA] || metadata;
      const metadataSecret = validSecrets[0];
      if (metadataSecret) {
        req.headers[TUWA_HEADERS.METADATA_SIGNATURE] = crypto
          .createHmac('sha256', metadataSecret)
          .update(metadata)
          .digest('hex');
      }
      return true;
    }

    if (!apiKey) {
      this.logger.warn(`[IronDome] Request rejected: missing API key. URL=${req.url}`);
      throw new UnauthorizedException('Missing API Key');
    }

    // 2. Resolve App Metadata with Cache Hydration
    const app = await this.resolveAppWithCache(apiKey as string);

    if (!app) {
      this.logger.warn(`[IronDome] Invalid API Key: ...${apiKey.toString().slice(-6)}`);
      throw new UnauthorizedException('Invalid API Key');
    }

    // Determine credential type based on matched key value and explicit headers.
    // Public keys (matching app.publicKey or starting with pk_) are ALWAYS public,
    // regardless of whether they were passed in x-api-key, x-public-key, or x-tuwa-public-key.
    const incomingApiKeyStr = String(apiKey).trim();
    const isExplicitPublicKey = Boolean(req.headers[TUWA_HEADERS.PUBLIC_KEY] && !req.headers[TUWA_HEADERS.SECRET_KEY]);
    const matchesPublicKey = incomingApiKeyStr === app.publicKey || incomingApiKeyStr.startsWith('pk_');
    const credentialType: 'public' | 'secret' = isExplicitPublicKey || matchesPublicKey ? 'public' : 'secret';

    // Public credentials are strictly read-only. Deny all write operations (POST, PUT, PATCH, DELETE).
    const method = req.method.toUpperCase();
    if (credentialType === 'public' && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      throw new ForbiddenException('Public credentials are read-only');
    }

    return this.processAuthorizedRequest(context, app, validSecrets, credentialType, isIncomingSecretValid);
  }

  private async getValidSecrets(): Promise<string[]> {
    const current = await this.secretRotation.getCurrentSecret();
    const previous = await this.secretRotation.getPreviousSecret();
    const secrets = [current, previous].filter(Boolean) as string[];

    // The environment value is accepted only while Redis has no rotation
    // state at all, matching SecretRotationService bootstrap semantics.
    if (secrets.length === 0) {
      const envSecret = this.configService.get<string>('INTERNAL_SECRET');
      if (envSecret) secrets.push(envSecret);
    }
    return secrets;
  }

  private async resolveAppWithCache(apiKey: string): Promise<AppFull | null> {
    // For secret keys (starting with sk_), we lookup and cache by hash to prevent key leakage and ensure consistency
    const isSecretKey = apiKey.startsWith('sk_');
    const lookupKey = isSecretKey ? crypto.createHash('sha256').update(apiKey).digest('hex') : apiKey;
    const cacheKey = `{${lookupKey}}:meta`;

    // 1. Check Redis Cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        this.logger.error(`[IronDome] Failed to parse cached metadata for ${apiKey}:`, e);
      }
    }

    // 2. DB Fallback (Hydration)
    //
    // The organization is loaded for its RPS limit and for the address
    // low-quota alerts go to, and nothing else — so its columns are named.
    // Loading whole rows put every member's password hash, salt, reset token
    // and 2FA secret into the `:meta` cache entry below.
    const appRaw = await (this.db.query as any).apps.findFirst({
      where: (apps: any, { or, eq }: any) => or(eq(apps.publicKey, apiKey), eq(apps.secretKeyHash, lookupKey)),
      with: {
        organization: {
          columns: { rpsLimit: true, createdBy: true },
          with: {
            organizationMembers: {
              columns: { role: true },
              with: {
                user: { columns: { email: true, name: true } },
              },
            },
          },
        },
        appsIpWhitelists: true,
        appsDomainsWhitelists: true,
      },
    });

    if (!appRaw) return null;

    const { organization, appsIpWhitelists, appsDomainsWhitelists, ...appColumns } = appRaw;

    let ownerEmail: string | null = null;
    let ownerName: string | null = null;

    if (organization?.organizationMembers) {
      const ownerMember = organization.organizationMembers.find((m: any) => m.role === 'owner');
      const adminMember = organization.organizationMembers.find((m: any) => m.role === 'admin');
      const fallbackMember = organization.organizationMembers[0];

      const responsibleMember = ownerMember || adminMember || fallbackMember;

      if (responsibleMember?.user) {
        ownerEmail = responsibleMember.user.email;
        ownerName = responsibleMember.user.name || null;
      }
    }

    if (!ownerEmail && organization?.createdBy) {
      const [creatorUser] = await this.db
        .select({ email: schema.users.email, name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, organization.createdBy))
        .limit(1);

      if (creatorUser) {
        ownerEmail = creatorUser.email;
        ownerName = creatorUser.name || null;
      }
    }

    if (!ownerEmail) {
      ownerEmail = this.configService.get<string>('SUPPORT_EMAIL') || 'admin@example.com';
      ownerName = 'Administrator';
    }

    const fullApp = {
      ...appColumns,
      organizationId: appRaw.organizationId,
      // Cached with the rest, so a change to the organization's limit has to
      // drop this entry: the outbox `sync-redis-quota` event does it in the
      // engine, and `invalidateOrganizationAppMetadata` in the dashboard.
      rpsLimit: organization?.rpsLimit ?? null,
      ownerEmail,
      ownerName,
      ipWhitelist: appsIpWhitelists.map((i: any) => i.ip),
      domainsWhitelist: appsDomainsWhitelists.map((d: any) => d.domain),
    };

    // 3. Save to Cache (TTL: 5 minutes)
    await this.redis.set(cacheKey, JSON.stringify(fullApp), 'EX', 300);

    return fullApp;
  }

  private async processAuthorizedRequest(
    context: ExecutionContext,
    app: AppFull,
    validSecrets: string[] = [],
    credentialType: 'public' | 'secret' | 'internal' = 'secret',
    internalSecretValid = false,
  ): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse<{ header: (key: string, value: string) => void }>();

    if (!app.isActive) {
      throw new ForbiddenException('App is disabled');
    }

    // --- Whitelist Validation ---
    // 1. IP Validation
    if (app.ipWhitelist.length > 0) {
      const clientIp = req.ip; // Reliable client IP from trusted proxy
      if (!clientIp || !app.ipWhitelist.includes(clientIp)) {
        this.logger.warn(`[IronDome] IP Rejected: ${clientIp} for App ${app.id}`);
        throw new ForbiddenException('IP Address not allowed');
      }
    }

    // 2. Domain Validation
    if (app.domainsWhitelist.length > 0) {
      const origin = req.headers['origin'] || req.headers['referer'];
      let domain: string | null = null;
      if (origin) {
        try {
          domain = new URL(origin as string).hostname;
        } catch {
          domain = origin as string;
        }
      }

      if (!domain || !app.domainsWhitelist.includes(domain)) {
        this.logger.warn(`[IronDome] Domain Rejected: ${domain} for App ${app.id}`);
        throw new ForbiddenException('Origin Domain not allowed');
      }
    }

    const { organizationId } = app;
    // Fail closed: a limit that does not parse must not read as "no limit",
    // which is what `rpsCount > NaN` would make it.
    const parsedRpsLimit = typeof app.rpsLimit === 'string' ? parseInt(app.rpsLimit, 10) : (app.rpsLimit ?? 1);
    const rpsLimit = Number.isFinite(parsedRpsLimit) ? parsedRpsLimit : 1;

    const now = Date.now();
    const rpsKey = `{${organizationId}}:rps:${Math.floor(now / 1000)}`;
    const limitKey = `{${organizationId}}:limit`;
    const usageKey = `{${organizationId}}:usage`;

    // 3. Rate Limiting (RPS) - Global Organization Level
    let rpsCount: number;
    try {
      rpsCount = await this.redis.incr(rpsKey);
      await this.redis.expire(rpsKey, 2);
    } catch (err) {
      this.logger.error(`[IronDome] Redis RPS error for Org ${organizationId}:`, err);
      // Fail-closed on infrastructure failure
      throw new HttpException('Service Unavailable - Rate Limiter Offline', HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (rpsCount > rpsLimit) {
      this.logger.warn(`[IronDome] Global RPS exceeded for Org ${organizationId}: ${rpsCount}/${rpsLimit}`);
      this.blockCounter.inc({ code: '429' });
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    // 4. Atomic Usage Bucket check
    let cachedLimitStr: string | null = null;
    try {
      cachedLimitStr = await this.redis.get(limitKey);
    } catch (err) {
      this.logger.error(`[IronDome] Redis limit read error for Org ${organizationId}:`, err);
    }

    if (!cachedLimitStr) {
      const [org] = await this.db
        .select({ quotaBalance: schema.organizations.quotaBalance })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, organizationId))
        .limit(1);

      if (!org) {
        throw new UnauthorizedException('Organization not found');
      }

      cachedLimitStr = String(org.quotaBalance);
      // TTL: 7 days
      try {
        await this.redis.set(limitKey, cachedLimitStr, 'EX', 604800);
      } catch (err) {
        this.logger.error(`[IronDome] Redis limit write error for Org ${organizationId}:`, err);
      }
    }

    const cachedLimit = parseFloat(cachedLimitStr);
    const url = req.url || '';
    const method = req.method || '';

    // Granular Costs & Modes
    const headerWeight = req.headers[TUWA_HEADERS.QUOTA_WEIGHT];
    const isInternalCall = internalSecretValid;

    // Only trust weight override from internal system calls
    const weight = isInternalCall && headerWeight ? parseFloat(headerWeight as string) : null;

    const isSync = url.includes('/pulsar/sync') && method === 'POST';
    const isHistory = url.includes('/pulsar/history') && method === 'GET';
    const isTestPing = url.includes('/engine/test-ping') && method === 'GET';

    // 4. Monitoring Bypass Check
    const monitoringAppId = this.configService.get<string>('MONITOR_APP_ID');
    const isMonitoringCall = monitoringAppId && app.id === monitoringAppId;

    // Priority: 1. Monitoring Bypass, 2. Trusted Header Override, 3. Default logic
    let txCost = isMonitoringCall
      ? 0
      : weight !== null
        ? weight
        : isHistory
          ? 0
          : isSync
            ? app.environment === 'test'
              ? QUOTA_DEFAULTS.SYNC_TX_WEIGHT_TEST
              : QUOTA_DEFAULTS.SYNC_TX_WEIGHT
            : isTestPing
              ? QUOTA_DEFAULTS.HEALTHCHECK_WEIGHT
              : QUOTA_DEFAULTS.DEFAULT_WEIGHT;

    // Payments app surcharges (only for sync operations)
    if (isSync && app.kind === 'payments' && !isMonitoringCall) {
      // +2 flat surcharge for all payments app tracking
      txCost += QUOTA_DEFAULTS.PAYMENTS_SURCHARGE_WEIGHT;

      // +5 penalty if AML is enabled but using system fallback GoPlus key
      if (app.paymentSettings?.amlEnabled && !app.paymentSettings?.goPlusApiKey) {
        txCost += QUOTA_DEFAULTS.FALLBACK_AML_WEIGHT;
      }
    }

    // --- TASK 2: Atomic Quota Check & Sync ---
    const [currentUsageStr, status] = await this.atomicQuotaCheck(usageKey, txCost, cachedLimit, isSync);
    const currentUsage = parseFloat(currentUsageStr);
    const remaining = cachedLimit - currentUsage;

    // Determine tracking mode
    let trackMode: 'fast' | 'lazy' | 'default' = 'default';
    if (isSync) {
      // Threshold: 10 units remaining for fast mode
      trackMode = remaining >= 0 ? 'fast' : 'lazy';
    }

    // Blocking Logic
    if (status === 'blocked') {
      this.logger.warn(
        `[IronDome] Quota exceeded for Org ${organizationId}: usage=${currentUsage}, limit=${cachedLimit}`,
      );
      this.blockCounter.inc({ code: '402' });
      throw new HttpException('Payment Required', HttpStatus.PAYMENT_REQUIRED);
    }

    // 5. Inject Metadata
    req.ironDomeMeta = {
      id: app.id,
      ownerId: organizationId,
      scopes: [],
      credentialType,
      trackMode,
      ipWhitelist: app.ipWhitelist,
      domainsWhitelist: app.domainsWhitelist,
      appKind: app.kind || 'basic',
      paymentSettings: app.kind === 'payments' ? app.paymentSettings : null,
    };

    if (isSync) {
      this.logger.log(
        `[IronDome] ${method} ${url} → mode=${trackMode}, cost=${txCost}, quota=${remaining}, rps=${rpsCount}/${rpsLimit}, key=...${app.id.slice(-6)}`,
      );
    }


    // 6. Set headers for transparency
    void res.header(TUWA_HEADERS.REMAINING_QUOTA, remaining.toString());

    // Inject system headers for downstream controllers
    req.headers[TUWA_HEADERS.REMAINING_QUOTA] = remaining.toString();
    req.headers[TUWA_HEADERS.PUBLIC_KEY] = app.publicKey || undefined;
    const metadata = JSON.stringify(req.ironDomeMeta);
    req.headers[TUWA_HEADERS.METADATA] = metadata;
    const metadataSecret = validSecrets[0];
    if (metadataSecret) {
      req.headers[TUWA_HEADERS.METADATA_SIGNATURE] = crypto
        .createHmac('sha256', metadataSecret)
        .update(metadata)
        .digest('hex');
    }

    return true;
  }

  private async atomicQuotaCheck(
    usageKey: string,
    txCost: number,
    limit: number,
    isSync: boolean,
  ): Promise<[string, 'allowed' | 'blocked']> {
    const batchKey = usageKey.replace(':usage', ':usage:batch');
    const batchSequenceKey = usageKey.replace(':usage', ':usage:batch-seq');
    const script = `
      local usageKey = KEYS[1]
      local batchKey = KEYS[2]
      local batchSequenceKey = KEYS[3]
      local txCost = tonumber(ARGV[1]) or 0
      local limit = tonumber(ARGV[2]) or 0
      local isSync = ARGV[3] == 'true'

      local previousUsage = tonumber(redis.call('GET', usageKey) or '0') or 0
      if previousUsage == 0 and redis.call('EXISTS', batchKey) == 0 then
        local now = redis.call('TIME')[1]
        local sequence = redis.call('INCR', batchSequenceKey)
        redis.call('SET', batchKey, now .. ':' .. sequence, 'EX', 604800)
        redis.call('EXPIRE', batchSequenceKey, 604800)
      end

      local currentUsageVal = redis.call('INCRBYFLOAT', usageKey, txCost)
      local currentUsage = tonumber(currentUsageVal) or 0
      redis.call('EXPIRE', usageKey, 604800) -- 7 days TTL

      if not isSync and currentUsage > limit then
        redis.call('INCRBYFLOAT', usageKey, -txCost)
        if previousUsage == 0 then redis.call('DEL', batchKey) end
        return {tostring(currentUsage), "blocked"}
      end

      return {tostring(currentUsage), "allowed"}
    `;

    try {
      return (await this.redis.eval(
        script,
        3,
        usageKey,
        batchKey,
        batchSequenceKey,
        txCost.toString(),
        limit.toString(),
        isSync.toString(),
      )) as [string, 'allowed' | 'blocked'];
    } catch (err) {
      this.logger.error(`[IronDome] Redis atomicQuotaCheck error:`, err);
      // Fail-closed to protect quota if Redis goes offline
      throw new HttpException('Service Unavailable - Quota Engine Offline', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
