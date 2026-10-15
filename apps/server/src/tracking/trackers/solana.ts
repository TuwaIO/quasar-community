import { normalizeError } from '@tuwaio/orbit-core';
import { initializePollingTracker, SolanaTransaction, TransactionStatus } from '@tuwaio/pulsar-core';
import { solanaFetcher } from '@tuwaio/pulsar-solana';
import { UpdatableTransactionFields } from '@tuwaio/quasar-sdk';
import { decrypt } from '@tuwaio/shared/encryption';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Counter, Gauge } from 'prom-client';

import { isPublicRpcFallbackEnabled } from '../../common/provider-policy';
import { getAlchemyKey } from '../../constants';
import * as schema from '../../database/schema/index';
import { alchemyNetworkMap } from '../../lib/generated/alchemyNetworkMap';
import { solanaChainIdAliases, solanaClusterOf } from '../../lib/solana-chain';
import { isUsableRpcUrl } from './rpc-guard';

type UpdateFn = (txKey: string, data: UpdatableTransactionFields, isTerminal?: boolean) => Promise<void>;

export async function processSolanaTx(
  tx: SolanaTransaction & { appId: string; ownerId: string },
  onTerminalState: (status: TransactionStatus) => Promise<void>,
  updateDbTx: UpdateFn,
  db: NodePgDatabase<typeof schema>,
  lagGauge: Gauge<string>,
  txCounter: Counter<string>,
  errorCounter: Counter<string>,
) {
  const appId = tx.appId;
  const chainId = tx.chainId as string;
  // The moniker (`solana:devnet`) and the CAIP-2 ID (`solana:EtWT…`) name the same cluster
  const chainIdAliases = solanaChainIdAliases(chainId);
  const cluster = solanaClusterOf(chainId);

  if (!appId) {
    throw new Error(`[SOLANA TRACKER] Missing appId for tx ${tx.txKey}. BYO-RPC requires appId.`);
  }

  // 1. Fetch App details for custom provider keys
  const [app] = await db.select().from(schema.apps).where(eq(schema.apps.id, appId)).limit(1);

  // 2. Collect all available RPCs in priority order
  const rpcUrls: string[] = [];
  const sources: string[] = [];

  // A. App-specific Chain Overwrites
  const appConfigs = await db
    .select({ rpcUrl: schema.appsRpcConfigs.rpcUrl })
    .from(schema.appsRpcConfigs)
    .where(and(eq(schema.appsRpcConfigs.parentId, appId), inArray(schema.appsRpcConfigs.chainId, chainIdAliases)));

  for (const c of appConfigs) {
    const url = decrypt(c.rpcUrl);
    if (await isUsableRpcUrl(url, '[SOLANA TRACKER]', 'App Overwrite')) {
      rpcUrls.push(url);
      sources.push('App Overwrite');
    }
  }

  // B. App-specific Alchemy
  const alchemyNetwork = alchemyNetworkMap[chainIdAliases[0]];
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
    if (await isUsableRpcUrl(url, '[SOLANA TRACKER]', 'App QuickNode')) {
      rpcUrls.push(url);
      sources.push('App QuickNode');
    }
  }

  // `tx.rpcUrl` from the sync request is deliberately not used: any API key holder could point
  // the worker at an arbitrary host with it. It stays on the transaction record as metadata.

  // D. System Alchemy Fallback
  const systemAlchemyKey = getAlchemyKey();
  if (systemAlchemyKey && alchemyNetwork) {
    rpcUrls.push(`https://${alchemyNetwork}.g.alchemy.com/v2/${systemAlchemyKey}`);
    sources.push('System Alchemy');
  }

  // E. Public Fallback, opt-in (common/provider-policy.ts)
  if (isPublicRpcFallbackEnabled()) {
    if (cluster === 'mainnet') {
      rpcUrls.push('https://api.mainnet-beta.solana.com');
      sources.push('Public Fallback');
    } else if (cluster === 'devnet') {
      rpcUrls.push('https://api.devnet.solana.com');
      sources.push('Public Fallback');
    }
  }

  if (rpcUrls.length === 0) {
    throw new Error(`[SOLANA TRACKER] No valid RPC URLs found for chain ${chainId}`);
  }

  // Use the first RPC as primary (In Solana we don't have built-in fallback yet, so we pick the best one)
  const rpcUrl = rpcUrls[0];

  console.log(
    `[SOLANA TRACKER] Initializing with ${rpcUrls.length} providers for ${tx.txKey}. Priority: ${sources.join(' > ')}`,
  );
  console.log(`[SOLANA TRACKER] Starting for ${tx.txKey} using RPC: ...${rpcUrl.slice(-12)}`);

  if (!tx.txKey) {
    console.error(`[SOLANA TRACKER] Missing txKey for tracking.`);
    return;
  }

  // The record keeps numeric text; the fetcher compares block heights as numbers
  const lastValidBlockHeight = tx.lastValidBlockHeight != null ? Number(tx.lastValidBlockHeight) : undefined;
  let confirmedRecorded = tx.confirmationStatus === 'confirmed' || tx.confirmationStatus === 'finalized';

  initializePollingTracker({
    tx: {
      ...tx,
      rpcUrl,
      lastValidBlockHeight,
    } as SolanaTransaction,
    fetcher: solanaFetcher,
    removeTxFromPool: (txKey) => {
      console.log(`[SOLANA TRACKER] Polling stopped for ${txKey}`);
    },
    onInitialize: () => {
      console.log(`[SOLANA TRACKER] Initializing for ${tx.txKey}`);
    },
    onSuccess: async (response) => {
      console.log(`[SOLANA TRACKER] SUCCESS: ${tx.txKey}`);
      // Record metrics
      lagGauge.set({ ecosystem: 'Solana', chainId: String(chainId) }, 0);
      txCounter.inc({
        ecosystem: 'Solana',
        chainId: String(chainId),
        status: TransactionStatus.Success,
      });
      await updateDbTx(
        tx.txKey,
        {
          status: TransactionStatus.Success,
          pending: false,
          isError: false,
          finishedTimestamp: Math.floor(Date.now() / 1000),
          fee: response.fee,
          instructions: response.instructions,
          recentBlockhash: response.recentBlockhash,
          confirmations: 'MAX',
          slot: response.slot,
          confirmationStatus: 'finalized',
        },
        true,
      );
      await onTerminalState(TransactionStatus.Success);
    },
    onIntervalTick: (response) => {
      // Intermediate polling data (slots/confirmations) are not written to Postgres to save IOPS, except once: when a
      // supermajority voted on the transaction (`confirmed`), which UIs show before it is finalized
      console.debug(`[SOLANA TRACKER] Tick for ${tx.txKey}: slot=${response.slot}, conf=${response.confirmations}`);
      if (response.confirmationStatus === 'confirmed' && !confirmedRecorded) {
        confirmedRecorded = true;
        updateDbTx(tx.txKey, { confirmationStatus: 'confirmed', slot: response.slot }).catch((err) =>
          console.error('[SOLANA TRACKER] Could not record the commitment of %s:', tx.txKey, err),
        );
      }
    },
    onFailure: async (response) => {
      console.error(`[SOLANA TRACKER] FAILED: ${tx.txKey}`);
      txCounter.inc({
        ecosystem: 'Solana',
        chainId: String(chainId),
        status: TransactionStatus.Failed,
      });
      errorCounter.inc({ ecosystem: 'Solana', chainId: String(chainId) });
      // An on-chain error fails at once (from `confirmed`); an unknown signature past its last valid block height
      // expired; anything else timed out
      const err =
        response?.err ??
        new Error(
          response?.expired
            ? 'The transaction expired: its blockhash expired before it was processed, so it can no longer land.'
            : 'Transaction tracking timed out or the transaction was not found.',
        );

      const errString = String(err).toLowerCase();
      if (errString.includes('429') || errString.includes('too many requests')) {
        console.log(`[Business Metric] BYO-RPC Rate Limit Exceeded | AppID: ${appId} | ChainID: ${chainId}`);
      }
      await updateDbTx(
        tx.txKey,
        {
          status: TransactionStatus.Failed,
          pending: false,
          isError: true,
          error: normalizeError(err),
          finishedTimestamp: Math.floor(Date.now() / 1000),
        },
        true,
      );
      await onTerminalState(TransactionStatus.Failed);
    },
  });
}
