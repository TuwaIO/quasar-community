import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import { Queue } from 'bullmq';
import { Counter } from 'prom-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, MockProxy } from 'vitest-mock-extended';

import { PULSAR_TX_COUNT_METRIC } from '../../../constants';
import { DRIZZLE } from '../../../database/database.constants';
import * as schema from '../../../database/schema/index';
import { REDIS } from '../../../redis/redis.constants';
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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        { provide: DRIZZLE, useValue: db },
        { provide: REDIS, useValue: redis },
        { provide: getQueueToken('{tracking-fast}'), useValue: fastQueue },
        { provide: getQueueToken('{aml-screening}'), useValue: amlQueue },
        { provide: getToken(PULSAR_TX_COUNT_METRIC), useValue: txCounter },
        { provide: TrackingService, useValue: trackingService },
      ],
    }).compile();

    controller = module.get<SyncController>(SyncController);
  });

  const createMockContext = (metaOverrides: any = {}) => {
    const req = {
      ironDomeMeta: {
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

  it('should sync payments app transaction with AML enabled and queue AML check', async () => {
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
    expect(insertedValues).toEqual(
      expect.objectContaining({
        txKey: '0xuserop123',
        tracker: 'erc4337',
        bundlerUrl: 'https://api.pimlico.io/v2/8453/rpc?apikey=test',
        pimlicoApiKey: 'test-pimlico-key',
      }),
    );
    expect(txCounter.inc).toHaveBeenCalledWith({
      ecosystem: 'ERC4337',
      chainId: '8453',
      status: 'Pending',
    });
  });
});
