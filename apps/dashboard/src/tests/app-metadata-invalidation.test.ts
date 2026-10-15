// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// The keys the dashboard deletes from API Redis, through the pipeline of the client
const deleted = vi.hoisted(() => [] as string[]);

vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('events');
  class FakeRedis extends EventEmitter {
    pipeline() {
      return {
        del: (key: string) => deleted.push(key),
        exec: async () => [],
      };
    }
  }
  return { default: Object.assign(FakeRedis, { Cluster: FakeRedis }) };
});
vi.mock('bullmq', () => ({ Queue: class {} }));

describe('invalidateOrganizationAppMetadata', () => {
  // EngineGuard caches an app under the SHA-256 of its secret key (`{hash}:meta`). `secretKeyHash` is a hidden field,
  // which Payload leaves out of every result unless the call asks for hidden fields: without them only the public-key
  // entries were deleted, and a change of the RPS limit or of the data processing status reached the server
  // integrations only when their entry expired (5 minutes).
  it("deletes the engine's metadata entries of every app of the organization, secret keys included", async () => {
    const { invalidateOrganizationAppMetadata } = await import('@/lib/redis');
    const find = vi.fn(async (args: { showHiddenFields?: boolean }) => ({
      docs: [{ id: 'app_1', publicKey: 'pk_1', ...(args.showHiddenFields ? { secretKeyHash: 'hash_1' } : {}) }],
    }));

    await invalidateOrganizationAppMetadata({ find } as never, 'org_1');

    expect(deleted).toEqual(expect.arrayContaining(['{hash_1}:meta', '{pk_1}:meta']));
  });
});
