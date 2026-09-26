import { normalizeError } from '@tuwaio/orbit-core';
import { TransactionStatus } from '@tuwaio/pulsar-core';
import { evmTracker } from '@tuwaio/pulsar-evm';
import { Transaction, UpdatableTransactionFields } from '@tuwaio/quasar-sdk';
import { decrypt } from '@tuwaio/shared/encryption';
import { Config, createConfig } from '@wagmi/core';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis, { Cluster } from 'ioredis';
import { Counter, Gauge } from 'prom-client';
import { Chain, fallback, Hex, http } from 'viem';
import { getBlock } from 'viem/actions';
import * as chains from 'viem/chains';

import { getAlchemyKey } from '../../constants';
import * as schema from '../../database/schema/index';
import { alchemyNetworkMap } from '../../lib/generated/alchemyNetworkMap';
import { isUsableRpcUrl } from './rpc-guard';

/** Maximum number of cached Wagmi configs. Prevents unbounded memory growth in long-running pods. */
const CONFIG_CACHE_MAX_SIZE = 500;
const CONFIG_CACHE = new Map<string, Config>();

/** LRU-get: moves accessed entry to the end (most recently used). */
function getCachedConfig(key: string): Config | undefined {
  const config = CONFIG_CACHE.get(key);
  if (config) {
    CONFIG_CACHE.delete(key);
    CONFIG_CACHE.set(key, config);
  }
  return config;
}

/** LRU-set: evicts the oldest entry when cache exceeds max size. */
function setCachedConfig(key: string, config: Config): void {
  if (CONFIG_CACHE.size >= CONFIG_CACHE_MAX_SIZE) {
    const oldest = CONFIG_CACHE.keys().next().value;
    if (oldest !== undefined) CONFIG_CACHE.delete(oldest);
  }
  CONFIG_CACHE.set(key, config);
}

type UpdateFn = (txKey: string, data: UpdatableTransactionFields, isTerminal?: boolean) => Promise<void>;

export async function processEvmTx(
  tx: Transaction & { appId: string; ownerId: string },
  onTerminalState: (status: TransactionStatus) => Promise<void>,
  updateDbTx: UpdateFn,
  db: NodePgDatabase<typeof schema>,
  redis: Redis | Cluster,
  lagGauge: Gauge<string>,
  txCounter: Counter<string>,
  errorCounter: Counter<string>,
) {
  const chainId = Number(tx.chainId);
  const appId = tx.appId;

  if (!appId) {
    throw new Error(`[EVM TRACKER] Missing appId for tx ${tx.txKey}. BYO-RPC requires appId.`);
  }

  // 1. Resolve Chain object
  const viemChain = Object.values(chains).find((c) => (c as Chain).id === chainId) as Chain;
  if (!viemChain) {
    throw new Error(`[EVM TRACKER] Unsupported chain ID: ${chainId}`);
  }

  // 2. Fetch App details for custom provider keys
  const [app] = await db.select().from(schema.apps).where(eq(schema.apps.id, appId)).limit(1);

  // 3. Collect all available RPCs in priority order
  const rpcUrls: string[] = [];
  const sources: string[] = [];

  // A. App-specific Chain Overwrites
  const appConfigs = await db
    .select({ rpcUrl: schema.appsRpcConfigs.rpcUrl })
    .from(schema.appsRpcConfigs)
    .where(and(eq(schema.appsRpcConfigs.parentId, appId), eq(schema.appsRpcConfigs.chainId, chainId.toString())));

  for (const c of appConfigs) {
    const url = decrypt(c.rpcUrl);
    if (await isUsableRpcUrl(url, '[EVM TRACKER]', 'App Overwrite')) {
      rpcUrls.push(url);
      sources.push('App Overwrite');
    }
  }

  // B. App-specific Alchemy
  const alchemyNetwork = alchemyNetworkMap[chainId];
  if (app?.alchemyApiKey && alchemyNetwork) {
    const decryptedAlchemyKey = decrypt(app.alchemyApiKey);
    rpcUrls.push(`https://${alchemyNetwork}.g.alchemy.com/v2/${decryptedAlchemyKey}`);
    sources.push('App Alchemy');
  }

  // C. App-specific QuickNode (Unified Multi-Chain Link)
  if (app?.quickNodeApiKey && app?.quickNodeAppName) {
    const decryptedQuickNodeKey = decrypt(app.quickNodeApiKey);
    const url = decryptedQuickNodeKey.startsWith('http')
      ? decryptedQuickNodeKey
      : `https://${app.quickNodeAppName}.quiknode.pro/${decryptedQuickNodeKey}/`;
    if (await isUsableRpcUrl(url, '[EVM TRACKER]', 'App QuickNode')) {
      rpcUrls.push(url);
      sources.push('App QuickNode');
    }
  }

  // D. System Alchemy Fallback
  const systemAlchemyKey = getAlchemyKey();
  if (systemAlchemyKey && alchemyNetwork) {
    rpcUrls.push(`https://${alchemyNetwork}.g.alchemy.com/v2/${systemAlchemyKey}`);
    sources.push('System Alchemy');
  }

  // E. Public RPC Fallback (Viem default)
  if (viemChain.rpcUrls.default.http[0]) {
    rpcUrls.push(viemChain.rpcUrls.default.http[0]);
    sources.push('Public Fallback');
  }

  if (rpcUrls.length === 0) {
    throw new Error(`[EVM TRACKER] No valid RPC URLs found for chain ${chainId}`);
  }

  const primaryRpcUrl = rpcUrls[0];

  console.log(
    `[EVM TRACKER] Initializing with ${rpcUrls.length} providers for ${tx.txKey}. Priority: ${sources.join(' > ')}`,
  );
  console.log(
    `[EVM TRACKER] Starting for ${tx.txKey} on chain ${tx.chainId} using RPC: ...${primaryRpcUrl.slice(-12)}`,
  );

  // fallback() tries the transports in array order, so the order is part of the config: the same
  // URLs in another priority must not share a cache entry. Sorting here once reordered `rpcUrls`
  // in place and put the system Alchemy key ahead of the app's own RPC.
  const cacheKey = `${chainId}:${rpcUrls.join(',')}`;
  let config = getCachedConfig(cacheKey);
  if (!config) {
    config = createConfig({
      chains: [viemChain],
      transports: {
        [chainId]: fallback(rpcUrls.map((url) => http(url, { batch: true }))),
      },
    });
    setCachedConfig(cacheKey, config);
  }
  const redisKey = `tx_conf:${tx.txKey}`;

  let fetchedDetails: UpdatableTransactionFields = {};

  await evmTracker({
    tx: {
      txKey: tx.txKey,
      chainId,
      requiredConfirmations: tx.requiredConfirmations ? Number(tx.requiredConfirmations) : undefined,
    },
    config,
    waitForTransactionReceiptParams: {
      hash: tx.txKey as Hex,
      retryCount: 36,
      timeout: 180_000, // 3 minutes hard ceiling
    },
    onInitialize: () => {
      console.log(`[EVM TRACKER] Initializing for ${tx.txKey} on chain ${tx.chainId}`);
      // DB write removed to save IOPS. Initial state is already 'pending' in DB.
    },
    onTxDetailsFetched: (details) => {
      // Store details locally to be written in terminal state
      fetchedDetails = {
        to: details.to ?? undefined,
        input: details.input,
        value: details.value?.toString(),
        nonce: details.nonce,
        maxFeePerGas: details.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: details.maxPriorityFeePerGas?.toString(),
      };
    },
    onConfirmationsUpdate: async (confirmations) => {
      // Store intermediate confirmations in Redis to avoid DB IOPS
      await redis.set(redisKey, confirmations.toString(), 'EX', 3600);
      console.debug(`[EVM TRACKER] Confirmations update for ${tx.txKey}: ${confirmations}`);
    },
    onSuccess: async (_details, receipt, client) => {
      try {
        const block = await getBlock(client, { blockNumber: receipt.blockNumber });
        const timestamp = Number(block.timestamp);
        const isSuccess = receipt.status === 'success';
        const status = isSuccess ? TransactionStatus.Success : TransactionStatus.Failed;
        console.log(`[EVM TRACKER] ${isSuccess ? 'SUCCESS' : 'REVERTED'}: ${tx.txKey}`);

        // Fetch final confirmations from Redis if available
        const redisConf = await redis.get(redisKey);
        const confirmations = redisConf ? parseInt(redisConf) : undefined;

        const lagMs = Math.max(0, Date.now() - timestamp * 1000);
        const lagSeconds = lagMs / 1000;

        // Record metrics
        lagGauge.set({ ecosystem: 'EVM', chainId: String(chainId) }, lagSeconds);
        txCounter.inc({ ecosystem: 'EVM', chainId: String(chainId), status });
        if (!isSuccess) {
          errorCounter.inc({ ecosystem: 'EVM', chainId: String(chainId) });
        }
        await updateDbTx(
          tx.txKey,
          {
            ...fetchedDetails,
            status,
            pending: false,
            isError: !isSuccess,
            finishedTimestamp: timestamp,
            confirmations,
          },
          true,
        );

        // Cleanup Redis
        await redis.del(redisKey);

        // IMPORTANT: Await terminal state after DB update to ensure consistency
        await onTerminalState(status);
      } catch (err) {
        console.error('[DB ERROR] onSuccess async execution:', tx.txKey, err);
      }
    },
    onReplaced: async (replacement) => {
      console.log(`[EVM TRACKER] REPLACED: ${tx.txKey} -> ${replacement.transaction.hash}`);
      await updateDbTx(
        tx.txKey,
        {
          ...fetchedDetails,
          status: TransactionStatus.Replaced,
          pending: false,
          replacedTxHash: replacement.transaction.hash,
        },
        true,
      );
      // Cleanup Redis
      await redis.del(redisKey);

      txCounter.inc({
        ecosystem: 'EVM',
        chainId: String(chainId),
        status: TransactionStatus.Replaced,
      });
      await onTerminalState(TransactionStatus.Replaced);
    },
    onFailure: async (error) => {
      console.error('[EVM TRACKER] FAILED:', tx.txKey, error);
      txCounter.inc({
        ecosystem: 'EVM',
        chainId: String(chainId),
        status: TransactionStatus.Failed,
      });
      errorCounter.inc({ ecosystem: 'EVM', chainId: String(chainId) });

      // Fetch final confirmations from Redis if available
      const redisConf = await redis.get(redisKey);
      const confirmations = redisConf ? parseInt(redisConf) : undefined;

      await updateDbTx(
        tx.txKey,
        {
          ...fetchedDetails,
          status: TransactionStatus.Failed,
          pending: false,
          isError: true,
          error: normalizeError(error),
          confirmations,
        },
        true,
      );

      // Cleanup Redis
      await redis.del(redisKey);

      await onTerminalState(TransactionStatus.Failed);
    },
  });
}
