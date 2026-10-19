import { ConfigService } from '@nestjs/config';
import { resolveEnvUrl } from '@tuwaio/shared/utils';
import type { DefaultJobOptions, QueueOptions } from 'bullmq';
import Redis, { Cluster } from 'ioredis';

/**
 * Creates an ioredis connection instance (standalone or Cluster)
 * suitable for BullMQ Queue/Worker constructors.
 *
 * BullMQ requires a pre-built ioredis instance for Cluster mode —
 * passing a plain object with `nodes` is silently ignored,
 * causing a fallback to 127.0.0.1:6379.
 */
function createBullMQConnection(configService: ConfigService): Redis | Cluster {
  const rawRedisUrl = configService.get<string>('REDIS_API_URL') || configService.get<string>('REDIS_URL') || '';
  const redisUrl = resolveEnvUrl(rawRedisUrl);
  const isCluster =
    (configService.get<string>('REDIS_API_MODE') || configService.get<string>('REDIS_MODE')) === 'cluster';

  if (isCluster) {
    const url = new URL(redisUrl);

    // Parse NAT map for internal Docker IP → host:port resolution.
    // Required when workers run on the host network and cluster nodes advertise
    // internal Docker IPs (e.g. 172.19.99.x). Format: JSON object string.
    const natMapString = configService.get<string>('CLUSTER_NAT_MAP');
    let natMap: Record<string, { host: string; port: number }> | undefined;
    if (natMapString) {
      try {
        natMap = JSON.parse(natMapString);
      } catch (e) {
        console.error('[BullMQConnectionFactory] Failed to parse CLUSTER_NAT_MAP:', e);
      }
    }

    return new Cluster([{ host: url.hostname, port: parseInt(url.port || '6379') }], {
      redisOptions: {
        password: url.password || undefined,
        // BullMQ hard requirement: null means "block forever" which lets BullMQ
        // manage its own timeout / retry lifecycle.
        maxRetriesPerRequest: null,
      },
      // BullMQ manages its own job queuing — disable ioredis offline queue to
      // prevent memory accumulation when the cluster is unreachable.
      enableOfflineQueue: false,
      // Allow more redirections before giving up during topology transitions
      // (MOVED / ASKING). Default is 16; doubling guards against multi-slot
      // resharding and replica failover races.
      maxRedirections: 32,
      // Milliseconds to wait before retrying after a CLUSTERDOWN response.
      // Gives the cluster time to finish LOADING / elect a new primary.
      retryDelayOnClusterDown: 300,
      // Milliseconds to wait before retrying after a MOVED redirect when a
      // failover is in progress and the new primary is not yet accepting writes.
      retryDelayOnFailover: 200,
      // Milliseconds to wait before retrying after a TRYAGAIN response sent
      // during a cluster migration of a slot.
      retryDelayOnTryAgain: 100,
      // Exponential backoff for full cluster reconnect attempts.
      // Returns null to stop retrying (after ~20 retries / ~40 s total), or a
      // delay in ms to schedule the next attempt.
      clusterRetryStrategy(times: number) {
        if (times > 20) return null;
        return Math.min(times * 200, 2000);
      },
      natMap,
    });
  }

  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    retryStrategy(times: number) {
      if (times > 20) return null;
      return Math.min(times * 200, 2000);
    },
  });
}

/**
 * How long finished jobs stay in Redis: completed ones for an hour, failed ones for a day. Every queue gets it
 * (`bullRootOptions`); a job may ask for less.
 *
 * By age only, never by `count`: BullMQ trims by count in one Lua script without a limit, so on a set with a backlog
 * the first finished job deletes all of it at once, Redis answers BUSY for minutes and the cluster may fail the shard
 * over (staging deploy, 2026-10-19). By age it removes at most `limit` jobs per finished job, and a backlog drains in
 * small steps.
 */
export const BULLMQ_DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  removeOnComplete: { age: 3600, limit: 1000 },
  removeOnFail: { age: 86400, limit: 1000 },
};

/**
 * The shared BullMQ config of `BullModule.forRootAsync`: the connection and {@link BULLMQ_DEFAULT_JOB_OPTIONS}.
 * Every module that registers the shared config uses it, because whichever registration wins sets the defaults of
 * every queue: one without them kept every finished job of the outbox processor (720 an hour) and filled the Redis
 * shard of `{outbox}` (RedisAPIMemoryHigh, 2026-10-19).
 */
export function bullRootOptions(configService: ConfigService): QueueOptions {
  return {
    connection: createBullMQConnection(configService) as unknown as QueueOptions['connection'],
    defaultJobOptions: BULLMQ_DEFAULT_JOB_OPTIONS,
  };
}
