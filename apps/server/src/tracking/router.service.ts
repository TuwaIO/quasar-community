import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SolanaTransaction, TransactionStatus, TransactionTracker } from '@tuwaio/pulsar-core';
import { Transaction } from '@tuwaio/quasar-sdk';
import { CHAIN_FINALITY_CONFIRMATIONS, DEFAULT_FINALITY_CONFIRMATIONS } from '@tuwaio/shared/constants';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis, { Cluster } from 'ioredis';
import { Counter, Gauge } from 'prom-client';
import { Chain, createPublicClient, decodeFunctionData, erc20Abi, fallback, Hex, http, parseEventLogs } from 'viem';
import * as chains from 'viem/chains';

import {
  getAlchemyKey,
  PULSAR_ACTIVE_TRACKERS_METRIC,
  PULSAR_SYNC_LAG_METRIC,
  PULSAR_TX_COUNT_METRIC,
  PULSAR_TX_ERROR_METRIC,
} from '../constants';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema/index';
import { alchemyNetworkMap } from '../lib/generated/alchemyNetworkMap';
import { REDIS } from '../redis/redis.module';
import { processEvmTx } from './trackers/evm';
import { processGelatoTx } from './trackers/gelato';
import { processPimlicoTx } from './trackers/pimlico';
import { processSafeTx } from './trackers/safe';
import { processSolanaTx } from './trackers/solana';
import { TrackingService } from './tracking.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

@Injectable()
export class RouterService implements OnModuleInit {
  private readonly logger = new Logger(RouterService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis | Cluster,
    private readonly trackingService: TrackingService,
    private readonly webhookDispatcher: WebhookDispatcherService,
    @InjectMetric(PULSAR_SYNC_LAG_METRIC) private readonly lagGauge: Gauge<string>,
    @InjectMetric(PULSAR_TX_COUNT_METRIC) private readonly txCounter: Counter<string>,
    @InjectMetric(PULSAR_TX_ERROR_METRIC) private readonly errorCounter: Counter<string>,
    @InjectMetric(PULSAR_ACTIVE_TRACKERS_METRIC) private readonly activeTrackersGauge: Gauge<string>,
  ) {}

  onModuleInit() {
    this.activeTrackersGauge.set(0);
  }

  async checkAndInitializeTrackerInWorker(appId: string, txKey: string): Promise<void> {
    try {
      const tx = await this.trackingService.fetchDbTxInternal(appId, txKey);

      if (!tx) {
        throw new Error(`Transaction ${txKey} not found in DB yet (Race condition) for app ${appId}.`);
      }

      const ownerId = tx.ownerId; // Correctly get ownerId from the fetched transaction

      if (
        !tx.pending ||
        tx.status === TransactionStatus.Success ||
        tx.status === TransactionStatus.Failed ||
        tx.status === TransactionStatus.Replaced
      ) {
        this.logger.log(`[ROUTER] Transaction ${txKey} already confirmed by Fast Phase. Lazy fallback unnecessary.`);
        return;
      }

      // Bind updateDbTx with captured ownerId and appId for safer injection into trackers
      const updateDbTx = (txK: string, data: any, isTerminal?: boolean) =>
        this.trackingService.updateDbTx(appId, txK, ownerId, data, isTerminal);

      const handleTerminalState = async (status: TransactionStatus): Promise<void> => {
        await this.webhookDispatcher.dispatchTerminalWebhook(tx, status);
        this.activeTrackersGauge.dec();

        if (tx.appInvoiceId) {
          const invoiceStatus =
            status === TransactionStatus.Success
              ? 'paid'
              : status === TransactionStatus.Failed || status === TransactionStatus.Replaced
                ? 'failed'
                : null;

          if (invoiceStatus) {
            const [invoiceData] = await this.db
              .select({
                invoice: schema.appInvoices,
                payment: schema.appAcceptedPayments,
              })
              .from(schema.appInvoices)
              .innerJoin(
                schema.appAcceptedPayments,
                eq(schema.appInvoices.acceptedPaymentId, schema.appAcceptedPayments.id),
              )
              .where(
                and(
                  eq(schema.appInvoices.id, tx.appInvoiceId),
                  eq(schema.appInvoices.appId, appId),
                  eq(schema.appInvoices.organizationId, ownerId),
                ),
              )
              .limit(1);

            if (!invoiceData) {
              this.logger.error(
                `[ROUTER] AppInvoice ${tx.appInvoiceId} (App: ${appId}, Owner: ${ownerId}) not found. Skipping status update.`,
              );
              return;
            }

            const { invoice, payment } = invoiceData;

            if (invoice.status === 'paid') {
              this.logger.log(`[ROUTER] AppInvoice ${tx.appInvoiceId} is already paid. Skipping.`);
              return;
            }

            const isEvmTracker =
              tx.tracker === TransactionTracker.Ethereum ||
              tx.tracker === TransactionTracker.Safe ||
              tx.tracker === TransactionTracker.Gelato ||
              tx.tracker === TransactionTracker.ERC4337;

            let originWallet: string | undefined;
            if (invoiceStatus === 'paid' && isEvmTracker) {
              const chainId = Number(payment.chainId);
              const expectedAmount = BigInt(invoice.cryptoAmountExpected);
              const recipientAddress = payment.walletAddressToReceivePayment.toLowerCase();
              const tokenAddress = payment.tokenAddress.toLowerCase();
              const isNative =
                tokenAddress === 'native' ||
                tokenAddress === '0x0000000000000000000000000000000000000000' ||
                tokenAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

              const client = this.getPublicClient(chainId);
              let receipt;
              let transaction;
              try {
                receipt = await client.getTransactionReceipt({ hash: txKey as Hex });
                transaction = await client.getTransaction({ hash: txKey as Hex });
              } catch (err) {
                this.logger.error(`[ROUTER] Failed to fetch receipt/tx for ${txKey} on chain ${chainId}: ${err}`);
                throw new Error(`On-chain transaction verification failed: could not fetch tx details`, { cause: err });
              }

              if (!receipt || receipt.status !== 'success') {
                this.logger.error(`[ROUTER] Transaction ${txKey} failed or reverted on chain ${chainId}`);
                throw new Error(`On-chain transaction failed or reverted`);
              }

              const currentBlock = await client.getBlockNumber();
              const confirmations = currentBlock - receipt.blockNumber + 1n;
              const requiredConfirmations = CHAIN_FINALITY_CONFIRMATIONS[chainId] ?? DEFAULT_FINALITY_CONFIRMATIONS;
              if (confirmations < requiredConfirmations) {
                this.logger.error(
                  `[ROUTER] Transaction ${txKey} has ${confirmations} confirmations, but ${requiredConfirmations} are required on chain ${chainId}`,
                );
                throw new Error(`Transaction has insufficient confirmations`);
              }

              let paymentVerified = false;
              if (isNative) {
                const toMatches = transaction.to?.toLowerCase() === recipientAddress;
                const amountMatches = transaction.value >= expectedAmount;
                if (toMatches && amountMatches) {
                  paymentVerified = true;
                } else {
                  this.logger.error(
                    `[ROUTER] Native payment mismatch: to=${transaction.to} (expected ${recipientAddress}), ` +
                      `value=${transaction.value} (expected >= ${expectedAmount})`,
                  );
                }
              } else {
                try {
                  const transferLogs = parseEventLogs({
                    abi: erc20Abi,
                    eventName: 'Transfer',
                    logs: receipt.logs,
                  });
                  const found = transferLogs.some(
                    (log) =>
                      log.address.toLowerCase() === tokenAddress &&
                      log.args.to.toLowerCase() === recipientAddress &&
                      log.args.value >= expectedAmount,
                  );
                  if (found) {
                    paymentVerified = true;
                  }
                } catch (e) {
                  this.logger.debug(`[ROUTER] Error parsing event logs: ${e}`);
                }

                if (!paymentVerified) {
                  try {
                    if (transaction.to?.toLowerCase() === tokenAddress) {
                      const decoded = decodeFunctionData({
                        abi: erc20Abi,
                        data: transaction.input,
                      });
                      if (decoded.functionName === 'transfer') {
                        const [toAddress, amount] = decoded.args;
                        if (toAddress.toLowerCase() === recipientAddress && amount >= expectedAmount) {
                          paymentVerified = true;
                        }
                      }
                    }
                  } catch (e) {
                    this.logger.debug(`[ROUTER] Error decoding function data: ${e}`);
                  }
                }

                if (!paymentVerified) {
                  this.logger.error(
                    `[ROUTER] ERC20 payment mismatch: token=${tokenAddress}, recipient=${recipientAddress}, ` +
                      `expected >= ${expectedAmount}`,
                  );
                }
              }

              if (!paymentVerified) {
                throw new Error(`On-chain payment verification failed: amount, recipient, or token mismatch.`);
              }

              originWallet = transaction.from || receipt.from;
            }

            this.logger.log(
              `[ROUTER] Updating AppInvoice ${tx.appInvoiceId} status to ${invoiceStatus} for tx ${txKey}`,
            );
            const updatedRows = await this.db
              .update(schema.appInvoices)
              .set({
                status: invoiceStatus,
                ...(invoiceStatus === 'paid' ? { txHash: txKey, originWallet } : {}),
                updatedAt: new Date().toISOString(),
              })
              .where(
                and(
                  eq(schema.appInvoices.id, tx.appInvoiceId),
                  eq(schema.appInvoices.appId, appId),
                  eq(schema.appInvoices.organizationId, ownerId),
                ),
              )
              .returning({ id: schema.appInvoices.id });

            if (updatedRows.length !== 1) {
              throw new Error(`Failed to update AppInvoice: 0 or multiple rows affected`);
            }
          }
        }
      };

      if (!tx.appId) {
        this.logger.error(`[ROUTER] Transaction ${txKey} is missing appId. tracker: ${tx.tracker}`);
        return;
      }

      // Cast to include appId and ownerId to satisfy trackers
      const trackerTx = tx as unknown as Transaction & { appId: string; ownerId: string };

      let trackerLaunched = false;
      try {
        switch (tx.tracker) {
          case TransactionTracker.Ethereum:
            this.activeTrackersGauge.inc();
            trackerLaunched = true;
            await processEvmTx(
              trackerTx,
              handleTerminalState,
              updateDbTx,
              this.db,
              this.redis,
              this.lagGauge,
              this.txCounter,
              this.errorCounter,
            );
            break;
          case TransactionTracker.Gelato:
            this.activeTrackersGauge.inc();
            trackerLaunched = true;
            await processGelatoTx(
              trackerTx,
              handleTerminalState,
              updateDbTx,
              this.db,
              this.lagGauge,
              this.txCounter,
              this.errorCounter,
            );
            break;
          case TransactionTracker.Safe:
            this.activeTrackersGauge.inc();
            trackerLaunched = true;
            await processSafeTx(
              trackerTx,
              handleTerminalState,
              updateDbTx,
              this.lagGauge,
              this.txCounter,
              this.errorCounter,
            );
            break;
          case TransactionTracker.Solana:
            this.activeTrackersGauge.inc();
            trackerLaunched = true;
            await processSolanaTx(
              trackerTx as unknown as SolanaTransaction & { appId: string; ownerId: string },
              handleTerminalState,
              updateDbTx,
              this.db,
              this.lagGauge,
              this.txCounter,
              this.errorCounter,
            );
            break;
          case TransactionTracker.ERC4337:
            this.activeTrackersGauge.inc();
            trackerLaunched = true;
            await processPimlicoTx(
              trackerTx,
              handleTerminalState,
              updateDbTx,
              this.db,
              this.redis,
              this.lagGauge,
              this.txCounter,
              this.errorCounter,
            );
            break;
          default:
            this.logger.warn(`[ROUTER] Unknown tracker type: ${tx.tracker} for tx ${txKey}`);
        }
      } catch (error) {
        if (trackerLaunched) {
          this.activeTrackersGauge.dec();
        }
        this.errorCounter.inc({
          ecosystem:
            tx.tracker === TransactionTracker.Ethereum
              ? 'EVM'
              : tx.tracker === TransactionTracker.Solana
                ? 'Solana'
                : tx.tracker === TransactionTracker.Safe
                  ? 'Safe'
                  : tx.tracker === TransactionTracker.Gelato
                    ? 'Gelato'
                    : tx.tracker === TransactionTracker.ERC4337
                      ? 'ERC4337'
                      : 'Unknown',
          chainId: String(tx.chainId || 'unknown'),
          appId: tx.appId || 'unknown',
        });
        this.logger.error(`[ROUTER] Critical error processing tx ${txKey}:`, error);
        throw error;
      }
    } catch (error) {
      this.logger.error(`[ROUTER] Root critical error for tx ${txKey}:`, error);
      throw error;
    }
  }

  private getPublicClient(chainId: number) {
    const viemChain = Object.values(chains).find((c) => (c as Chain).id === chainId) as Chain;
    if (!viemChain) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const rpcUrls: string[] = [];
    const systemAlchemyKey = getAlchemyKey();
    const alchemyNetwork = alchemyNetworkMap[chainId];
    if (systemAlchemyKey && alchemyNetwork) {
      rpcUrls.push(`https://${alchemyNetwork}.g.alchemy.com/v2/${systemAlchemyKey}`);
    }
    if (viemChain.rpcUrls.default.http[0]) {
      rpcUrls.push(viemChain.rpcUrls.default.http[0]);
    }
    if (rpcUrls.length === 0) {
      throw new Error(`No RPC URLs found for chain ${chainId}`);
    }

    return createPublicClient({
      chain: viemChain,
      transport: fallback(rpcUrls.map((url) => http(url, { batch: true }))),
    });
  }
}
