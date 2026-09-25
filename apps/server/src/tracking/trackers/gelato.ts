import { normalizeError } from '@tuwaio/orbit-core';
import { initializePollingTracker, TransactionStatus } from '@tuwaio/pulsar-core';
import { createGelatoClient, gelatoFetcher, GelatoStatusCode } from '@tuwaio/pulsar-evm';
import { UpdatableTransactionFields } from '@tuwaio/quasar-sdk';
import { Transaction } from '@tuwaio/quasar-sdk';
import { decrypt } from '@tuwaio/shared/encryption';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Counter, Gauge } from 'prom-client';
import { Hex } from 'viem';

import * as schema from '../../database/schema/index';

type UpdateFn = (txKey: string, data: UpdatableTransactionFields, isTerminal?: boolean) => Promise<void>;

export async function processGelatoTx(
  tx: Transaction & { appId: string; ownerId: string },
  onTerminalState: (status: TransactionStatus) => Promise<void>,
  updateDbTx: UpdateFn,
  db: NodePgDatabase<typeof schema>,
  lagGauge: Gauge<string>,
  txCounter: Counter<string>,
  errorCounter: Counter<string>,
) {
  const appId = tx.appId;
  const [app] = await db.select().from(schema.apps).where(eq(schema.apps.id, appId)).limit(1);

  const GELATO_API_KEY = decrypt(app?.gelatoApiKey) || process.env.GELATO_API_KEY || '';
  console.log(`[GELATO TRACKER] Starting for ${tx.txKey}`);
  if (!tx.txKey) {
    console.error(`[GELATO TRACKER] Missing txKey for tracking.`);
    return;
  }
  const client = createGelatoClient({ apiKey: GELATO_API_KEY });
  const fetcher = gelatoFetcher(client);
  initializePollingTracker({
    tx,
    fetcher,
    removeTxFromPool: (txKey) => {
      console.log(`[GELATO TRACKER] Polling stopped for ${txKey}`);
    },
    onInitialize: () => {
      console.log(`[GELATO TRACKER] Initializing for ${tx.txKey}`);
    },
    onSuccess: async (response) => {
      const hash = response.status === GelatoStatusCode.Success ? response.receipt.transactionHash : undefined;
      console.log(`[GELATO TRACKER] SUCCESS: ${tx.txKey}`);
      // Record metrics
      lagGauge.set({ ecosystem: 'Gelato', chainId: String(tx.chainId) }, 0);
      txCounter.inc({
        ecosystem: 'Gelato',
        chainId: String(tx.chainId),
        status: TransactionStatus.Success,
      });
      await updateDbTx(
        tx.txKey,
        {
          status: TransactionStatus.Success,
          pending: false,
          isError: false,
          hash,
          finishedTimestamp: Math.floor(Date.now() / 1000),
        },
        true,
      );
      await onTerminalState(TransactionStatus.Success);
    },
    onIntervalTick: (response) => {
      // Intermediate status updates (e.g. Submitted hash) are no longer written to Postgres to save IOPS.
      // The final transaction hash will be captured in the onSuccess or onFailure terminal state.
      console.debug(`[GELATO TRACKER] Tick for ${tx.txKey}: status=${response.status}`);
    },
    onFailure: async (response) => {
      let errorMessage = 'Transaction failed or was not found.';
      let hash: Hex | undefined;
      if (response) {
        if (response.status === GelatoStatusCode.Rejected) {
          errorMessage = response.message || 'Transaction was rejected by Gelato Relay.';
        } else if (response.status === GelatoStatusCode.Reverted) {
          errorMessage = response.message || 'Transaction reverted on-chain.';
          hash = response.receipt.transactionHash;
        }
      }
      const errString = errorMessage.toLowerCase();
      if (errString.includes('429') || errString.includes('too many requests')) {
        console.log(`[Business Metric] BYO-RPC Rate Limit Exceeded | AppID: ${appId} | ChainID: ${tx.chainId}`);
      }
      console.error('[GELATO TRACKER] FAILED:', tx.txKey, errorMessage);
      txCounter.inc({
        ecosystem: 'Gelato',
        chainId: String(tx.chainId),
        status: TransactionStatus.Failed,
      });
      errorCounter.inc({ ecosystem: 'Gelato', chainId: String(tx.chainId) });
      const err = new Error(errorMessage);
      await updateDbTx(
        tx.txKey,
        {
          status: TransactionStatus.Failed,
          pending: false,
          isError: true,
          hash,
          error: normalizeError(err),
          finishedTimestamp: Math.floor(Date.now() / 1000),
        },
        true,
      );
      await onTerminalState(TransactionStatus.Failed);
    },
  });
}
