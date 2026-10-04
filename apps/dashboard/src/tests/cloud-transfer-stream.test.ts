// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createEnvelopeEncryptor } from '@/lib/cloud-transfer/envelope';
import { CloudTransferError } from '@/lib/cloud-transfer/errors';
import { generateImportKey } from '@/lib/cloud-transfer/key';
import type { ExportRecord } from '@/lib/cloud-transfer/records';
import { readExport, writeExport } from '@/lib/cloud-transfer/stream';

const ORG = 'org_1';
const TS = '2026-09-20T10:00:00.000Z';

const counts = (overrides: Partial<Record<string, number>> = {}) => ({
  app: 1,
  appAcceptedPayment: 0,
  webhookEndpoint: 1,
  appInvoice: 0,
  transaction: 1,
  webhookDelivery: 1,
  ...overrides,
});

function sampleRecords(): ExportRecord[] {
  return [
    {
      t: 'manifest',
      v: {
        source: 'quasar-cloud',
        exportedAt: '2026-10-03T12:00:00.000Z',
        schemaMigration: '20261003_071000_solana_caip2_chain_ids',
        organization: { id: ORG, name: 'Acme' },
        deliveriesSince: '2026-09-03T12:00:00.000Z',
        members: 3,
        counts: counts(),
      },
    },
    { t: 'organization', v: { id: ORG, name: 'Acme', createdAt: TS, updatedAt: TS } },
    {
      t: 'app',
      v: {
        id: 'app_1',
        name: 'Shop',
        organization: ORG,
        isActive: true,
        environment: 'live',
        kind: 'basic',
        publicKey: 'pk_live_abc',
        secretKey: 'sk_live_def',
        ipWhitelist: [{ ip: '203.0.113.7' }],
        domainsWhitelist: [{ domain: 'shop.example' }],
        rpcConfigs: [{ chainId: '1', rpcUrl: 'https://rpc.example/v2/key' }],
        alchemyApiKey: 'alchemy-key',
        quickNodeApiKey: null,
        quickNodeAppName: null,
        gelatoApiKey: null,
        pimlicoApiKey: null,
        paymentSettings: { amlEnabled: false, goPlusApiKey: null, goPlusApiSecret: null, appInvoiceTemplate: null },
        createdAt: TS,
        updatedAt: TS,
      },
    },
    {
      t: 'webhookEndpoint',
      v: {
        id: 'wh_1',
        app: 'app_1',
        url: 'https://hooks.shop.example/quasar',
        signingSecret: 'whsec_123',
        events: ['*'],
        description: null,
        txType: '*',
        isActive: true,
        createdAt: TS,
        updatedAt: TS,
      },
    },
    {
      t: 'transaction',
      v: {
        owner: ORG,
        app: 'app_1',
        appName: 'Shop',
        txKey: '0xabc',
        chainId: '1',
        from: '0x1111111111111111111111111111111111111111',
        type: 'transfer',
        connectorType: 'evm:metamask',
        adapter: 'evm',
        tracker: 'ethereum',
        status: 'Success',
        syncStatus: 'synced',
        pending: false,
        isError: false,
        localTimestamp: 1790000000000,
        finishedTimestamp: 1790000005000,
        title: null,
        description: null,
        error: null,
        payload: { item: 'cup' },
        confirmations: '12',
        requiredConfirmations: 12,
        rpcUrl: null,
        appInvoiceId: null,
        amlStatus: 'not_applicable',
        amlRiskScore: 0,
        amlProviderData: null,
        hash: '0xabc',
        to: '0x2222222222222222222222222222222222222222',
        value: '1000',
        input: '0x',
        nonce: 4,
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        replacedTxHash: null,
        bundlerUrl: null,
        pimlicoApiKey: null,
        fee: null,
        slot: null,
        recentBlockhash: null,
        instructions: null,
        actualFee: null,
        contractAddress: null,
        createdAt: '2026-09-20 10:00:00.123+00',
        updatedAt: '2026-09-20 10:00:05.456+00',
      },
    },
    {
      t: 'webhookDelivery',
      v: {
        id: 'del_1',
        endpoint: 'wh_1',
        eventType: 'transaction:success',
        txKey: '0xabc',
        httpStatus: 200,
        success: true,
        requestPayload: { action: 'Success' },
        responseBody: 'ok',
        executionTimeMs: 120,
        attempts: 1,
        createdAt: TS,
        updatedAt: TS,
      },
    },
    { t: 'end', v: { counts: counts() } },
  ] as ExportRecord[];
}

async function* each<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function readAll(stream: ReadableStream<Uint8Array>, key: Uint8Array, limits?: Parameters<typeof readExport>[2]) {
  const records: ExportRecord[] = [];
  for await (const record of readExport(stream, key, limits)) records.push(record);
  return records;
}

/** Seals hand-written NDJSON, to feed the reader what a broken writer would produce. */
function sealRaw(key: Uint8Array, ndjson: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(ndjson));
      controller.close();
    },
  })
    .pipeThrough(new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)
    .pipeThrough(createEnvelopeEncryptor(key, { chunkSize: 1024 }));
}

const lines = (records: unknown[]) => records.map((record) => JSON.stringify(record)).join('\n') + '\n';

async function errorOf(promise: Promise<unknown>): Promise<CloudTransferError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CloudTransferError) return error;
    throw error;
  }
  throw new Error('expected a CloudTransferError');
}

describe('export stream', () => {
  it('reads back what it wrote, with timestamps in ISO form', async () => {
    const { key } = generateImportKey();
    const records = await readAll(writeExport(each(sampleRecords()), key), key);

    expect(records.map((record) => record.t)).toEqual([
      'manifest',
      'organization',
      'app',
      'webhookEndpoint',
      'transaction',
      'webhookDelivery',
      'end',
    ]);
    const transaction = records.find((record) => record.t === 'transaction')!;
    expect(transaction.v).toMatchObject({
      txKey: '0xabc',
      createdAt: '2026-09-20T10:00:00.123Z',
      payload: { item: 'cup' },
    });
    expect(records.find((record) => record.t === 'app')!.v).toMatchObject({ secretKey: 'sk_live_def' });
  });

  it('ignores fields a newer Cloud adds', async () => {
    const { key } = generateImportKey();
    const records = sampleRecords();
    (records[2].v as Record<string, unknown>).futureField = 'x';
    const app = (await readAll(sealRaw(key, lines(records)), key)).find((record) => record.t === 'app')!;
    expect(app.v).not.toHaveProperty('futureField');
  });

  it('rejects a record that breaks the schema and names it', async () => {
    const { key } = generateImportKey();
    const records = sampleRecords();
    (records[2].v as Record<string, unknown>).name = '';
    const error = await errorOf(readAll(sealRaw(key, lines(records)), key));
    expect(error.code).toBe('invalid-record');
    expect(error.message).toMatch(/app.*line 3/);
  });

  it('rejects records out of order', async () => {
    const { key } = generateImportKey();
    const records = sampleRecords();
    [records[2], records[4]] = [records[4], records[2]];
    expect((await errorOf(readAll(sealRaw(key, lines(records)), key))).code).toBe('invalid-record');
  });

  it('rejects an export that does not start with its manifest', async () => {
    const { key } = generateImportKey();
    expect((await errorOf(readAll(sealRaw(key, lines(sampleRecords().slice(1))), key))).code).toBe('invalid-record');
  });

  it('rejects an export without its end record', async () => {
    const { key } = generateImportKey();
    const error = await errorOf(readAll(sealRaw(key, lines(sampleRecords().slice(0, -1))), key));
    expect(error.code).toBe('corrupt');
  });

  it('rejects counts that do not match the records', async () => {
    const { key } = generateImportKey();
    const records = sampleRecords();
    records[records.length - 1] = { t: 'end', v: { counts: counts({ transaction: 2 }) } } as ExportRecord;
    expect((await errorOf(readAll(sealRaw(key, lines(records)), key))).code).toBe('corrupt');
  });

  it.each([
    ['a transaction of another organization', 4, 'owner', 'org_other'],
    ['an app of another organization', 2, 'organization', 'org_other'],
    ['a delivery of an endpoint that is not in the export', 5, 'endpoint', 'wh_other'],
    ['a webhook endpoint of an app that is not in the export', 3, 'app', 'app_other'],
  ])('refuses %s, so a crafted file cannot write into another organization', async (_case, index, field, value) => {
    const { key } = generateImportKey();
    const records = sampleRecords();
    (records[index as number].v as Record<string, unknown>)[field as string] = value;
    const error = await errorOf(readAll(sealRaw(key, lines(records)), key));
    expect(error.code).toBe('invalid-record');
  });

  it('stops reading past the decompressed size limit', async () => {
    const { key } = generateImportKey();
    const error = await errorOf(
      readAll(writeExport(each(sampleRecords()), key), key, { maxDecompressedBytes: 500, maxLineBytes: 1_000_000 }),
    );
    expect(error.code).toBe('too-large');
  });

  it('refuses a line longer than the limit', async () => {
    const { key } = generateImportKey();
    const error = await errorOf(
      readAll(writeExport(each(sampleRecords()), key), key, { maxDecompressedBytes: 1_000_000, maxLineBytes: 300 }),
    );
    expect(error.code).toBe('too-large');
  });
});
