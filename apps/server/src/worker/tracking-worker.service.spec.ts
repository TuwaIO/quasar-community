import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Job, Queue } from 'bullmq';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, MockProxy } from 'vitest-mock-extended';

import { DRIZZLE } from '../database/database.constants';
import * as schema from '../database/schema/index';
import { AmlService } from '../tracking/aml.service';
import { RouterService } from '../tracking/router.service';
import { WebhookDispatcherService } from '../tracking/webhook-dispatcher.service';
import { AmlProcessor, TrackingFastProcessor } from './tracking-worker.service';

describe('TrackingWorkerService', () => {
  describe('TrackingFastProcessor', () => {
    let processor: TrackingFastProcessor;
    let routerService: MockProxy<RouterService>;
    let lazyQueue: MockProxy<Queue>;

    beforeEach(async () => {
      routerService = mock<RouterService>();
      lazyQueue = mock<Queue>();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TrackingFastProcessor,
          { provide: RouterService, useValue: routerService },
          { provide: getQueueToken('{tracking-lazy}'), useValue: lazyQueue },
        ],
      }).compile();

      processor = module.get<TrackingFastProcessor>(TrackingFastProcessor);
    });

    it('should process job and schedule lazy fallback with correct jobId', async () => {
      const job = {
        data: {
          appId: 'app_1',
          ownerId: 'org_1',
          txKey: '0xhash',
        },
      } as Job;

      await processor.process(job);

      expect(routerService.checkAndInitializeTrackerInWorker).toHaveBeenCalledWith('app_1', '0xhash');
      expect(lazyQueue.add).toHaveBeenCalledWith(
        'process-tx',
        { appId: 'app_1', ownerId: 'org_1', txKey: '0xhash' },
        expect.objectContaining({ jobId: 'app_1-0xhash' }),
      );
    });
  });

  describe('AmlProcessor', () => {
    let processor: AmlProcessor;
    let db: MockProxy<any>;
    let amlService: MockProxy<AmlService>;
    let webhookDispatcher: MockProxy<WebhookDispatcherService>;

    beforeEach(async () => {
      db = mock<any>();
      amlService = mock<AmlService>();
      webhookDispatcher = mock<WebhookDispatcherService>();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AmlProcessor,
          { provide: DRIZZLE, useValue: db },
          { provide: AmlService, useValue: amlService },
          { provide: WebhookDispatcherService, useValue: webhookDispatcher },
        ],
      }).compile();

      processor = module.get<AmlProcessor>(AmlProcessor);
    });

    it('should query and update transactions scoped strictly by appId, ownerId, and txKey', async () => {
      amlService.checkAml.mockResolvedValue({ isHighRisk: false } as any);

      const updateMock = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'tx_1', pending: false, status: 'success' }]),
      };
      db.update.mockReturnValue(updateMock);

      const job = {
        data: {
          appId: 'app_1',
          ownerId: 'org_1',
          fromAddress: '0xfrom',
          chainId: '1',
          txKey: '0xhash',
        },
      } as Job;

      await processor.process(job);

      expect(db.update).toHaveBeenCalledWith(schema.transactions);
      expect(updateMock.where).toHaveBeenCalled();

      const whereClause = updateMock.where.mock.calls[0][0];
      const { sql, params } = new PgDialect().sqlToQuery(whereClause);
      expect(sql).toContain('app_id');
      expect(sql).toContain('owner_id');
      expect(sql).toContain('tx_key');
      expect(params).toContain('app_1');
      expect(params).toContain('org_1');
      expect(params).toContain('0xhash');

      expect(webhookDispatcher.dispatchTerminalWebhook).toHaveBeenCalled();
    });

    it('should fail closed / set state to failed and not call webhook if still pending', async () => {
      amlService.checkAml.mockRejectedValue(new Error('Provider timeout'));

      const updateMock = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'tx_1', pending: true }]),
      };
      db.update.mockReturnValue(updateMock);

      const job = {
        data: {
          appId: 'app_1',
          ownerId: 'org_1',
          fromAddress: '0xfrom',
          chainId: '1',
          txKey: '0xhash',
        },
      } as Job;

      await processor.process(job);

      expect(db.update).toHaveBeenCalledWith(schema.transactions);
      expect(webhookDispatcher.dispatchTerminalWebhook).not.toHaveBeenCalled();
    });
  });
});
