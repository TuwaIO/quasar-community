// @vitest-environment node
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for an ioredis client: keeps the options it was created with, emits 'ready' on demand
const clients = vi.hoisted(() => [] as Array<EventEmitter & { options: { enableOfflineQueue?: boolean } }>);

vi.mock('ioredis', async () => {
  const { EventEmitter: Emitter } = await import('events');
  class FakeRedis extends Emitter {
    options: Record<string, unknown>;
    constructor(_url: string, options: Record<string, unknown>) {
      super();
      this.options = { ...options };
      clients.push(this as never);
    }
  }
  class FakeCluster extends FakeRedis {
    constructor(_nodes: unknown, options: Record<string, unknown>) {
      super('', options);
    }
  }
  return { default: Object.assign(FakeRedis, { Cluster: FakeCluster }) };
});
vi.mock('bullmq', () => ({ Queue: class {} }));

describe('Redis clients of the dashboard at startup', () => {
  beforeEach(() => {
    clients.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function createClient(mode: 'single' | 'cluster') {
    vi.resetModules();
    const { createRedisInstance } = await import('@/lib/redis');
    clients.length = 0;
    createRedisInstance('redis://localhost:6379', mode === 'cluster', 'Redis-Test');
    return clients[0];
  }

  it.each(['single', 'cluster'] as const)(
    'queues commands until the first connection is ready, then fails fast (%s)',
    async (mode) => {
      const client = await createClient(mode);
      expect(client.options.enableOfflineQueue).toBe(true);

      client.emit('ready');
      expect(client.options.enableOfflineQueue).toBe(false);
    },
  );

  it('stops queueing after 10 seconds when Redis never becomes ready', async () => {
    const client = await createClient('single');

    vi.advanceTimersByTime(9_999);
    expect(client.options.enableOfflineQueue).toBe(true);
    vi.advanceTimersByTime(1);
    expect(client.options.enableOfflineQueue).toBe(false);
  });
});
