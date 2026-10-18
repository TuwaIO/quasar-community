import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { decrypt } from '@tuwaio/shared/encryption';
import { getToken } from '@willsoto/nestjs-prometheus';
import { Queue } from 'bullmq';
import { Counter } from 'prom-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, MockProxy } from 'vitest-mock-extended';

import { PULSAR_TX_COUNT_METRIC } from '../../../constants';
import { DRIZZLE } from '../../../database/database.constants';
import * as schema from '../../../database/schema/index';
import { REDIS } from '../../../redis/redis.constants';
import { ProviderAvailabilityService } from '../../../tracking/provider-availability';
import { TrackingService } from '../../../tracking/tracking.service';
import { SyncController } from './sync.controller';

describe('SyncController (Payments Logic)', () => {
  let controller: SyncController;
  let db: MockProxy<any>;
  let redis: { set: any; del: any };
  let fastQueue: MockProxy<Queue>;
  let amlQueue: MockProxy<Queue>;
  let txCounter: MockProxy<Counter<string>>;
  let trackingService: { resetTerminalTx: any };
  let providerAvailability: { check: any };

  beforeEach(async () => {
    db = mock<any>();
    fastQueue = mock<Queue>();
    amlQueue = mock<Queue>();
    txCounter = mock<Counter<string>>();
    redis = {
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };
    trackingService = {
      resetTerminalTx: vi.fn().mockResolvedValue(undefined),
    };
    providerAvailability = { check: vi.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        { provide: DRIZZLE, useValue: db },
        { provide: REDIS, useValue: redis },
        { provide: getQueueToken('{tracking-fast}'), useValue: fastQueue },
        { provide: getQueueToken('{aml-screening}'), useValue: amlQueue },
        { provide: getToken(PULSAR_TX_COUNT_METRIC), useValue: txCounter },
        { provide: TrackingService, useValue: trackingService },
        { provide: ProviderAvailabilityService, useValue: providerAvailability },
      ],
    }).compile();

    controller = module.get<SyncController>(SyncController);
  });

  const createMockContext = (metaOverrides: any = {}) => {
    const req = {
      engineMeta: {
        id: 'app_123',
        status: 'active',
        isRevoked: false,
        ipWhitelist: [],
        domainsWhitelist: [],
        rpsLimit: 10,
        scopes: [],
        publicKey: 'pk_test_123',
        ownerId: 'org_123',
        trackMode: 'fast',
        appKind: 'basic',
        paymentSettings: null,
        ...metaOverrides,
      },
    };

    const res = {
      status: vi.fn(),
    };

    return { req, res };
  };

  it('refuses a transaction that the app has no provider to track, with 422 and nothing stored', async () => {
    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    db.select.mockReturnValue(mockSelectChain);
    const mockInsertChain = { values: vi.fn().mockResolvedValue({}) };
    db.insert.mockReturnValue(mockInsertChain);
    providerAvailability.check.mockResolvedValue('No RPC provider for chain 1: add an RPC endpoint.');

    const { req, res } = createMockContext();
    const body = {
      adapter: 'evm',
      txKey: '0x999',
      chainId: 1,
      connectorType: 'metamask',
      from: '0xabc',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'ethereum',
      type: 'transfer',
    };

    await expect(controller.syncTransaction(body, req as any, res as any)).rejects.toMatchObject({
      status: 422,
      // @tuwaio/quasar-sdk reads `error` into the message of QuasarSDKError
      response: expect.objectContaining({
        error: 'Unprocessable Entity: No RPC provider for chain 1: add an RPC endpoint.',
        message: 'No RPC provider for chain 1: add an RPC endpoint.',
      }),
    });
    expect(providerAvailability.check).toHaveBeenCalledWith(
      'app_123',
      expect.objectContaining({ tracker: 'ethereum', adapter: 'evm', chainId: '1' }),
    );
    expect(mockInsertChain.values).not.toHaveBeenCalled();
    expect(fastQueue.add).not.toHaveBeenCalled();
  });

  // Endpoints and keys sent with a transaction are the customer's credentials: the RPC endpoint is never used (the app's
  // own settings are), a bundler URL and a Pimlico key are kept only encrypted, like the keys in the app's settings
  it('stores no RPC endpoint and only encrypted bundler URLs and Pimlico keys sent with a transaction', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));
    db.select.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });
    const mockInsertChain = { values: vi.fn().mockResolvedValue({}) };
    db.insert.mockReturnValue(mockInsertChain);
    const { req, res } = createMockContext();

    await controller.syncTransaction(
      {
        adapter: 'evm',
        txKey: '0x456',
        chainId: 1,
        connectorType: 'metamask',
        from: '0xabc',
        pending: true,
        localTimestamp: Date.now(),
        tracker: 'ethereum',
        type: 'transfer',
        rpcUrl: 'https://rpc.example.com/v2/secret-rpc-key',
        bundlerUrl: 'https://bundler.example.com/rpc?apikey=secret-bundler-key',
        pimlicoApiKey: 'pim_secret',
      },
      req as any,
      res as any,
    );

    const stored = mockInsertChain.values.mock.calls[0][0];
    expect(stored.rpcUrl).toBeNull();
    expect(stored.bundlerUrl).toMatch(/^qenc:/);
    expect(stored.pimlicoApiKey).toMatch(/^qenc:/);
    expect(decrypt(stored.bundlerUrl)).toBe('https://bundler.example.com/rpc?apikey=secret-bundler-key');
    expect(decrypt(stored.pimlicoApiKey)).toBe('pim_secret');
    vi.unstubAllEnvs();
  });

  it('should sync basic app transaction and NOT queue AML check', async () => {
    // 1. Mock idempotency check (not found)
    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    db.select.mockReturnValue(mockSelectChain);

    // 2. Mock insert chain
    const mockInsertChain = {
      values: vi.fn().mockResolvedValue({}),
    };
    db.insert.mockReturnValue(mockInsertChain);

    const { req, res } = createMockContext();

    const body = {
      adapter: 'evm',
      txKey: '0x123',
      chainId: 1,
      connectorType: 'metamask',
      from: '0xabc',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'ethereum',
      type: 'transfer',
    };

    const result = await controller.syncTransaction(body, req as any, res as any);

    expect(result.success).toBe(true);
    expect(res.status).toHaveBeenCalledWith(200);

    // Verify transaction was inserted with amlStatus 'not_applicable'
    expect(db.insert).toHaveBeenCalledWith(schema.transactions);
    expect(mockInsertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        amlStatus: 'not_applicable',
        appInvoiceId: null,
      }),
    );

    // Verify fast-queue was triggered
    expect(fastQueue.add).toHaveBeenCalledWith(
      'process-tx',
      { appId: 'app_123', ownerId: 'org_123', txKey: '0x123' },
      expect.objectContaining({ jobId: 'app_123-0x123' }),
    );

    // Verify aml-queue was NOT triggered
    expect(amlQueue.add).not.toHaveBeenCalled();
  });

  it('does not screen payments app transactions unless AML_SCREENING_ENABLED is true', async () => {
    vi.stubEnv('AML_SCREENING_ENABLED', '');
    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    db.select.mockReturnValue(mockSelectChain);
    const mockInsertChain = { values: vi.fn().mockResolvedValue({}) };
    db.insert.mockReturnValue(mockInsertChain);

    const { req, res } = createMockContext({
      appKind: 'payments',
      paymentSettings: { amlEnabled: true, goPlusApiKey: 'test-key', goPlusApiSecret: 'test-secret' },
    });
    const body = {
      adapter: 'evm',
      txKey: '0x457',
      chainId: 1,
      connectorType: 'metamask',
      from: '0xabc',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'ethereum',
      type: 'transfer',
    };

    const result = await controller.syncTransaction(body, req as any, res as any);

    expect(result.success).toBe(true);
    expect(mockInsertChain.values).toHaveBeenCalledWith(expect.objectContaining({ amlStatus: 'not_applicable' }));
    expect(amlQueue.add).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('should sync payments app transaction with AML enabled and queue AML check', async () => {
    vi.stubEnv('AML_SCREENING_ENABLED', 'true');
    // 1. Mock select chain to return empty (both idempotency and invoice check)
    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    db.select.mockReturnValue(mockSelectChain);

    const mockInsertChain = {
      values: vi.fn().mockResolvedValue({}),
    };
    db.insert.mockReturnValue(mockInsertChain);

    const { req, res } = createMockContext({
      appKind: 'payments',
      paymentSettings: {
        amlEnabled: true,
        goPlusApiKey: 'test-key',
        goPlusApiSecret: 'test-secret',
      },
    });

    const body = {
      adapter: 'evm',
      txKey: '0x456',
      chainId: 1,
      connectorType: 'metamask',
      from: '0xabc',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'ethereum',
      type: 'transfer',
    };

    const result = await controller.syncTransaction(body, req as any, res as any);

    expect(result.success).toBe(true);

    // Verify transaction was inserted with amlStatus 'pending'
    expect(mockInsertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        amlStatus: 'pending',
      }),
    );

    // Verify aml-queue was triggered
    expect(amlQueue.add).toHaveBeenCalledWith(
      'check-aml',
      {
        appId: 'app_123',
        ownerId: 'org_123',
        fromAddress: '0xabc',
        chainId: '1',
        txKey: '0x456',
        customApiKey: 'test-key',
        customApiSecret: 'test-secret',
      },
      expect.objectContaining({ jobId: 'aml-app_123-0x456' }),
    );
    vi.unstubAllEnvs();
  });

  it('should automatically link matched appInvoiceId if appInvoiceId is provided in body and valid', async () => {
    const mockSelectChain1 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockSelectChain2 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'invoice_999' }]),
    };
    db.select.mockReturnValueOnce(mockSelectChain1).mockReturnValueOnce(mockSelectChain2);

    const mockInsertChain = {
      values: vi.fn().mockResolvedValue({}),
    };
    db.insert.mockReturnValue(mockInsertChain);

    const { req, res } = createMockContext({
      appKind: 'payments',
    });

    const body = {
      adapter: 'evm',
      txKey: '0x789',
      chainId: 1,
      connectorType: 'metamask',
      from: '0xabc',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'ethereum',
      type: 'transfer',
      appInvoiceId: 'invoice_999',
    };

    await controller.syncTransaction(body, req as any, res as any);

    // Verify transaction was inserted with matched appInvoiceId
    expect(mockInsertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        appInvoiceId: 'invoice_999',
      }),
    );
  });

  it('should throw BadRequestException if appInvoiceId does not belong to the app/tenant', async () => {
    const mockSelectChain1 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockSelectChain2 = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    db.select.mockReturnValueOnce(mockSelectChain1).mockReturnValueOnce(mockSelectChain2);

    const { req, res } = createMockContext({
      appKind: 'payments',
    });

    const body = {
      adapter: 'evm',
      txKey: '0x789',
      chainId: 1,
      connectorType: 'metamask',
      from: '0xabc',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'ethereum',
      type: 'transfer',
      appInvoiceId: 'invoice_invalid',
    };

    await expect(controller.syncTransaction(body, req as any, res as any)).rejects.toThrow(
      new BadRequestException('Invalid appInvoiceId or unauthorized access.'),
    );
  });

  it('Test (Engine Isolation): should query transactions using current appId to prevent reading other app transactions', async () => {
    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    db.select.mockReturnValue(mockSelectChain);

    const mockInsertChain = {
      values: vi.fn().mockResolvedValue({}),
    };
    db.insert.mockReturnValue(mockInsertChain);

    const { req, res } = createMockContext({
      id: 'app_different_abc',
      ownerId: 'org_abc',
    });

    const body = {
      adapter: 'evm',
      txKey: '0x123',
      chainId: 1,
      connectorType: 'metamask',
      from: '0xabc',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'ethereum',
      type: 'transfer',
    };

    await controller.syncTransaction(body, req as any, res as any);

    // Verify select was scoped by the different appId and ownerId
    expect(mockSelectChain.where).toHaveBeenCalled();
  });

  it('Test (Sync Idempotency & Lock): should return duplicate status 200/202 if transaction exists when Redis lock fails', async () => {
    // Redis lock fails (already locked)
    redis.set.mockResolvedValue(null);

    // Mock existing transaction check to return the transaction
    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ txKey: '0x123' }]),
    };
    db.select.mockReturnValue(mockSelectChain);

    const { req, res } = createMockContext({
      trackMode: 'fast',
    });

    const body = {
      adapter: 'evm',
      txKey: '0x123',
      chainId: 1,
      connectorType: 'metamask',
      from: '0xabc',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'ethereum',
      type: 'transfer',
    };

    const result = await controller.syncTransaction(body, req as any, res as any);

    expect(result.duplicate).toBe(true);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('answers with the duplicate when a concurrent sync inserted the transaction first (Drizzle-wrapped unique violation)', async () => {
    // Not there when checked, there after the insert lost the race
    const limit = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ txKey: '0x123' }]);
    db.select.mockReturnValue({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit });
    // Drizzle wraps the driver error; the Postgres code is on `cause`
    const values = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('Failed query: insert into "transactions"'), { cause: { code: '23505' } }),
      );
    db.insert.mockReturnValue({ values });

    const { req, res } = createMockContext({ trackMode: 'fast' });
    const body = {
      adapter: 'evm',
      txKey: '0x123',
      chainId: 1,
      connectorType: 'metamask',
      from: '0xabc',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'ethereum',
      type: 'transfer',
    };

    const result = await controller.syncTransaction(body, req as any, res as any);

    expect(values).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, txKey: '0x123', mode: 'fast', duplicate: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(fastQueue.add).not.toHaveBeenCalled();
  });

  it('still fails on an insert error that is not a unique violation', async () => {
    db.select.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });
    const failure = Object.assign(new Error('Failed query'), { cause: { code: '23502' } });
    db.insert.mockReturnValue({ values: vi.fn().mockRejectedValue(failure) });

    const { req, res } = createMockContext();
    const body = {
      adapter: 'evm',
      txKey: '0x456',
      chainId: 1,
      connectorType: 'metamask',
      from: '0xabc',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'ethereum',
      type: 'transfer',
    };

    await expect(controller.syncTransaction(body, req as any, res as any)).rejects.toBe(failure);
  });

  it('Test (Cross-App Same txKey): should allow two different apps to register the same txKey independently', async () => {
    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    db.select.mockReturnValue(mockSelectChain);

    const mockInsertChain = {
      values: vi.fn().mockResolvedValue({}),
    };
    db.insert.mockReturnValue(mockInsertChain);

    const { req: reqApp1, res: resApp1 } = createMockContext({
      id: 'app_1',
    });
    const { req: reqApp2, res: resApp2 } = createMockContext({
      id: 'app_2',
    });

    const body = {
      adapter: 'evm',
      txKey: '0xsamehash',
      chainId: 1,
      connectorType: 'metamask',
      from: '0xabc',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'ethereum',
      type: 'transfer',
    };

    // Both apps sync the same txKey. Since they have different appId, they do not collide
    const res1 = await controller.syncTransaction(body, reqApp1 as any, resApp1 as any);
    const res2 = await controller.syncTransaction(body, reqApp2 as any, resApp2 as any);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it('should sync ERC-4337 UserOperation with bundlerUrl and pimlicoApiKey and tag ecosystem as ERC4337', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'ab'.repeat(32));
    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    db.select.mockReturnValue(mockSelectChain);

    let insertedValues: any = null;
    const mockInsertChain = {
      values: vi.fn().mockImplementation((val) => {
        insertedValues = val;
        return Promise.resolve({});
      }),
    };
    db.insert.mockReturnValue(mockInsertChain);

    const { req, res } = createMockContext();

    const body = {
      adapter: 'evm',
      txKey: '0xuserop123',
      chainId: 8453,
      connectorType: 'smart-account',
      from: '0xsender123',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'erc4337',
      type: 'user-operation',
      bundlerUrl: 'https://api.pimlico.io/v2/8453/rpc?apikey=test',
      pimlicoApiKey: 'test-pimlico-key',
    };

    const result = await controller.syncTransaction(body, req as any, res as any);

    expect(result.success).toBe(true);
    expect(insertedValues).toEqual(expect.objectContaining({ txKey: '0xuserop123', tracker: 'erc4337' }));
    expect(decrypt(insertedValues.bundlerUrl)).toBe('https://api.pimlico.io/v2/8453/rpc?apikey=test');
    expect(decrypt(insertedValues.pimlicoApiKey)).toBe('test-pimlico-key');
    expect(txCounter.inc).toHaveBeenCalledWith({
      ecosystem: 'ERC4337',
      chainId: '8453',
      status: 'Pending',
    });
    vi.unstubAllEnvs();
  });

  it.each([
    ['solana:devnet', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
    ['solana:mainnet-beta', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
  ])('stores the Solana chain ID %s sent by a client as the CAIP-2 chain ID %s', async (sentChainId, storedChainId) => {
    db.select.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });
    const values = vi.fn().mockResolvedValue({});
    db.insert.mockReturnValue({ values });

    const { req, res } = createMockContext();

    const body = {
      adapter: 'solana',
      txKey: '5VERsig',
      chainId: sentChainId,
      connectorType: 'solana:phantom',
      from: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
      pending: true,
      localTimestamp: Date.now(),
      tracker: 'solana',
      type: 'transfer',
    };

    await controller.syncTransaction(body, req as any, res as any);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ chainId: storedChainId }));
    expect(txCounter.inc).toHaveBeenCalledWith({ ecosystem: 'Solana', chainId: storedChainId, status: 'Pending' });
  });

  describe('EIP-5792 batches and Solana details', () => {
    const BATCH = '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000aa01';
    const HASH = `0x${'ab'.repeat(32)}`;
    const selectReturning = (rows: unknown[]) =>
      db.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(rows),
      });
    const updateReturning = (rows: unknown[]) => {
      const set = vi.fn().mockReturnThis();
      db.update.mockReturnValue({ set, where: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue(rows) });
      return set;
    };
    const batch = (overrides: Record<string, unknown> = {}) => ({
      txKey: BATCH,
      tracker: 'eip5792',
      pending: true,
      hash: null,
      appInvoiceId: null,
      ...overrides,
    });

    it('syncs an EIP-5792 batch by its batch ID and queues it: the router waits for the hash the app reports', async () => {
      selectReturning([]);
      const values = vi.fn().mockResolvedValue({});
      db.insert.mockReturnValue({ values });
      const { req, res } = createMockContext();

      const result = await controller.syncTransaction(
        {
          adapter: 'evm',
          txKey: BATCH,
          chainId: 8453,
          connectorType: 'injected:metamask',
          from: '0xabc',
          pending: true,
          localTimestamp: Date.now(),
          tracker: 'eip5792',
          type: 'batch',
        },
        req as any,
        res as any,
      );

      expect(result).toMatchObject({ success: true, txKey: BATCH });
      expect(values).toHaveBeenCalledWith(expect.objectContaining({ txKey: BATCH, tracker: 'eip5792' }));
      expect(txCounter.inc).toHaveBeenCalledWith({ ecosystem: 'EIP5792', chainId: '8453', status: 'Pending' });
      expect(fastQueue.add).toHaveBeenCalledWith(
        'process-tx',
        expect.objectContaining({ txKey: BATCH }),
        expect.anything(),
      );
    });

    it('refuses EIP-5792 for a Solana transaction: batches of calls are an EVM wallet feature', async () => {
      const { req, res } = createMockContext();
      await expect(
        controller.syncTransaction(
          {
            adapter: 'solana',
            txKey: '5VERsig',
            chainId: 'solana:devnet',
            connectorType: 'solana:phantom',
            from: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
            pending: true,
            localTimestamp: Date.now(),
            tracker: 'eip5792',
            type: 'transfer',
          },
          req as any,
          res as any,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('stores the last valid block height and commitment of a Solana transaction', async () => {
      selectReturning([]);
      const values = vi.fn().mockResolvedValue({});
      db.insert.mockReturnValue({ values });
      const { req, res } = createMockContext();

      await controller.syncTransaction(
        {
          adapter: 'solana',
          txKey: '5VERsig',
          chainId: 'solana:devnet',
          connectorType: 'solana:phantom',
          from: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
          pending: true,
          localTimestamp: Date.now(),
          tracker: 'solana',
          type: 'transfer',
          lastValidBlockHeight: 345_678_901,
          confirmationStatus: 'processed',
        },
        req as any,
        res as any,
      );

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({ lastValidBlockHeight: '345678901', confirmationStatus: 'processed' }),
      );
    });

    it('takes the hash of a pending batch once and starts tracking it on-chain', async () => {
      selectReturning([batch()]);
      const set = updateReturning([{ txKey: BATCH }]);
      const { req } = createMockContext();

      const result = await controller.attachHash(BATCH, { hash: HASH }, req as any);

      expect(result).toEqual({ success: true, txKey: BATCH, hash: HASH });
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH }));
      expect(fastQueue.add).toHaveBeenCalledWith(
        'process-tx',
        { appId: 'app_123', ownerId: 'org_123', txKey: BATCH },
        expect.objectContaining({ jobId: `app_123-${BATCH}-hash` }),
      );
    });

    it('answers a repeated hash as a duplicate, and refuses another hash or a finished batch', async () => {
      const { req } = createMockContext();

      selectReturning([batch({ hash: HASH })]);
      expect(await controller.attachHash(BATCH, { hash: HASH }, req as any)).toEqual({
        success: true,
        txKey: BATCH,
        hash: HASH,
        duplicate: true,
      });
      expect(db.update).not.toHaveBeenCalled();

      selectReturning([batch({ hash: `0x${'cd'.repeat(32)}` })]);
      await expect(controller.attachHash(BATCH, { hash: HASH }, req as any)).rejects.toThrow(ConflictException);

      selectReturning([batch({ pending: false, status: 'Failed' })]);
      await expect(controller.attachHash(BATCH, { hash: HASH }, req as any)).rejects.toThrow(ConflictException);
      expect(fastQueue.add).not.toHaveBeenCalled();
    });

    it('refuses a malformed hash, an unknown batch and a transaction of another tracker', async () => {
      const { req } = createMockContext();

      await expect(controller.attachHash(BATCH, { hash: '0x123' }, req as any)).rejects.toThrow(BadRequestException);

      selectReturning([]);
      await expect(controller.attachHash(BATCH, { hash: HASH }, req as any)).rejects.toThrow(NotFoundException);

      selectReturning([batch({ tracker: 'ethereum' })]);
      await expect(controller.attachHash(BATCH, { hash: HASH }, req as any)).rejects.toThrow(BadRequestException);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('links the invoice a Payments batch pays once its hash is known', async () => {
      const { req } = createMockContext({ appKind: 'payments' });
      // The batch, then the invoice paid by the hash
      const limit = vi
        .fn()
        .mockResolvedValueOnce([batch()])
        .mockResolvedValueOnce([{ id: 'inv_9' }]);
      db.select.mockReturnValue({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit });
      const set = updateReturning([{ txKey: BATCH }]);

      await controller.attachHash(BATCH, { hash: HASH }, req as any);

      expect(set).toHaveBeenCalledWith(expect.objectContaining({ hash: HASH, appInvoiceId: 'inv_9' }));
    });
  });
});
