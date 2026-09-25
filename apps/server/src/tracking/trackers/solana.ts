import { normalizeError } from '@tuwaio/orbit-core';
import { initializePollingTracker, SolanaTransaction, TransactionStatus } from '@tuwaio/pulsar-core';
import { solanaFetcher } from '@tuwaio/pulsar-solana';
import { UpdatableTransactionFields } from '@tuwaio/quasar-sdk';
import { decrypt } from '@tuwaio/shared/encryption';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Counter, Gauge } from 'prom-client';

import { getAlchemyKey } from '../../constants';
import * as schema from '../../database/schema/index';
import { alchemyNetworkMap } from '../../lib/generated/alchemyNetworkMap';

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
    .where(and(eq(schema.appsRpcConfigs.parentId, appId), eq(schema.appsRpcConfigs.chainId, chainId)));

  appConfigs.forEach((c) => {
    rpcUrls.push(decrypt(c.rpcUrl));
    sources.push('App Overwrite');
  });

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
    rpcUrls.push(url);
    sources.push('App QuickNode');
  }

  // D. Client-side Hint (The RPC that actually produced the tx)
  if (tx.rpcUrl) {
    rpcUrls.push(tx.rpcUrl);
    sources.push('Client Hint');
  }

  // E. System Alchemy Fallback
  const systemAlchemyKey = getAlchemyKey();
  if (systemAlchemyKey && alchemyNetwork) {
    rpcUrls.push(`https://${alchemyNetwork}.g.alchemy.com/v2/${systemAlchemyKey}`);
    sources.push('System Alchemy');
  }

  // F. Public Fallback
  if (chainId === 'solana:mainnet') {
    rpcUrls.push('https://api.mainnet-beta.solana.com');
    sources.push('Public Fallback');
  } else if (chainId === 'solana:devnet') {
    rpcUrls.push('https://api.devnet.solana.com');
    sources.push('Public Fallback');
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

  initializePollingTracker({
    tx: {
      ...tx,
      rpcUrl,
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
        },
        true,
      );
      await onTerminalState(TransactionStatus.Success);
    },
    onIntervalTick: (response) => {
      // Intermediate polling data (slots/confirmations) are no longer written to Postgres to save IOPS.
      // These fields will be captured in the final onSuccess/onFailure state.
      console.debug(`[SOLANA TRACKER] Tick for ${tx.txKey}: slot=${response.slot}, conf=${response.confirmations}`);
    },
    onFailure: async (response) => {
      console.error(`[SOLANA TRACKER] FAILED: ${tx.txKey}`);
      txCounter.inc({
        ecosystem: 'Solana',
        chainId: String(chainId),
        status: TransactionStatus.Failed,
      });
      errorCounter.inc({ ecosystem: 'Solana', chainId: String(chainId) });
      const err = response?.err ?? new Error('Transaction tracking timed out or the transaction was not found.');

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
