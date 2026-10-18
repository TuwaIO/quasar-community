import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Inject, Logger, Req, ServiceUnavailableException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';

import { Public } from '../../common/public.decorator';
import { DRIZZLE, DRIZZLE_READ } from '../../database/database.constants';
import * as schema from '../../database/schema/index';
import { REDIS } from '../../redis/redis.constants';
import { createWriteCheck } from './redis-write-check';

const TRANSIENT_DATABASE_TERMINATION_CODES = new Set(['57P01', '57P02', '57P03']);

export function isTransientDatabaseTermination(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && TRANSIENT_DATABASE_TERMINATION_CODES.has(code);
}

@Controller('v1/engine/monitoring')
export class MonitoringController {
  private readonly logger = new Logger(MonitoringController.name);
  // Whether every Redis node that takes writes takes them, asked at most every 10 seconds
  private readonly redisWriteRefusal: () => Promise<string | null>;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DRIZZLE) private readonly dbPrimary: NodePgDatabase<typeof schema>,
    @Inject(DRIZZLE_READ) private readonly dbRead: NodePgDatabase<typeof schema>,
    @InjectQueue('{tracking-fast}') private readonly fastQueue: Queue,
    @InjectQueue('{tracking-lazy}') private readonly lazyQueue: Queue,
  ) {
    this.redisWriteRefusal = createWriteCheck(redis, 10_000);
  }

  @Get('health')
  @Public()
  async checkHealth(@Req() req: any) {
    const start = Date.now();
    const isExternal = Boolean(req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
    let dbPrimaryStatus: string;
    let dbReadStatus: string;
    let redisStatus: string;

    // 1. Check Primary Database (Critical for writes/system)
    try {
      await Promise.race([
        this.dbPrimary.execute(sql`SELECT 1`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('primary db timeout')), 5000)),
      ]);
      dbPrimaryStatus = 'ok';
    } catch (e: any) {
      dbPrimaryStatus = isExternal ? 'error' : `error: ${e.message}`;
      if (isTransientDatabaseTermination(e)) {
        this.logger.warn(`[Healthcheck] Primary Database temporarily unavailable: ${e.message}`);
      } else {
        this.logger.error(`[Healthcheck] Primary Database check failed: ${e.message}`, e.stack);
      }
    }

    // 2. Check Read Replica (Degraded if offline, but doesn't block deployment)
    try {
      await Promise.race([
        this.dbRead.execute(sql`SELECT 1`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('read replica timeout')), 5000)),
      ]);
      dbReadStatus = 'ok';
    } catch (e: any) {
      dbReadStatus = isExternal ? 'error' : `error: ${e.message}`;
      this.logger.warn(`[Healthcheck] Read Replica check failed: ${e.message}`);
    }

    // 3. Check Redis (Critical for state/caching): it answers, and every node that takes writes takes them. PING
    // answers while a node refuses every write (MISCONF after a failed snapshot, or full memory), and the engine
    // writes to Redis on nearly every request.
    try {
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('redis timeout')), 5000)),
      ]);
      if (pong !== 'PONG') {
        redisStatus = 'error';
      } else {
        const refusal = await Promise.race([
          this.redisWriteRefusal(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('redis write check timeout')), 5000)),
        ]);
        redisStatus = refusal === null ? 'ok' : isExternal ? 'error' : `error: ${refusal}`;
        if (refusal !== null) this.logger.error(`[Healthcheck] Redis refuses writes: ${refusal}`);
      }
    } catch (e: any) {
      redisStatus = isExternal ? 'error' : `error: ${e.message}`;
      this.logger.error(`[Healthcheck] Redis check failed: ${e.message}`, e.stack);
    }

    const duration = Date.now() - start;

    // 4. Check Workers (via BullMQ queue saturation — workers healthy = queues not jammed)
    let workersStatus: string;
    let workerBacklog: number;
    try {
      const [fastWaiting, lazyWaiting] = await Promise.all([
        this.fastQueue.getWaitingCount(),
        this.lazyQueue.getWaitingCount(),
      ]);
      workerBacklog = fastWaiting + lazyWaiting;
      // Threshold: 50k waiting jobs signals workers are not processing fast enough
      workersStatus = workerBacklog > 50000 ? 'degraded' : 'ok';
    } catch (e: any) {
      workersStatus = isExternal ? 'error' : `error: ${e.message}`;
      workerBacklog = -1;
      this.logger.warn(`[Healthcheck] Workers queue check failed: ${e.message}`);
    }

    // System is operational if Primary DB and Redis are healthy (even if read replica or workers are catching up)
    const isHealthy = dbPrimaryStatus === 'ok' && redisStatus === 'ok';

    if (!isHealthy) {
      throw new ServiceUnavailableException({
        success: false,
        status: 'degraded',
        database: dbPrimaryStatus,
        readReplica: dbReadStatus,
        redis: redisStatus,
        workers: workersStatus,
        workerBacklog,
        latency: `${duration}ms`,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      success: true,
      status: dbReadStatus === 'ok' ? 'operational' : 'degraded_replica',
      database: dbPrimaryStatus,
      readReplica: dbReadStatus,
      redis: redisStatus,
      workers: workersStatus,
      workerBacklog,
      latency: `${duration}ms`,
      timestamp: new Date().toISOString(),
    };
  }
}
