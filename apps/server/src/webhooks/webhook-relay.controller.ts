import {
  Controller,
  Get,
  Headers,
  Inject,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { decrypt } from '@tuwaio/shared/encryption';
import { isLocalhostUrl } from '@tuwaio/shared/utils';
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { IncomingMessage, ServerResponse } from 'http';
import Redis, { Cluster } from 'ioredis';

import { Public } from '../common/public.decorator';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema/index';
import { REDIS } from '../redis/redis.module';

interface CachedEndpoint {
  id: string;
  url: string;
  isActive: boolean;
}

@Public()
@Controller('v1/engine/webhooks')
export class WebhookRelayController implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRelayController.name);
  private subscriber: Redis | Cluster | null = null;
  private readonly listeners = new Map<string, Set<ServerResponse>>();
  private masterHeartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis | Cluster,
  ) {}

  onModuleInit() {
    this.initSubscriber();
    this.startMasterHeartbeat();
  }

  onModuleDestroy() {
    this.stopMasterHeartbeat();

    // Cleanly end all active client SSE streams
    for (const [channel, clients] of this.listeners) {
      for (const client of clients) {
        try {
          if (!client.writableEnded && !client.destroyed) {
            client.end();
          }
        } catch {
          // Ignored during shutdown
        }
      }
      clients.clear();
      this.listeners.delete(channel);
    }

    if (this.subscriber) {
      try {
        this.subscriber.disconnect();
      } catch {
        // Ignored during shutdown
      }
      this.subscriber = null;
    }
  }

  private initSubscriber(): Redis | Cluster | null {
    if (this.subscriber) {
      return this.subscriber;
    }

    try {
      const isCluster = 'nodes' in this.redis;
      if (isCluster) {
        this.subscriber = (this.redis as Cluster).duplicate([], { enableOfflineQueue: true });
      } else {
        this.subscriber = (this.redis as Redis).duplicate({ enableOfflineQueue: true });
      }

      this.subscriber.on('error', (err: Error) => {
        this.logger.warn(`[Webhook Relay] Shared Redis subscriber error: ${err.message}`);
      });

      this.subscriber.on('message', (channel: string, message: string) => {
        const clients = this.listeners.get(channel);
        if (!clients || clients.size === 0) return;

        for (const client of clients) {
          if (client.writableEnded || client.destroyed) {
            clients.delete(client);
            continue;
          }
          try {
            client.write(`event: payload\ndata: ${message}\n\n`);
          } catch (err) {
            this.logger.warn(`[Webhook Relay] Write error to client on ${channel}:`, err);
            clients.delete(client);
          }
        }
      });

      return this.subscriber;
    } catch (err) {
      this.logger.error('[Webhook Relay] Failed to initialize shared Redis subscriber:', err);
      return null;
    }
  }

  /**
   * Single master heartbeat ticker across all connected SSE clients.
   * Eliminates per-connection timer overhead and automatically sweeps dead sockets.
   */
  private startMasterHeartbeat() {
    if (this.masterHeartbeatTimer) return;

    this.masterHeartbeatTimer = setInterval(() => {
      if (this.listeners.size === 0) return;

      for (const [channel, clients] of this.listeners) {
        for (const client of clients) {
          if (client.writableEnded || client.destroyed) {
            clients.delete(client);
            continue;
          }
          try {
            client.write(': ping\n\n');
          } catch {
            clients.delete(client);
          }
        }

        if (clients.size === 0) {
          this.listeners.delete(channel);
          if (this.subscriber) {
            this.subscriber.unsubscribe(channel).catch(() => {});
          }
        }
      }
    }, 15000);
  }

  private stopMasterHeartbeat() {
    if (this.masterHeartbeatTimer) {
      clearInterval(this.masterHeartbeatTimer);
      this.masterHeartbeatTimer = null;
    }
  }

  /**
   * SSE Stream endpoint for the Quasar Webhook Local Dev Relay.
   * Allows developer CLI (npx @tuwaio/quasar-sdk listen) to receive live production
   * webhooks on localhost without tunnels or open ports.
   */
  @Get('listen')
  async listen(
    @Query('secret') querySecret: string | undefined,
    @Headers('x-webhook-secret') headerSecret: string | undefined,
    @Req() req: { raw: IncomingMessage },
    @Res() res: { raw: ServerResponse; hijack?: () => void },
  ) {
    const secret = querySecret || headerSecret;

    if (!secret || typeof secret !== 'string' || !secret.startsWith('whsec_')) {
      throw new UnauthorizedException('Missing or invalid webhook signing secret (must start with whsec_)');
    }

    const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
    const cacheKey = `relay:auth:${secretHash}`;

    let endpoint: CachedEndpoint | undefined;

    // 1. O(1) cached endpoint lookup in Redis
    try {
      const cachedData = await this.redis.get(cacheKey);
      if (cachedData) {
        endpoint = JSON.parse(cachedData) as CachedEndpoint;
      }
    } catch {
      // Redis get failed, continue to DB fallback
    }

    // 2. Fallback to DB query if not in cache
    if (!endpoint) {
      const candidates = await this.db
        .select()
        .from(schema.webhookEndpoints)
        .where(eq(schema.webhookEndpoints.isActive, true));

      for (const candidate of candidates) {
        if (!isLocalhostUrl(candidate.url)) continue;
        try {
          const decrypted = decrypt(candidate.signingSecret);
          if (
            decrypted &&
            decrypted.length === secret.length &&
            crypto.timingSafeEqual(Buffer.from(decrypted), Buffer.from(secret))
          ) {
            endpoint = {
              id: candidate.id,
              url: candidate.url,
              isActive: candidate.isActive ?? true,
            };
            await this.redis.set(cacheKey, JSON.stringify(endpoint), 'EX', 86400);
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!endpoint || !endpoint.isActive) {
      this.logger.warn(`[Webhook Relay] Unauthorized listener attempt for secret hash: ${secretHash.slice(0, 8)}...`);
      throw new UnauthorizedException('Invalid webhook signing secret or endpoint inactive');
    }

    this.logger.log(`[Webhook Relay] Client connected to relay stream for endpoint ${endpoint.id} (${endpoint.url})`);

    // 3. Hijack Fastify response so Fastify does not attempt to send headers/payload after Promise resolves
    if (typeof res.hijack === 'function') {
      res.hijack();
    }

    // 4. Configure socket options for stable long-lived streaming
    const rawReq = req.raw;
    const rawRes = res.raw;

    if (rawReq.socket) {
      rawReq.socket.setKeepAlive(true, 10000);
      rawReq.socket.setNoDelay(true);
    }

    // 5. Setup SSE response headers on raw Node.js ServerResponse
    if (!rawRes.headersSent) {
      rawRes.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      rawRes.flushHeaders?.();
    }

    rawRes.write(': connected\n\n');
    rawRes.write(
      `event: ready\ndata: ${JSON.stringify({ endpointId: endpoint.id, url: endpoint.url, timestamp: Date.now() })}\n\n`,
    );

    // 6. Register client with shared subscriber pool
    const sub = this.initSubscriber();
    this.startMasterHeartbeat();
    const channel = `relay:webhook:${endpoint.id}`;

    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    const channelClients = this.listeners.get(channel)!;
    channelClients.add(rawRes);

    if (channelClients.size === 1 && sub) {
      sub.subscribe(channel).catch((subErr) => {
        this.logger.error(`[Webhook Relay] Failed to subscribe to Redis channel ${channel}:`, subErr);
      });
    }

    let isCleanedUp = false;

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;

      channelClients.delete(rawRes);
      if (channelClients.size === 0) {
        this.listeners.delete(channel);
        if (sub) {
          sub.unsubscribe(channel).catch(() => {});
        }
      }

      try {
        if (!rawRes.writableEnded && !rawRes.destroyed) {
          rawRes.end();
        }
      } catch {
        // Ignored during client cleanup
      }
      this.logger.log(`[Webhook Relay] Client disconnected from endpoint ${endpoint?.id}`);
    };

    rawReq.on('close', cleanup);
    rawReq.on('error', cleanup);
  }
}
