import { normalizeError } from '@tuwaio/orbit-core';
import { createPimlicoRpcUrl } from '@tuwaio/orbit-evm';
import { EvmTransaction, TransactionStatus } from '@tuwaio/pulsar-core';
import { erc4337Tracker, evmTracker } from '@tuwaio/pulsar-evm';
import { Transaction, UpdatableTransactionFields } from '@tuwaio/quasar-sdk';
import { decrypt } from '@tuwaio/shared/encryption';
import { Config, createConfig } from '@wagmi/core';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis, { Cluster } from 'ioredis';
import { Counter, Gauge } from 'prom-client';
import { Chain, fallback, Hex, http, isHex } from 'viem';
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

/**
 * Tracks an ERC-4337 UserOperation across two distinct phases:
 *
 * 1. Stage 1 (Bundler Mempool): Polls eth_getUserOperationReceipt via Pimlico Bundler RPC.
 *    Once bundled on-chain, writes the mined transaction hash to the database.
 * 2. Stage 2 (EVM On-Chain Finality): Uses standard EVM tracking to monitor confirmations,
 *    fetch gas and block details, write terminal state, and dispatch webhooks.
 *
 * If tx.hash is already populated upon invocation (e.g. resuming tracking across restarts),
 * Stage 1 is skipped and execution proceeds directly to Stage 2.
 */
export async function processPimlicoTx(
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
    throw new Error(`[PIMLICO TRACKER] Missing appId for tx ${tx.txKey}.`);
  }

  // 1. Resolve Viem Chain
  const viemChain = Object.values(chains).find((c) => (c as Chain).id === chainId) as Chain;
  if (!viemChain) {
    throw new Error(`[PIMLICO TRACKER] Unsupported chain ID: ${chainId}`);
  }

  // 2. Fetch App details for custom provider keys
  const [app] = await db.select().from(schema.apps).where(eq(schema.apps.id, appId)).limit(1);

  // 3. Resolve Pimlico credentials
  const evmTx = tx as unknown as EvmTransaction;
  const pimlicoApiKey =
    evmTx.pimlicoApiKey || (app?.pimlicoApiKey ? decrypt(app.pimlicoApiKey) : '') || process.env.PIMLICO_API_KEY || '';

  // A bundler URL from the sync request body replaces the Pimlico endpoint, so it passes the same
  // outbound check as an App RPC override. A rejected one falls back to Pimlico.
  const clientBundlerUrl =
    evmTx.bundlerUrl && (await isUsableRpcUrl(evmTx.bundlerUrl, '[PIMLICO TRACKER]', 'Client Bundler'))
      ? evmTx.bundlerUrl
      : undefined;

  const bundlerUrl = createPimlicoRpcUrl({
    chainId,
    apiKey: pimlicoApiKey || undefined,
    bundlerUrl: clientBundlerUrl,
  });

  // 4. Collect all available EVM RPCs for on-chain stage in priority order
  const rpcUrls: string[] = [];
  const sources: string[] = [];

  // A. App-specific Chain Overwrites
  const appConfigs = await db
    .select({ rpcUrl: schema.appsRpcConfigs.rpcUrl })
    .from(schema.appsRpcConfigs)
    .where(and(eq(schema.appsRpcConfigs.parentId, appId), eq(schema.appsRpcConfigs.chainId, chainId.toString())));

  for (const c of appConfigs) {
    const url = decrypt(c.rpcUrl);
    if (await isUsableRpcUrl(url, '[PIMLICO TRACKER]', 'App Overwrite')) {
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

  // C. App-specific QuickNode
  if (app?.quickNodeApiKey && app?.quickNodeAppName) {
    const decryptedQuickNodeKey = decrypt(app.quickNodeApiKey);
    const url = decryptedQuickNodeKey.startsWith('http')
      ? decryptedQuickNodeKey
      : `https://${app.quickNodeAppName}.quiknode.pro/${decryptedQuickNodeKey}/`;
    if (await isUsableRpcUrl(url, '[PIMLICO TRACKER]', 'App QuickNode')) {
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

  // E. Public RPC Fallback
  if (viemChain.rpcUrls.default.http[0]) {
    rpcUrls.push(viemChain.rpcUrls.default.http[0]);
    sources.push('Public Fallback');
  }

  if (rpcUrls.length === 0) {
    throw new Error(`[PIMLICO TRACKER] No valid RPC URLs found for chain ${chainId}`);
  }

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

  /**
   * Stage 2: EVM On-Chain Finality Tracking
   * Tracks block confirmations for the mined transaction hash.
   */
  const runStage2 = async (minedHash: Hex): Promise<void> => {
    console.log(`[PIMLICO TRACKER] Stage 2 starting for ${tx.txKey} with mined hash ${minedHash}`);

    await evmTracker({
      tx: {
        txKey: minedHash,
        chainId,
        requiredConfirmations: tx.requiredConfirmations ? Number(tx.requiredConfirmations) : undefined,
      },
      config,
      waitForTransactionReceiptParams: {
        hash: minedHash,
        retryCount: 36,
        timeout: 180_000,
      },
      onInitialize: () => {
        console.log(`[PIMLICO TRACKER] Stage 2 initialized for ${tx.txKey} on chain ${chainId}`);
      },
      onTxDetailsFetched: (details) => {
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
        await redis.set(redisKey, confirmations.toString(), 'EX', 3600);
        console.debug(`[PIMLICO TRACKER] Confirmations update for ${tx.txKey}: ${confirmations}`);
      },
      onSuccess: async (_details, receipt, client) => {
        try {
          const block = await getBlock(client, { blockNumber: receipt.blockNumber });
          const timestamp = Number(block.timestamp);
          const isSuccess = receipt.status === 'success';
          const status = isSuccess ? TransactionStatus.Success : TransactionStatus.Failed;
          console.log(`[PIMLICO TRACKER] ${isSuccess ? 'SUCCESS' : 'REVERTED'}: ${tx.txKey} (${minedHash})`);

          const redisConf = await redis.get(redisKey);
          const confirmations = redisConf ? parseInt(redisConf, 10) : undefined;

          const lagMs = Math.max(0, Date.now() - timestamp * 1000);
          const lagSeconds = lagMs / 1000;

          lagGauge.set({ ecosystem: 'ERC4337', chainId: String(chainId) }, lagSeconds);
          txCounter.inc({ ecosystem: 'ERC4337', chainId: String(chainId), status });
          if (!isSuccess) {
            errorCounter.inc({ ecosystem: 'ERC4337', chainId: String(chainId) });
          }

          await updateDbTx(
            tx.txKey,
            {
              ...fetchedDetails,
              hash: minedHash,
              status,
              pending: false,
              isError: !isSuccess,
              finishedTimestamp: timestamp,
              confirmations,
            },
            true,
          );

          await redis.del(redisKey);
          await onTerminalState(status);
        } catch (err) {
          console.error('[PIMLICO TRACKER] onSuccess execution error:', tx.txKey, err);
        }
      },
      onReplaced: async (replacement) => {
        console.log(`[PIMLICO TRACKER] REPLACED: ${tx.txKey} -> ${replacement.transaction.hash}`);
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
        await redis.del(redisKey);

        txCounter.inc({
          ecosystem: 'ERC4337',
          chainId: String(chainId),
          status: TransactionStatus.Replaced,
        });
        await onTerminalState(TransactionStatus.Replaced);
      },
      onFailure: async (error) => {
        console.error('[PIMLICO TRACKER] FAILED Stage 2:', tx.txKey, error);
        txCounter.inc({
          ecosystem: 'ERC4337',
          chainId: String(chainId),
          status: TransactionStatus.Failed,
        });
        errorCounter.inc({ ecosystem: 'ERC4337', chainId: String(chainId) });

        const redisConf = await redis.get(redisKey);
        const confirmations = redisConf ? parseInt(redisConf, 10) : undefined;

        await updateDbTx(
          tx.txKey,
          {
            ...fetchedDetails,
            hash: minedHash,
            status: TransactionStatus.Failed,
            pending: false,
            isError: true,
            error: normalizeError(error),
            confirmations,
          },
          true,
        );

        await redis.del(redisKey);
        await onTerminalState(TransactionStatus.Failed);
      },
    });
  };

  /**
   * Stage 1: Bundler Mempool Tracking
   * Polls eth_getUserOperationReceipt on the Pimlico endpoint.
   */
  const runStage1 = async (): Promise<void> => {
    console.log(`[PIMLICO TRACKER] Stage 1: Starting mempool polling for ${tx.txKey} on chain ${chainId}`);

    await new Promise<void>((resolve, reject) => {
      erc4337Tracker({
        tx: {
          ...tx,
          txKey: tx.txKey,
          chainId,
          pimlicoApiKey,
          bundlerUrl,
        },
        onSuccess: async (result) => {
          try {
            console.log(`[PIMLICO TRACKER] UserOperation bundled: ${tx.txKey} -> ${result.hash}`);
            if (result.hash) {
              await updateDbTx(tx.txKey, { hash: result.hash });
              await runStage2(result.hash);
            } else {
              // Terminal success if receipt exists but hash is unavailable
              lagGauge.set({ ecosystem: 'ERC4337', chainId: String(chainId) }, 0);
              txCounter.inc({ ecosystem: 'ERC4337', chainId: String(chainId), status: TransactionStatus.Success });
              await updateDbTx(
                tx.txKey,
                {
                  status: TransactionStatus.Success,
                  pending: false,
                  isError: false,
                  finishedTimestamp: Math.floor(Date.now() / 1000),
                },
                true,
              );
              await onTerminalState(TransactionStatus.Success);
            }
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        onFailure: async (result) => {
          try {
            const errorMessage = result?.reason || 'UserOperation failed or reverted.';
            console.error('[PIMLICO TRACKER] UserOperation FAILED:', tx.txKey, errorMessage);

            txCounter.inc({ ecosystem: 'ERC4337', chainId: String(chainId), status: TransactionStatus.Failed });
            errorCounter.inc({ ecosystem: 'ERC4337', chainId: String(chainId) });

            const err = new Error(errorMessage);
            await updateDbTx(
              tx.txKey,
              {
                status: TransactionStatus.Failed,
                pending: false,
                isError: true,
                hash: result?.hash,
                error: normalizeError(err),
                finishedTimestamp: Math.floor(Date.now() / 1000),
              },
              true,
            );
            await onTerminalState(TransactionStatus.Failed);
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        onIntervalTick: (result) => {
          console.debug(`[PIMLICO TRACKER] Polling tick for ${tx.txKey}: status=${result.status}`);
        },
      });
    });
  };

  // Execution flow: resume directly at Stage 2 if on-chain transaction hash is already known
  const existingHash = (tx as unknown as { hash?: string }).hash;
  if (existingHash && isHex(existingHash)) {
    console.log(`[PIMLICO TRACKER] Resuming Stage 2 with existing hash: ${existingHash}`);
    await runStage2(existingHash as Hex);
  } else {
    await runStage1();
  }
}
