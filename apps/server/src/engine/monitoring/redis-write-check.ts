import type { Cluster, Redis } from 'ioredis';

const fieldsOf = (info: string) =>
  new Map(
    info
      .split(/\r?\n/)
      .map((line) => line.split(':'))
      .filter((parts) => parts.length >= 2)
      .map(([key, ...value]) => [key.trim(), value.join(':').trim()]),
  );

/**
 * Why a Redis node refuses writes, read from its `INFO persistence` and `INFO memory`, or `null` when it takes them:
 * - its last snapshot failed: with `stop-writes-on-bgsave-error` (the default) it answers MISCONF to every write until
 *   one succeeds;
 * - its append-only writes fail;
 * - its memory is full under `noeviction`, counted as Redis counts it, without the replication and append-only buffers.
 *
 * @param info - The text of the two sections.
 */
export function writeRefusal(info: string): string | null {
  const fields = fieldsOf(info);
  if (fields.get('rdb_last_bgsave_status') === 'err') return 'the last snapshot to disk failed (MISCONF)';
  if (fields.get('aof_enabled') === '1' && fields.get('aof_last_write_status') === 'err') {
    return 'append-only writes to disk fail';
  }
  const max = Number(fields.get('maxmemory') ?? 0);
  const used = Number(fields.get('used_memory') ?? 0) - Number(fields.get('mem_not_counted_for_evict') ?? 0);
  if (max > 0 && fields.get('maxmemory_policy') === 'noeviction' && used > max)
    return 'its memory is full (noeviction)';
  return null;
}

const isCluster = (redis: Redis | Cluster): redis is Cluster => typeof (redis as Cluster).nodes === 'function';

/**
 * Whether every node that takes writes takes them: each master of a cluster, or the one server. PING answers while a
 * node refuses every write, so the health check asks this as well.
 *
 * @param redis - The client of the engine.
 * @returns `null`, or the first refusal with its node.
 */
export async function findWriteRefusal(redis: Redis | Cluster): Promise<string | null> {
  const nodes = isCluster(redis) ? redis.nodes('master') : [redis];
  if (nodes.length === 0) return 'no master node is connected';
  const refusals = await Promise.all(
    nodes.map(async (node) => {
      const [persistence, memory] = await Promise.all([node.info('persistence'), node.info('memory')]);
      const refusal = writeRefusal(`${persistence}\n${memory}`);
      return refusal && (isCluster(redis) ? `${node.options.host}:${node.options.port}: ${refusal}` : refusal);
    }),
  );
  return refusals.find((r) => r !== null) ?? null;
}

/**
 * {@link findWriteRefusal} at most once per interval: the health check runs every few seconds in each container.
 *
 * @param redis - The client of the engine.
 * @param intervalMs - How long one answer holds.
 * @param now - The clock.
 */
export function createWriteCheck(redis: Redis | Cluster, intervalMs: number, now: () => number = Date.now) {
  let last: { at: number; refusal: Promise<string | null> } | null = null;
  return (): Promise<string | null> => {
    if (!last || now() - last.at > intervalMs) last = { at: now(), refusal: findWriteRefusal(redis) };
    return last.refusal;
  };
}
