import { normalizeError, OrbitAdapter } from '@tuwaio/orbit-core';
import { initializePollingTracker, TransactionStatus } from '@tuwaio/pulsar-core';
import { safeFetcher } from '@tuwaio/pulsar-evm';
import { UpdatableTransactionFields } from '@tuwaio/quasar-sdk';
import { Transaction } from '@tuwaio/quasar-sdk';
import { Counter, Gauge } from 'prom-client';
import { Hex, zeroHash } from 'viem';

type UpdateFn = (txKey: string, data: UpdatableTransactionFields, isTerminal?: boolean) => Promise<void>;

export async function processSafeTx(
  tx: Transaction & { appId: string; ownerId: string },
  onTerminalState: (status: TransactionStatus) => Promise<void>,
  updateDbTx: UpdateFn,
  lagGauge: Gauge<string>,
  txCounter: Counter<string>,
  errorCounter: Counter<string>,
) {
  console.log(`[SAFE TRACKER] Starting for ${tx.txKey}`);
  if (!tx.txKey) {
    console.error(`[SAFE TRACKER] Missing txKey for tracking.`);
    return;
  }
  initializePollingTracker({
    tx,
    fetcher: safeFetcher,
    removeTxFromPool: (txKey) => {
      console.log(`[SAFE TRACKER] Polling stopped for ${txKey}`);
    },
    onInitialize: () => {
      console.log(`[SAFE TRACKER] Initializing for ${tx.txKey}`);
    },
    onSuccess: async (response) => {
      console.log(`[SAFE TRACKER] SUCCESS: ${tx.txKey}`);
      const executionTime = response.executionDate ? new Date(response.executionDate).getTime() : Date.now();
      const lagMs = Math.max(0, Date.now() - executionTime);
      const lagSeconds = lagMs / 1000;
      // Record metrics
      lagGauge.set({ ecosystem: 'Safe', chainId: String(tx.chainId) }, lagSeconds);
      txCounter.inc({
        ecosystem: 'Safe',
        chainId: String(tx.chainId),
        status: TransactionStatus.Success,
      });
      await updateDbTx(
        tx.txKey,
        {
          status: TransactionStatus.Success,
          pending: false,
          isError: false,
          hash: response.transactionHash ?? undefined,
          finishedTimestamp: response.executionDate
            ? Math.floor(new Date(response.executionDate).getTime() / 1000)
            : Math.floor(Date.now() / 1000),
        },
        true,
      );
      await onTerminalState(TransactionStatus.Success);
    },
    onIntervalTick: (response) => {
      // Intermediate updates (e.g. proposed safeTxHash) are no longer written to Postgres to save IOPS.
      // The final transaction hash will be captured in the onSuccess or onFailure terminal state.
      console.debug(`[SAFE TRACKER] Tick for ${tx.txKey}: hash=${response.transactionHash}`);
    },
    onFailure: async (response) => {
      const errorMessage = response ? 'Safe transaction failed or was rejected.' : 'Transaction not found.';

      const errString = errorMessage.toLowerCase();
      if (errString.includes('429') || errString.includes('too many requests')) {
        console.log(`[Business Metric] BYO-RPC Rate Limit Exceeded | AppID: ${tx.appId} | ChainID: ${tx.chainId}`);
      }

      console.error('[SAFE TRACKER] FAILED:', tx.txKey, errorMessage);
      txCounter.inc({
        ecosystem: 'Safe',
        chainId: String(tx.chainId),
        status: TransactionStatus.Failed,
      });
      errorCounter.inc({ ecosystem: 'Safe', chainId: String(tx.chainId) });
      const err = new Error(errorMessage);
      await updateDbTx(
        tx.txKey,
        {
          status: TransactionStatus.Failed,
          pending: false,
          isError: true,
          hash: response?.transactionHash ?? undefined,
          error: normalizeError(err),
          finishedTimestamp: response?.executionDate
            ? Math.floor(new Date(response.executionDate).getTime() / 1000)
            : Math.floor(Date.now() / 1000),
        },
        true,
      );
      await onTerminalState(TransactionStatus.Failed);
    },
    onReplaced: async (response) => {
      console.log(`[SAFE TRACKER] REPLACED: ${tx.txKey} -> ${response.safeTxHash}`);
      await updateDbTx(
        tx.txKey,
        {
          status: TransactionStatus.Replaced,
          pending: false,
          hash: tx.adapter === OrbitAdapter.EVM ? (tx.hash as Hex) : zeroHash,
          replacedTxHash: response.safeTxHash ?? zeroHash,
          finishedTimestamp: response.executionDate
            ? Math.floor(new Date(response.executionDate).getTime() / 1000)
            : Math.floor(Date.now() / 1000),
        },
        true,
      );
      txCounter.inc({
        ecosystem: 'Safe',
        chainId: String(tx.chainId),
        status: TransactionStatus.Replaced,
      });
      await onTerminalState(TransactionStatus.Replaced);
    },
  });
}
