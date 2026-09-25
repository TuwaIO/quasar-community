import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as retryTransaction } from '@/app/api/v1/organizations/[orgId]/transactions/[txId]/retry/route';
import { POST as retryWebhookDelivery } from '@/app/api/v1/organizations/[orgId]/webhooks/deliveries/[deliveryId]/retry/route';
import {
  canRetryTransaction,
  isStuckPendingTransaction,
  STUCK_PENDING_THRESHOLD_SECONDS,
} from '@/lib/transaction-retry';
import { canRetryWebhookDelivery } from '@/lib/webhook-utils';

const { mockAuthenticateRequest, mockVerifyAccess, mockQueueAdd, mockRedisDel, mockUpdateSet, selectResults } =
  vi.hoisted(() => ({
    mockAuthenticateRequest: vi.fn(),
    mockVerifyAccess: vi.fn(),
    mockQueueAdd: vi.fn(),
    mockRedisDel: vi.fn(),
    mockUpdateSet: vi.fn(),
    selectResults: [] as unknown[][],
  }));

vi.mock('@/lib/auth-utils', () => ({
  authenticateRequest: mockAuthenticateRequest,
  verifyOrgAccessOrSystemAdmin: mockVerifyAccess,
}));

vi.mock('@/lib/apiWrapper', () => ({
  withRateLimit: <T>(fn: T) => fn,
}));

vi.mock('@/lib/redis', () => ({
  getQueue: () => ({ add: mockQueueAdd }),
  redisApi: { del: mockRedisDel },
}));

const now = 1_700_000_000_000;

describe('isStuckPendingTransaction', () => {
  it('does not mark a fresh pending transaction as stuck', () => {
    expect(isStuckPendingTransaction({ pending: true, localTimestamp: (now - 59_000) / 1000 }, now)).toBe(false);
  });

  it('marks a pending transaction as stuck after one minute', () => {
    expect(
      isStuckPendingTransaction(
        { pending: true, localTimestamp: (now - STUCK_PENDING_THRESHOLD_SECONDS * 1000) / 1000 },
        now,
      ),
    ).toBe(true);
  });

  it('supports millisecond timestamps', () => {
    expect(isStuckPendingTransaction({ pending: true, localTimestamp: now - 60_000 }, now)).toBe(true);
  });

  it('does not mark completed transactions as stuck', () => {
    expect(isStuckPendingTransaction({ pending: false, localTimestamp: (now - 120_000) / 1000 }, now)).toBe(false);
  });
});

describe('canRetryTransaction', () => {
  const old = (now - 120_000) / 1000;

  it('refuses a successful transaction', () => {
    expect(canRetryTransaction({ pending: false, status: 'Success', localTimestamp: old }, now)).toBe(false);
  });

  it('offers a failed or replaced transaction', () => {
    expect(canRetryTransaction({ pending: false, status: 'Failed', localTimestamp: old }, now)).toBe(true);
    expect(canRetryTransaction({ pending: false, status: 'Replaced', localTimestamp: old }, now)).toBe(true);
  });

  it('offers a finished transaction that never got a status', () => {
    expect(canRetryTransaction({ pending: false, status: null, localTimestamp: old }, now)).toBe(true);
  });

  it('refuses a fresh pending transaction, which is still being tracked', () => {
    expect(canRetryTransaction({ pending: true, status: null, localTimestamp: (now - 59_000) / 1000 }, now)).toBe(
      false,
    );
  });

  it('offers a pending transaction stuck past the threshold', () => {
    expect(canRetryTransaction({ pending: true, status: null, localTimestamp: old }, now)).toBe(true);
  });
});

describe('canRetryWebhookDelivery', () => {
  it('refuses a successful delivery', () => {
    expect(canRetryWebhookDelivery({ success: true })).toBe(false);
  });

  it('offers a failed delivery', () => {
    expect(canRetryWebhookDelivery({ success: false })).toBe(true);
  });
});

describe('Retry routes apply the same conditions', () => {
  // Every drizzle select in both routes ends in `.limit(1)`; each call hands
  // out the next queued result.
  const select = () => {
    const query: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where']) query[method] = () => query;
    query.limit = async () => selectResults.shift() ?? [];
    return query;
  };
  const update = () => ({
    set: (values: unknown) => ({
      where: async () => mockUpdateSet(values),
    }),
  });

  const user = { id: 'usr_1', roles: ['user'] };

  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    mockAuthenticateRequest.mockResolvedValue({ payload: { db: { drizzle: { select, update } } }, user });
    mockVerifyAccess.mockResolvedValue({ allowed: true });
    mockRedisDel.mockResolvedValue(1);
  });

  describe('POST …/transactions/[txId]/retry', () => {
    const secondsAgo = (seconds: number) => Math.floor((Date.now() - seconds * 1000) / 1000);
    const transaction = (fields: { pending: boolean; status: string | null; localTimestamp: number }) => ({
      id: 7,
      txKey: '0xabc',
      owner: 'org_1',
      appId: 'app_1',
      ...fields,
    });

    const callRoute = () =>
      retryTransaction(new Request('http://localhost/retry', { method: 'POST' }), {
        params: Promise.resolve({ orgId: 'org_1', txId: '7' }),
      });

    const expectRefused = async (message: string) => {
      const res = await callRoute();
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(message);
      expect(mockUpdateSet).not.toHaveBeenCalled();
      expect(mockRedisDel).not.toHaveBeenCalled();
      expect(mockQueueAdd).not.toHaveBeenCalled();
    };

    const expectScheduled = async () => {
      const res = await callRoute();
      expect(res.status).toBe(200);
      expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ pending: true, status: null }));
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'process-tx',
        { appId: 'app_1', ownerId: 'org_1', txKey: '0xabc' },
        expect.anything(),
      );
    };

    it('passes the whole user to the admin-aware access check', async () => {
      selectResults.push([transaction({ pending: false, status: 'Failed', localTimestamp: secondsAgo(600) })]);
      await callRoute();
      expect(mockVerifyAccess).toHaveBeenCalledWith(expect.anything(), user, 'org_1', ['owner', 'admin', 'member']);
    });

    it('rejects a successful transaction without touching it', async () => {
      selectResults.push([transaction({ pending: false, status: 'Success', localTimestamp: secondsAgo(600) })]);
      await expectRefused('Transaction was already tracked successfully');
    });

    it('rejects a fresh pending transaction without touching it', async () => {
      selectResults.push([transaction({ pending: true, status: null, localTimestamp: secondsAgo(10) })]);
      await expectRefused('Transaction is still being tracked');
    });

    it('re-tracks a failed transaction', async () => {
      selectResults.push([transaction({ pending: false, status: 'Failed', localTimestamp: secondsAgo(600) })]);
      await expectScheduled();
    });

    it('re-tracks a transaction stuck in pending', async () => {
      selectResults.push([transaction({ pending: true, status: null, localTimestamp: secondsAgo(600) })]);
      await expectScheduled();
    });

    it('still hides a transaction of another organization', async () => {
      selectResults.push([
        { ...transaction({ pending: false, status: 'Failed', localTimestamp: secondsAgo(600) }), owner: 'org_2' },
      ]);
      const res = await callRoute();
      expect(res.status).toBe(404);
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });

  describe('POST …/webhooks/deliveries/[deliveryId]/retry', () => {
    const delivery = (success: boolean) => ({
      id: 'dl_1',
      success,
      requestPayload: { action: 'Failed' },
      txKey: '0xabc',
      eventType: 'increment',
      endpoint: {
        id: 'ep_1',
        url: 'https://example.com/hook',
        signingSecret: 'secret',
        isSystemWebhook: false,
        appId: 'app_1',
      },
    });

    const callRoute = () =>
      retryWebhookDelivery(new Request('http://localhost/retry', { method: 'POST' }), {
        params: Promise.resolve({ orgId: 'org_1', deliveryId: 'dl_1' }),
      });

    it('passes the whole user to the admin-aware access check', async () => {
      selectResults.push([delivery(false)], [{ txKey: '0xabc', status: 'Failed', type: 'increment', chainId: '1' }]);
      await callRoute();
      expect(mockVerifyAccess).toHaveBeenCalledWith(expect.anything(), user, 'org_1', ['owner', 'admin']);
    });

    it('rejects a successful delivery without enqueueing anything', async () => {
      selectResults.push([delivery(true)]);

      const res = await callRoute();

      expect(res.status).toBe(400);
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it('enqueues a failed delivery', async () => {
      selectResults.push([delivery(false)], [{ txKey: '0xabc', status: 'Failed', type: 'increment', chainId: '1' }]);

      const res = await callRoute();

      expect(res.status).toBe(200);
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'deliver-webhook',
        expect.objectContaining({ deliveryId: 'dl_1', txKey: '0xabc' }),
        expect.anything(),
      );
    });
  });
});
