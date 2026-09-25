import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveEnvUrl } from '@tuwaio/shared/utils';
import Redis, { Cluster } from 'ioredis';
import Redlock from 'redlock';

import { REDIS, REDLOCK } from './redis.constants';
export { REDIS, REDLOCK };

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (configService: ConfigService) => {
        const rawRedisUrl = configService.get<string>('REDIS_API_URL') || configService.get<string>('REDIS_URL') || '';
        const redisUrl = resolveEnvUrl(rawRedisUrl);
        const isCluster =
          (configService.get<string>('REDIS_API_MODE') || configService.get<string>('REDIS_MODE')) === 'cluster';

        if (isCluster) {
          const url = new URL(redisUrl);
          // For local development (host -> docker cluster), mapping internal IPs to localhost ports
          const natMapString = configService.get<string>('CLUSTER_NAT_MAP');
          let natMap = undefined;

          if (natMapString) {
            try {
              natMap = JSON.parse(natMapString);
            } catch (e) {
              console.error('[RedisModule] Failed to parse CLUSTER_NAT_MAP:', e);
            }
          }

          return new Cluster(
            [
              {
                host: url.hostname,
                port: parseInt(url.port || '6379'),
              },
            ],
            {
              redisOptions: {
                password: url.password,
                maxRetriesPerRequest: null,
              },
              enableOfflineQueue: false,
              scaleReads: 'master',
              natMap,
              // Allow up to 32 redirections before failing; the default 16 can
              // be exhausted during rapid topology changes (MOVED / ASKING).
              maxRedirections: 32,
              // Pause before retrying after CLUSTERDOWN — gives the cluster
              // time to complete the LOADING phase or finish a failover election.
              retryDelayOnClusterDown: 300,
              // Wait for the new primary to become writable after a failover.
              retryDelayOnFailover: 200,
              // Pause before retrying a slot that is mid-migration (TRYAGAIN).
              retryDelayOnTryAgain: 100,
              // Exponential backoff for full cluster reconnects. Returns null
              // after 20 attempts (~40 s total) to stop retrying indefinitely.
              clusterRetryStrategy(times: number) {
                if (times > 20) return null;
                return Math.min(times * 200, 2000);
              },
            },
          );
        }

        return new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          enableOfflineQueue: false,
          retryStrategy(times: number) {
            if (times > 20) return null;
            return Math.min(times * 200, 2000);
          },
        });
      },
      inject: [ConfigService],
    },
    {
      provide: REDLOCK,
      useFactory: (configService: ConfigService, redis: Redis | Cluster) => {
        const redlockUrlsString = configService.get<string>('REDLOCK_URLS');
        const clients = redlockUrlsString
          ? redlockUrlsString
              .split(',')
              .map((url) => url.trim().replace(/^['"]|['"]$/g, ''))
              .filter((url) => url.length > 0)
              .map(
                (url) =>
                  new Redis(url, {
                    maxRetriesPerRequest: 3,
                    enableOfflineQueue: false,
                  }),
              )
          : [redis];

        // @ts-expect-error: Cluster vs Redis type mismatch
        return new Redlock(clients, {
          driftFactor: 0.01,
          retryCount: 10,
          retryDelay: 200,
          retryJitter: 200,
          automaticExtensionThreshold: 500,
        });
      },
      inject: [ConfigService, REDIS],
    },
  ],
  exports: [REDIS, REDLOCK],
})
export class RedisModule {}
