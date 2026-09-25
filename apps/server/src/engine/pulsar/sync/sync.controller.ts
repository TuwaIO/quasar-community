import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Body, Controller, Inject, Logger, Param, Post, Req, Res } from '@nestjs/common';
import { OrbitAdapter, TuwaErrorState } from '@tuwaio/orbit-core';
import {
  BaseTransaction,
  EvmTransaction,
  PulsarTransactionValidationError,
  SolanaTransaction,
  StarknetTransaction,
  Transaction,
  TransactionStatus,
  TransactionTracker,
  validateTransaction,
} from '@tuwaio/pulsar-core';
import { CHAIN_FINALITY_CONFIRMATIONS, DEFAULT_FINALITY_CONFIRMATIONS } from '@tuwaio/shared/constants';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Queue } from 'bullmq';
import { and, eq, or } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import Redis from 'ioredis';
import { Counter } from 'prom-client';
import { z } from 'zod';

import { PULSAR_TX_COUNT_METRIC } from '../../../constants';
import { DRIZZLE } from '../../../database/database.constants';
import * as schema from '../../../database/schema/index';
import { REDIS } from '../../../redis/redis.constants';
import { TrackingService } from '../../../tracking/tracking.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IronDomeMeta {
  id: string;
  status: 'active' | 'disabled' | 'suspended';
  isRevoked: boolean;
  ipWhitelist: string[];
  domainsWhitelist: string[];
  rpsLimit: number;
  scopes: string[];
  publicKey: string;
  ownerId: string;
  ownerEmail?: string;
  keyLabel?: string;
  warningThreshold?: number;
  secretKey?: string;
  trackMode?: 'fast' | 'lazy' | 'default';
  appKind?: string;
  paymentSettings?: {
    amlEnabled?: boolean;
    goPlusApiKey?: string | null;
    goPlusApiSecret?: string | null;
    appInvoiceTemplate?: unknown;
  } | null;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// --- Enums ---
const TransactionTrackerSchema: z.ZodType<TransactionTracker> = z.enum([
  TransactionTracker.Ethereum,
  TransactionTracker.Safe,
  TransactionTracker.Gelato,
  TransactionTracker.Solana,
  TransactionTracker.ERC4337,
]) as unknown as z.ZodType<TransactionTracker>;

const TransactionStatusSchema: z.ZodType<TransactionStatus> = z.enum([
  TransactionStatus.Failed,
  TransactionStatus.Success,
  TransactionStatus.Replaced,
]) as unknown as z.ZodType<TransactionStatus>;

// --- Error State ---
const ErrorStateSchema: z.ZodType<TuwaErrorState> = z.object({
  message: z.string(),
  raw: z.record(z.string(), z.unknown()),
}) as unknown as z.ZodType<TuwaErrorState>;

const HexStringSchema = z
  .string()
  .startsWith('0x', { message: 'String must start with 0x' })
  .regex(/^0x[a-fA-F0-9]*$/, { message: 'Must be a valid hex string' }) as unknown as z.ZodType<`0x${string}`>;

// --- Base Transaction ---
const BaseTransactionSchema = z.object({
  appName: z.string().optional(),
  chainId: z.union([z.number(), z.string()]),
  confirmations: z.union([z.number(), z.string(), z.null()]).optional(),
  connectorType: z.string(),
  description: z.union([z.string(), z.tuple([z.string(), z.string(), z.string(), z.string()])]).optional(),
  error: ErrorStateSchema.optional(),
  finishedTimestamp: z.number().optional(),
  from: z.string(),
  isError: z.boolean().optional(),
  isTrackedModalOpen: z.boolean().optional(),
  localTimestamp: z.number(),
  payload: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  pending: z.boolean(),
  requiredConfirmations: z.number().optional(),
  rpcUrl: z.string().optional(),
  status: TransactionStatusSchema.optional(),
  title: z.union([z.string(), z.tuple([z.string(), z.string(), z.string(), z.string()])]).optional(),
  tracker: TransactionTrackerSchema,
  txKey: z.string(),
  type: z.string(),
  appInvoiceId: z.string().optional(),
});

// PHANTOM TYPE CHECK: Enforces 1:1 alignment with pulsar-core BaseTransaction

export const _checkBaseTx: z.ZodType<BaseTransaction> = BaseTransactionSchema as unknown as z.ZodType<BaseTransaction>;

// --- EVM Transaction ---
const EvmTransactionSchema = BaseTransactionSchema.extend({
  adapter: z.literal(OrbitAdapter.EVM),
  hash: HexStringSchema.optional(),
  input: HexStringSchema.optional(),
  maxFeePerGas: z.string().optional(),
  maxPriorityFeePerGas: z.string().optional(),
  nonce: z.number().optional(),
  replacedTxHash: HexStringSchema.optional(),
  to: HexStringSchema.optional(),
  value: z.string().optional(),
  bundlerUrl: z.string().optional(),
  pimlicoApiKey: z.string().optional(),
});

// PHANTOM TYPE CHECK: Enforces 1:1 alignment with pulsar-core EvmTransaction

export const _checkEvmTx: z.ZodType<EvmTransaction> = EvmTransactionSchema as unknown as z.ZodType<EvmTransaction>;

// --- Solana Transaction ---
const SolanaTransactionSchema = BaseTransactionSchema.extend({
  adapter: z.literal(OrbitAdapter.SOLANA),
  fee: z.number().optional(),
  instructions: z.array(z.unknown()).optional(),
  recentBlockhash: z.string().optional(),
  slot: z.number().optional(),
});

// PHANTOM TYPE CHECK: Enforces 1:1 alignment with pulsar-core SolanaTransaction

export const _checkSolanaTx: z.ZodType<SolanaTransaction> =
  SolanaTransactionSchema as unknown as z.ZodType<SolanaTransaction>;

// --- Starknet Transaction ---
const StarknetTransactionSchema = BaseTransactionSchema.extend({
  adapter: z.literal(OrbitAdapter.Starknet),
  actualFee: z.object({ amount: z.string(), unit: z.string() }).optional(),
  contractAddress: z.string().optional(),
});

// PHANTOM TYPE CHECK: Enforces 1:1 alignment with pulsar-core StarknetTransaction

export const _checkStarknetTx: z.ZodType<StarknetTransaction> =
  StarknetTransactionSchema as unknown as z.ZodType<StarknetTransaction>;

// --- Unified Transaction (discriminated union) ---
const TransactionSchema = z.discriminatedUnion('adapter', [
  EvmTransactionSchema,
  SolanaTransactionSchema,
  StarknetTransactionSchema,
]);

// ---------------------------------------------------------------------------
// POST /v1/engine/pulsar/sync  —  Create Transaction
// ---------------------------------------------------------------------------

@Controller('v1/engine/pulsar/sync')
export class SyncController {
  constructor(
    @Inject(DRIZZLE) private readonly db: NodePgDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue('{tracking-fast}') private readonly fastQueue: Queue,
    @InjectQueue('{aml-screening}') private readonly amlQueue: Queue,
    @InjectMetric(PULSAR_TX_COUNT_METRIC) private readonly txCounter: Counter<string>,
    private readonly trackingService: TrackingService,
  ) {}

  private readonly logger = new Logger(SyncController.name);

  /**
   * POST /v1/engine/pulsar/sync/retry/:txKey
   *
   * Manually re-triggers tracking for a transaction identified by txKey.
   * Allowed for any transaction state — particularly useful for failed/stuck transactions.
   *
   * Steps:
   * 1. Fetch the transaction from DB, scoped to the authenticated app.
   * 2. Reset the Redis terminal dedup key via TrackingService.
   * 3. Reset the DB record status to Pending.
   * 4. Re-enqueue into {tracking-fast} queue.
   */
  @Post('retry/:txKey')
  async retryTransaction(@Param('txKey') txKey: string, @Req() req: { ironDomeMeta: IronDomeMeta }) {
    const meta = req.ironDomeMeta;

    if (!txKey || txKey.trim() === '') {
      throw new BadRequestException('txKey is required.');
    }

    // 1. Fetch the transaction from DB, scoped to this app & owner
    const [tx] = await this.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.txKey, txKey),
          eq(schema.transactions.appId, meta.id),
          eq(schema.transactions.ownerId, meta.ownerId),
        ),
      )
      .limit(1);

    if (!tx) {
      throw new BadRequestException(`Transaction '${txKey}' not found for this app.`);
    }

    this.logger.log(`[Retry] Re-tracking tx: ${txKey} (appId: ${meta.id}) — previous status: ${tx.status}`);

    // 2. Reset Redis terminal dedup key + evict stale buffer
    await this.trackingService.resetTerminalTx(meta.id, txKey);

    // 3. Reset DB record to Pending state
    await this.db
      .update(schema.transactions)
      .set({
        status: null,
        pending: true,
        isError: false,
        error: null,
        finishedTimestamp: null,
        syncStatus: 'pending-sync',
      })
      .where(
        and(
          eq(schema.transactions.txKey, txKey),
          eq(schema.transactions.appId, meta.id),
          eq(schema.transactions.ownerId, meta.ownerId),
        ),
      );

    // 4. Re-enqueue into fast tracking queue
    // Use a unique job ID with a timestamp suffix to avoid BullMQ dedup collision
    const jobId = `retry-${meta.id}-${txKey}-${Date.now()}`;
    await this.fastQueue.add(
      'process-tx',
      { appId: meta.id, ownerId: meta.ownerId, txKey },
      {
        jobId,
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return { success: true, txKey, message: 'Transaction tracking retry scheduled.' };
  }

  @Post()
  async syncTransaction(
    @Body() body: unknown,
    @Req() req: { ironDomeMeta: IronDomeMeta },
    @Res({ passthrough: true }) res: { status: (code: number) => void },
  ) {
    const meta = req.ironDomeMeta;
    const mode: 'fast' | 'lazy' = meta.trackMode === 'fast' ? 'fast' : 'lazy';

    // 1. Validate input
    const parsed = TransactionSchema.safeParse(body);

    if (!parsed.success) {
      this.logger.error(`[Engine] Validation failed: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
      throw new BadRequestException({
        error: 'Bad Request: Invalid body',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;

    // 2. Security: Pulsar safety limits validation
    try {
      validateTransaction(data as Transaction);
    } catch (err) {
      if (err instanceof PulsarTransactionValidationError) {
        this.logger.error(`[Engine] Safety validation failed for field "${err.field}": ${err.message}`);
        throw new BadRequestException({
          error: 'Bad Request: Safety limits violated',
          field: err.field,
          message: err.message,
        });
      }
      throw err;
    }

    // 3. Idempotency: check if transaction already exists by (ownerId + appId + txKey)
    const lockKey = `lock:sync:${meta.id}:${data.txKey}`;
    const acquired = await this.redis.set(lockKey, '1', 'EX', 5, 'NX');
    if (!acquired) {
      const [existing] = await this.db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.txKey, data.txKey),
            eq(schema.transactions.ownerId, meta.ownerId),
            eq(schema.transactions.appId, meta.id),
          ),
        )
        .limit(1);
      if (existing) {
        const dupStatus = mode === 'fast' ? 200 : 202;
        res.status(dupStatus);
        return { success: true, txKey: existing.txKey, mode, duplicate: true };
      }
      throw new BadRequestException('Transaction sync already in progress.');
    }

    try {
      const [existing] = await this.db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.txKey, data.txKey),
            eq(schema.transactions.ownerId, meta.ownerId),
            eq(schema.transactions.appId, meta.id),
          ),
        )
        .limit(1);

      if (existing) {
        const dupStatus = mode === 'fast' ? 200 : 202;
        res.status(dupStatus);
        return { success: true, txKey: existing.txKey, mode, duplicate: true };
      }

      // 4. Create Transaction — owner is force-stamped from Iron Dome metadata
      // Strip fields not present in DB schema & coerce to plain JSON-compatible types
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { isTrackedModalOpen: _, ...txFields } = data;
      const sanitized = JSON.parse(JSON.stringify(txFields)) as typeof txFields;

      // Find a matching AppInvoice if it's a payments app
      let matchedInvoiceId: string | null = (sanitized as { appInvoiceId?: string | null }).appInvoiceId || null;
      if (matchedInvoiceId) {
        const [matchedInvoice] = await this.db
          .select({ id: schema.appInvoices.id })
          .from(schema.appInvoices)
          .where(
            and(
              eq(schema.appInvoices.id, matchedInvoiceId),
              eq(schema.appInvoices.appId, meta.id),
              eq(schema.appInvoices.organizationId, meta.ownerId),
            ),
          )
          .limit(1);
        if (!matchedInvoice) {
          throw new BadRequestException('Invalid appInvoiceId or unauthorized access.');
        }
      } else if (meta.appKind === 'payments') {
        const orConditions = [eq(schema.appInvoices.id, data.txKey)];
        if ('hash' in sanitized && sanitized.hash) {
          orConditions.push(eq(schema.appInvoices.txHash, sanitized.hash));
        }
        const [matchedInvoice] = await this.db
          .select({ id: schema.appInvoices.id })
          .from(schema.appInvoices)
          .where(and(eq(schema.appInvoices.appId, meta.id), or(...orConditions)))
          .limit(1);
        if (matchedInvoice) {
          matchedInvoiceId = matchedInvoice.id;
        }
      }

      const amlEnabled = meta.appKind === 'payments' && meta.paymentSettings?.amlEnabled === true;
      const initialAmlStatus = amlEnabled ? 'pending' : 'not_applicable';

      try {
        await this.db.insert(schema.transactions).values({
          appId: meta.id ?? null,
          ownerId: meta.ownerId,
          txKey: sanitized.txKey,
          chainId: sanitized.chainId.toString(),
          from: sanitized.from,
          type: sanitized.type,
          connectorType: sanitized.connectorType,
          adapter: sanitized.adapter as (typeof schema.enumTransactionsAdapter.enumValues)[number],
          tracker: sanitized.tracker as (typeof schema.enumTransactionsTracker.enumValues)[number],
          pending: true, // Force initial state to pending
          localTimestamp: String(sanitized.localTimestamp),
          appName: sanitized.appName,
          isError: false, // Initial state is never an error
          finishedTimestamp: null, // Only trackers can set this
          status: null, // Only trackers can set this
          title: sanitized.title ?? null,
          description: sanitized.description ?? null,
          error: null, // Only trackers can set this
          payload: sanitized.payload ?? null,
          // Metadata fields
          confirmations: sanitized.confirmations != null ? String(sanitized.confirmations) : null,
          rpcUrl: sanitized.rpcUrl ?? null,
          requiredConfirmations: String(
            Math.max(
              sanitized.requiredConfirmations != null ? Number(sanitized.requiredConfirmations) : 0,
              Number(CHAIN_FINALITY_CONFIRMATIONS[Number(sanitized.chainId)] ?? DEFAULT_FINALITY_CONFIRMATIONS),
            ),
          ),
          // EVM fields
          ...('hash' in sanitized && { hash: sanitized.hash ?? null }),
          ...('to' in sanitized && { to: sanitized.to ?? null }),
          ...('value' in sanitized && { value: sanitized.value ?? null }),
          ...('input' in sanitized && { input: sanitized.input ?? null }),
          ...('nonce' in sanitized && { nonce: sanitized.nonce != null ? String(sanitized.nonce) : null }),
          ...('maxFeePerGas' in sanitized && { maxFeePerGas: sanitized.maxFeePerGas ?? null }),
          ...('maxPriorityFeePerGas' in sanitized && { maxPriorityFeePerGas: sanitized.maxPriorityFeePerGas ?? null }),
          ...('replacedTxHash' in sanitized && { replacedTxHash: sanitized.replacedTxHash ?? null }),
          ...('bundlerUrl' in sanitized && { bundlerUrl: sanitized.bundlerUrl ?? null }),
          ...('pimlicoApiKey' in sanitized && { pimlicoApiKey: sanitized.pimlicoApiKey ?? null }),
          // Solana fields
          ...('fee' in sanitized && { fee: sanitized.fee != null ? String(sanitized.fee) : null }),
          ...('slot' in sanitized && { slot: sanitized.slot != null ? String(sanitized.slot) : null }),
          ...('recentBlockhash' in sanitized && { recentBlockhash: sanitized.recentBlockhash ?? null }),
          ...('instructions' in sanitized && { instructions: sanitized.instructions ?? null }),
          // Starknet fields
          ...('actualFee' in sanitized && { actualFee: sanitized.actualFee ?? null }),
          ...('contractAddress' in sanitized && { contractAddress: sanitized.contractAddress ?? null }),
          // Payments fields
          appInvoiceId: matchedInvoiceId,
          amlStatus: initialAmlStatus,
          amlRiskScore: null,
          amlProviderData: null,
        });
      } catch (insertErr: any) {
        if (insertErr?.code === '23505') {
          this.logger.warn(
            `[Sync] Unique violation caught on insert for txKey=${data.txKey}. Retrying fetch to return duplicate.`,
          );
          const [existingAfterRace] = await this.db
            .select()
            .from(schema.transactions)
            .where(
              and(
                eq(schema.transactions.txKey, data.txKey),
                eq(schema.transactions.ownerId, meta.ownerId),
                eq(schema.transactions.appId, meta.id),
              ),
            )
            .limit(1);
          if (existingAfterRace) {
            const dupStatus = mode === 'fast' ? 200 : 202;
            res.status(dupStatus);
            return { success: true, txKey: existingAfterRace.txKey, mode, duplicate: true };
          }
        }
        throw insertErr;
      }

      // Map tracker enum to standardized metric ecosystem label
      let ecosystem = 'EVM';
      if (sanitized.tracker === TransactionTracker.Solana) {
        ecosystem = 'Solana';
      } else if (sanitized.tracker === TransactionTracker.Safe) {
        ecosystem = 'Safe';
      } else if (sanitized.tracker === TransactionTracker.Gelato) {
        ecosystem = 'Gelato';
      } else if (sanitized.tracker === TransactionTracker.ERC4337) {
        ecosystem = 'ERC4337';
      }

      // Increment transaction counter
      this.txCounter.inc({
        ecosystem,
        chainId: sanitized.chainId.toString(),
        status: 'Pending',
      });

      // 5. Enqueue for background workers (always start with Phase 1: fast)
      const jobId = `${meta.id}-${data.txKey}`;
      await this.fastQueue.add(
        'process-tx',
        { appId: meta.id, ownerId: meta.ownerId, txKey: data.txKey },
        {
          jobId,
          removeOnComplete: true,
        },
      );

      // 6. Trigger background AML check
      if (amlEnabled) {
        await this.amlQueue.add(
          'check-aml',
          {
            appId: meta.id,
            ownerId: meta.ownerId,
            fromAddress: sanitized.from,
            chainId: sanitized.chainId.toString(),
            txKey: data.txKey,
            customApiKey: meta.paymentSettings?.goPlusApiKey,
            customApiSecret: meta.paymentSettings?.goPlusApiSecret,
          },
          {
            jobId: `aml-${meta.id}-${data.txKey}`,
            removeOnComplete: true,
          },
        );
      }

      // 7. Response based on track mode (keep protocol responses same)
      const statusCode = mode === 'fast' ? 200 : 202;
      res.status(statusCode);
      return { success: true, txKey: data.txKey, mode };
    } finally {
      await this.redis.del(lockKey).catch(() => {});
    }
  }
}
