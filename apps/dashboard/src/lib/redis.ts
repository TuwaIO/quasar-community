import { resolveEnvUrl } from '@tuwaio/shared/utils';
import { Queue } from 'bullmq';
import crypto from 'crypto';
import Redis from 'ioredis';
import type { Payload } from 'payload';

import { QUEUE_FAST, QUEUE_LAZY } from '../../constants';

// UI Redis: Rate limiting, 2FA locks, sessions (dashboard-only ephemeral state)
const uiRedisUrl = resolveEnvUrl(process.env.REDIS_UI_URL || '');
const isUiCluster = process.env.REDIS_UI_MODE === 'cluster';

// API Redis: BullMQ queues, IronDome, transaction tracking (shared with NestJS engine)
const apiRedisUrl = resolveEnvUrl(process.env.REDIS_API_URL || '');
const isApiCluster = process.env.REDIS_API_MODE === 'cluster';

// ── Factory Functions ────────────────────────────────────────────────────────

function createRedisInstance(url: string, isCluster: boolean, label: string): Redis {
  // During Next.js build phase, we don't want to connect to Redis.
  // This avoids "ECONNREFUSED" errors and potential worker crashes during prerendering.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return {
      on: () => {},
      get: () => Promise.resolve(null),
      set: () => Promise.resolve('OK'),
      incr: () => Promise.resolve(1),
      expire: () => Promise.resolve(1),
      rpush: () => Promise.resolve(1),
      del: () => Promise.resolve(1),
    } as unknown as Redis;
  }

  let instance: Redis;

  if (isCluster) {
    const parsed = new URL(url);
    // Remove database index (e.g. /0) as Redis Cluster only supports DB 0
    parsed.pathname = '';

    instance = new Redis.Cluster(
      [
        {
          host: parsed.hostname,
          port: parseInt(parsed.port || '6379'),
        },
      ],
      {
        redisOptions: {
          password: parsed.password || undefined,
          maxRetriesPerRequest: 3,
          connectTimeout: 5000,
        },
        // Fail-fast to prevent memory blow-up when Redis is down
        enableOfflineQueue: false,
        // Allow more redirections during topology transitions (MOVED / ASKING).
        maxRedirections: 32,
        // Wait for cluster to finish LOADING / elect a new primary.
        retryDelayOnClusterDown: 300,
        // Pause until new primary accepts writes after failover.
        retryDelayOnFailover: 200,
        // Wait for slot migration to complete (TRYAGAIN).
        retryDelayOnTryAgain: 100,
        clusterRetryStrategy(times: number) {
          // Keep attempting to reconnect in the background with exponential backoff
          return Math.min(times * 200, 2000);
        },
        scaleReads: 'master',
      },
    ) as unknown as Redis;
  } else {
    instance = new Redis(url, {
      maxRetriesPerRequest: 3, // Fail fast!
      enableOfflineQueue: false,
      connectTimeout: 5000,
      retryStrategy(times: number) {
        return Math.min(times * 200, 2000);
      },
    });
  }

  instance.on('error', (err: Error) => {
    console.error('[%s] Connection error:', label, err.message);
  });

  return instance;
}

// --- SAFETY UTILITIES (DRY) ---

/**
 * Execute a Redis operation (command or pipeline) with a mandatory timeout.
 * Prevents the request pipeline from hanging.
 */
export async function executeRedisSafe<T>(
  operation: Promise<T>,
  timeoutMs: number = 2000,
  context: string = 'Redis-Safe',
): Promise<T> {
  return Promise.race([
    operation,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[${context}] Timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

/**
 * Perform a background Redis synchronization (Fire-and-forget).
 * Handles errors and logs them without blocking the main thread.
 */
export function bgRedisSync(
  logger: { info: (msg: string) => void; error: (msg: string) => void },
  context: string,
  syncFn: () => Promise<any>,
) {
  const start = Date.now();
  (async () => {
    try {
      await executeRedisSafe(syncFn(), 5000, context);
      logger.info(`[${context}] Background sync complete (+${Date.now() - start}ms)`);
    } catch (err) {
      logger.error(`[${context}] Background sync failed: ${(err as Error).message}`);
    }
  })();
}

// ── Global Instances ─────────────────────────────────────────────────────────

/**
 * UI Redis instance — dedicated to dashboard rate limiting, 2FA locks, and session state.
 * Isolated from API Redis to prevent UI traffic from affecting core engine operations.
 */
export const redis = createRedisInstance(uiRedisUrl, isUiCluster, 'Redis-UI');

/**
 * API Redis instance — used by dashboard for BullMQ queue operations and
 * cross-cluster cache busting (e.g. IronDome metadata invalidation).
 */
export const redisApi = createRedisInstance(apiRedisUrl, isApiCluster, 'Redis-API');

// --- QUEUE INSTANCES (BullMQ) — Target API Redis ---

const queueCache = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  if (queueCache.has(name)) {
    return queueCache.get(name)!;
  }

  let connection: any;

  if (process.env.NEXT_PHASE === 'phase-production-build') {
    connection = {};
  } else if (isApiCluster) {
    const url = new URL(apiRedisUrl!);
    url.pathname = '';
    connection = new Redis.Cluster(
      [
        {
          host: url.hostname,
          port: parseInt(url.port || '6379'),
        },
      ],
      {
        redisOptions: {
          password: url.password,
          maxRetriesPerRequest: null, // Hard requirement for BullMQ
          connectTimeout: 5000,
        },
        enableOfflineQueue: false, // Fail fast to prevent memory buildup
        // Allow more redirections during topology transitions (MOVED / ASKING).
        maxRedirections: 32,
        // Wait for cluster to finish LOADING / elect a new primary.
        retryDelayOnClusterDown: 300,
        // Pause until new primary accepts writes after failover.
        retryDelayOnFailover: 200,
        // Wait for slot migration to complete (TRYAGAIN).
        retryDelayOnTryAgain: 100,
        clusterRetryStrategy(times: number) {
          return Math.min(times * 200, 2000);
        },
        scaleReads: 'master',
      },
    );
  } else {
    connection = new Redis(apiRedisUrl!, {
      maxRetriesPerRequest: null, // Hard requirement for BullMQ
      enableOfflineQueue: false, // Fail fast to prevent memory buildup
      connectTimeout: 5000,
      retryStrategy(times: number) {
        return Math.min(times * 200, 2000);
      },
    });
  }

  const queue = new Queue(name, {
    connection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    },
  });

  queueCache.set(name, queue);
  return queue;
}

// --- KEY HELPERS (Must match IronDomeGuard in NestJS) ---

/**
 * Metadata cache for API Keys
 * format: {apiKey}:meta
 */
export const getMetadataKey = (apiKey: string) => `{${apiKey}}:meta`;

/**
 * Organization Quota Limit (Balance)
 * format: {orgId}:limit
 */
export const getLimitKey = (orgId: string) => `{${orgId}}:limit`;

/**
 * Drops the IronDome metadata cache of every app in an organization.
 *
 * IronDomeGuard copies the organization's `rpsLimit` into each app's
 * `{…}:meta` entry when it hydrates it, so anything that changes the limit
 * must call this — otherwise the engine keeps enforcing the old one until the
 * entry expires (5 minutes). The engine's own writers (rps-expiration cron,
 * billing webhook) do the same through the `sync-redis-quota` outbox event.
 */
export async function invalidateOrganizationAppMetadata(payload: Payload, organizationId: string): Promise<void> {
  const { docs } = await payload.find({
    collection: 'apps',
    where: { organization: { equals: organizationId } },
    select: { secretKeyHash: true, publicKey: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  });
  if (docs.length === 0) return;

  const pipeline = redisApi.pipeline();
  for (const app of docs) {
    if (app.secretKeyHash) pipeline.del(getMetadataKey(app.secretKeyHash));
    if (app.publicKey) pipeline.del(getMetadataKey(app.publicKey));
  }
  await pipeline.exec();
}

// --- SECRET HELPERS ---

/**
 * Constant-time comparison between two secrets using SHA-256 digests.
 */
export function timingSafeEqualSecret(candidate: string, expected: string): boolean {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || !candidate || !expected) {
    return false;
  }
  const bufCandidate = crypto.createHash('sha256').update(candidate).digest();
  const bufExpected = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(bufCandidate, bufExpected);
}

/**
 * Validates an incoming internal secret against Redis rotated keys and revocation list in constant-time.
 */
export async function validateInternalSecret(incomingSecret: string | null | undefined): Promise<boolean> {
  if (!incomingSecret || typeof incomingSecret !== 'string') {
    return false;
  }

  try {
    const REVOKED_KEY = '{system}:internal_secret:revoked';
    const secretHash = crypto.createHash('sha256').update(incomingSecret).digest('hex');
    const isHashRevoked = await redisApi.sismember(REVOKED_KEY, secretHash);

    if (isHashRevoked === 1) {
      console.warn('[Dashboard Internal Auth] Rejected revoked secret');
      return false;
    }

    const currentSecret = await redisApi.get('{system}:internal_secret:current');
    const previousSecret = await redisApi.get('{system}:internal_secret:previous');

    let validCandidateSecrets: string[] = [];

    if (currentSecret || previousSecret) {
      validCandidateSecrets = [currentSecret, previousSecret].filter(Boolean) as string[];
    } else {
      const envSecret = process.env.INTERNAL_SECRET;
      if (envSecret) {
        validCandidateSecrets = [envSecret];
      }
    }

    for (const validSecret of validCandidateSecrets) {
      if (timingSafeEqualSecret(incomingSecret, validSecret)) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error('[Dashboard Internal Auth] Error validating secret:', err);
    // Redis availability is part of the rotation trust boundary. Never
    // resurrect a static environment secret after rotation when Redis is
    // unavailable; fail closed instead.
    return false;
  }
}

export async function getInternalSecret(): Promise<string> {
  const current = await redisApi.get('{system}:internal_secret:current');
  if (current) return current;

  // A missing current key can occur during a guarded rotation write. Use the
  // still-valid previous key before considering the bootstrap environment
  // value. If Redis is unavailable, the read throws and no stale env fallback
  // is returned.
  const previous = await redisApi.get('{system}:internal_secret:previous');
  return previous || process.env.INTERNAL_SECRET || '';
}

// --- QUEUE DEFINITIONS ---

export async function enqueueTransaction(txKey: string, mode: 'fast' | 'lazy') {
  const queueName = mode === 'fast' ? QUEUE_FAST : QUEUE_LAZY;
  const queue = getQueue(queueName);

  await queue.add(
    'process-tx',
    { txKey },
    {
      jobId: txKey, // Prevent duplicate jobs for the same txKey
    },
  );
}
