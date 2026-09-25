import { ConfigService } from '@nestjs/config';
import { resolveEnvUrl } from '@tuwaio/shared/utils';
import Redis, { Cluster } from 'ioredis';

/**
 * Creates an ioredis connection instance (standalone or Cluster)
 * suitable for BullMQ Queue/Worker constructors.
 *
 * BullMQ requires a pre-built ioredis instance for Cluster mode —
 * passing a plain object with `nodes` is silently ignored,
 * causing a fallback to 127.0.0.1:6379.
 */
export function createBullMQConnection(configService: ConfigService): Redis | Cluster {
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
