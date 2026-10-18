import { describe, expect, it, vi } from 'vitest';

import { createWriteCheck, findWriteRefusal, writeRefusal } from './redis-write-check';

// PING passes while Redis refuses every write: on 2026-10-16 a full staging disk failed the snapshots, Redis answered
// MISCONF to each write and the health check still said "ok". The check reads the write state of each node instead.
const info = (fields: Record<string, string | number>) =>
  Object.entries(fields)
    .map(([k, v]) => `${k}:${v}`)
    .join('\r\n');
const healthy = {
  rdb_last_bgsave_status: 'ok',
  aof_enabled: 1,
  aof_last_write_status: 'ok',
  used_memory: 100,
  maxmemory: 1000,
  maxmemory_policy: 'noeviction',
  mem_not_counted_for_evict: 0,
};

describe('writeRefusal', () => {
  it('accepts a node whose snapshot and append-only writes succeed and whose memory has room', () => {
    expect(writeRefusal(info(healthy))).toBeNull();
  });

  it('refuses a node whose last snapshot failed', () => {
    expect(writeRefusal(info({ ...healthy, rdb_last_bgsave_status: 'err' }))).toBe(
      'the last snapshot to disk failed (MISCONF)',
    );
  });

  it('refuses a node whose append-only writes fail, only while append-only is on', () => {
    expect(writeRefusal(info({ ...healthy, aof_last_write_status: 'err' }))).toBe('append-only writes to disk fail');
    expect(writeRefusal(info({ ...healthy, aof_enabled: 0, aof_last_write_status: 'err' }))).toBeNull();
  });

  it('refuses a node out of memory under noeviction, counting memory as Redis does', () => {
    expect(writeRefusal(info({ ...healthy, used_memory: 1001 }))).toBe('its memory is full (noeviction)');
    // Replication and append-only buffers do not count against maxmemory
    expect(writeRefusal(info({ ...healthy, used_memory: 1100, mem_not_counted_for_evict: 200 }))).toBeNull();
    // A node that evicts keys, or has no limit, keeps taking writes
    expect(writeRefusal(info({ ...healthy, used_memory: 5000, maxmemory_policy: 'allkeys-lru' }))).toBeNull();
    expect(writeRefusal(info({ ...healthy, used_memory: 5000, maxmemory: 0 }))).toBeNull();
  });
});

const node = (host: string, fields: Record<string, string | number>) => ({
  options: { host, port: 6379 },
  info: vi.fn(async (section: string) =>
    section === 'persistence'
      ? info({
          rdb_last_bgsave_status: fields.rdb_last_bgsave_status,
          aof_enabled: fields.aof_enabled,
          aof_last_write_status: fields.aof_last_write_status,
        })
      : info({
          used_memory: fields.used_memory,
          maxmemory: fields.maxmemory,
          maxmemory_policy: fields.maxmemory_policy,
          mem_not_counted_for_evict: fields.mem_not_counted_for_evict,
        }),
  ),
});

describe('findWriteRefusal', () => {
  it('checks every master of a cluster and names the one that refuses', async () => {
    const masters = [node('10.0.0.1', healthy), node('10.0.0.3', { ...healthy, rdb_last_bgsave_status: 'err' })];
    const cluster = { nodes: vi.fn(() => masters) };
    await expect(findWriteRefusal(cluster as never)).resolves.toBe(
      '10.0.0.3:6379: the last snapshot to disk failed (MISCONF)',
    );
    expect(cluster.nodes).toHaveBeenCalledWith('master');
    expect(masters[0].info).toHaveBeenCalledWith('persistence');
    expect(masters[0].info).toHaveBeenCalledWith('memory');
  });

  it('checks the one server when Redis is not a cluster', async () => {
    await expect(findWriteRefusal(node('redis', healthy) as never)).resolves.toBeNull();
  });

  it('refuses a cluster with no master to write to', async () => {
    await expect(findWriteRefusal({ nodes: () => [] } as never)).resolves.toBe('no master node is connected');
  });
});

describe('createWriteCheck', () => {
  it('asks Redis at most once per interval', async () => {
    let now = 0;
    const server = node('redis', healthy);
    const check = createWriteCheck(server as never, 10_000, () => now);
    await Promise.all([check(), check()]);
    now = 9_999;
    await check();
    expect(server.info).toHaveBeenCalledTimes(2); // persistence and memory, once
    now = 10_001;
    await check();
    expect(server.info).toHaveBeenCalledTimes(4);
  });
});
