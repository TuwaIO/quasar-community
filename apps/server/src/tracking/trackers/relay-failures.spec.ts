import { TransactionStatus } from '@tuwaio/pulsar-core';
import { GelatoStatusCode } from '@tuwaio/pulsar-evm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processGelatoTx } from './gelato';
import { processSafeTx } from './safe';

const mocks = vi.hoisted(() => ({ initializePollingTracker: vi.fn() }));

vi.mock('@tuwaio/pulsar-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tuwaio/pulsar-core')>()),
  initializePollingTracker: (args: unknown) => mocks.initializePollingTracker(args),
}));

vi.mock('@tuwaio/shared/encryption', () => ({ decrypt: vi.fn(() => '') }));

const counter = () => ({ inc: vi.fn(), set: vi.fn() }) as any;
const tx: any = { txKey: '0xkey', chainId: 1, from: '0xsafe', appId: 'app', ownerId: 'owner', adapter: 'evm' };

const db: any = {
  select: () => {
    const query: any = { from: () => query, where: () => query, limit: () => Promise.resolve([{}]) };
    return query;
  },
};

/** Runs the tracker, calls its `onFailure` with the fetcher's response and returns the saved error message. */
async function failureMessage(start: (updateDbTx: any) => Promise<void>, response: unknown): Promise<string> {
  const updateDbTx = vi.fn().mockResolvedValue(undefined);
  await start(updateDbTx);
  const { onFailure } = mocks.initializePollingTracker.mock.calls[0][0];
  await onFailure(response);
  expect(updateDbTx).toHaveBeenCalledWith(
    tx.txKey,
    expect.objectContaining({ status: TransactionStatus.Failed, pending: false }),
    true,
  );
  return updateDbTx.mock.calls[0][1].error.message;
}

const safe = (updateDbTx: any) => processSafeTx(tx, vi.fn(), updateDbTx, counter(), counter(), counter());
const gelato = (updateDbTx: any) => processGelatoTx(tx, vi.fn(), updateDbTx, db, counter(), counter(), counter());

describe('Safe and Gelato failure reasons (Pulsar 0.8 fetchers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('Safe: a transaction the service does not know', async () => {
    expect(await failureMessage(safe, undefined)).toBe('Safe transaction not found, or tracking failed.');
  });

  it('Safe: an executed, unsuccessful transaction', async () => {
    expect(await failureMessage(safe, { isExecuted: true, isSuccessful: false })).toBe(
      'Safe transaction failed or was rejected.',
    );
  });

  it('Safe: a transaction still pending one day after it was proposed', async () => {
    expect(await failureMessage(safe, { isExecuted: false })).toBe('Safe transaction was not executed within a day.');
  });

  it('Gelato: a rejected task', async () => {
    expect(await failureMessage(gelato, { status: GelatoStatusCode.Rejected })).toBe(
      'Transaction was rejected by Gelato Relay.',
    );
  });

  it('Gelato: a task still pending one hour after it was created', async () => {
    expect(await failureMessage(gelato, { status: GelatoStatusCode.Pending })).toBe(
      'Gelato task was not executed within an hour.',
    );
  });
});
