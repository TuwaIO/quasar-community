import { createEnvelopeEncryptor, openEnvelope } from './envelope';
import { CloudTransferError } from './errors';
import {
  COUNTED_TYPES,
  type CountedType,
  type ExportCounts,
  type ExportRecord,
  type ExportRecordInput,
  type ManifestRecord,
  RECORD_ORDER,
  RECORD_SCHEMAS,
  type RecordType,
} from './records';

/**
 * A Quasar export end to end: records → NDJSON → gzip → encrypted envelope, and back.
 */

export interface ReadLimits {
  /** Bytes of NDJSON after decompression */
  maxDecompressedBytes: number;
  /** Bytes of one record */
  maxLineBytes: number;
}

export const DEFAULT_READ_LIMITS: ReadLimits = {
  maxDecompressedBytes: 4 * 1024 ** 3,
  maxLineBytes: 1024 ** 2,
};

const asBytes = <T>(stream: T) => stream as unknown as TransformStream<Uint8Array, Uint8Array>;

/**
 * Writes `records` as an encrypted export. Each record is validated first, so a Cloud row the importer would refuse
 * fails the export instead of producing a file nobody can import; the error then ends the stream.
 */
export function writeExport(
  records: AsyncIterable<ExportRecordInput>,
  key: Uint8Array,
  options: { chunkSize?: number } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = records[Symbol.asyncIterator]();

  const ndjson = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      const parsed = RECORD_SCHEMAS[value.t].safeParse(value.v);
      if (!parsed.success) {
        throw new Error(`Cannot export the ${value.t} record: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      }
      controller.enqueue(encoder.encode(JSON.stringify({ t: value.t, v: parsed.data }) + '\n'));
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });

  return ndjson.pipeThrough(asBytes(new CompressionStream('gzip'))).pipeThrough(createEnvelopeEncryptor(key, options));
}

const zeroCounts = (): ExportCounts => Object.fromEntries(COUNTED_TYPES.map((type) => [type, 0])) as ExportCounts;

const countsEqual = (a: ExportCounts, b: ExportCounts) => COUNTED_TYPES.every((type) => a[type] === b[type]);

/** Checks order, uniqueness, counts and that every record belongs to the exported organization. */
class RecordGate {
  private rank = -1;
  private manifest: ManifestRecord | null = null;
  private ended = false;
  private readonly counts = zeroCounts();
  private readonly apps = new Set<string>();
  private readonly endpoints = new Set<string>();
  private readonly acceptedPayments = new Set<string>();
  private readonly invoices = new Set<string>();

  accept(raw: unknown, line: number): ExportRecord {
    const invalid = (message: string) => new CloudTransferError('invalid-record', `Line ${line}: ${message}`);

    if (this.ended) throw new CloudTransferError('corrupt', 'The export is damaged: there are records after its end.');
    if (typeof raw !== 'object' || raw === null || !('t' in raw) || !('v' in raw)) throw invalid('not a record');
    const type = (raw as { t: unknown }).t;
    if (typeof type !== 'string' || !(RECORD_ORDER as readonly string[]).includes(type)) {
      throw invalid(`unknown record type ${JSON.stringify(type)}. Update the Community Edition and import again.`);
    }

    const rank = RECORD_ORDER.indexOf(type as RecordType);
    if (line === 1 && type !== 'manifest') throw invalid('the export does not start with its manifest');
    if (rank < this.rank) throw invalid(`a ${type} record comes after ${RECORD_ORDER[this.rank]} records`);
    if (rank === this.rank && !(COUNTED_TYPES as readonly string[]).includes(type)) {
      throw invalid(`a second ${type} record`);
    }
    if (type !== 'manifest' && type !== 'organization' && this.rank < 1) {
      throw invalid('the organization record is missing');
    }
    this.rank = rank;

    const parsed = RECORD_SCHEMAS[type as RecordType].safeParse((raw as { v: unknown }).v);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw invalid(
        `invalid ${type} record (line ${line}): ${issue?.path.join('.') || 'value'} ${issue?.message ?? ''}`.trim(),
      );
    }
    const record = { t: type, v: parsed.data } as ExportRecord;
    this.checkOwnership(record, invalid);

    if ((COUNTED_TYPES as readonly string[]).includes(type)) this.counts[type as CountedType] += 1;
    if (record.t === 'end') {
      this.ended = true;
      if (!countsEqual(record.v.counts, this.counts) || !countsEqual(this.manifest!.counts, this.counts)) {
        throw new CloudTransferError('corrupt', 'The export is damaged: its record counts do not match.');
      }
    }
    return record;
  }

  finish() {
    if (!this.ended) {
      throw new CloudTransferError('corrupt', 'The export is incomplete: it ends before its last record.');
    }
  }

  private checkOwnership(record: ExportRecord, invalid: (message: string) => CloudTransferError) {
    const org = this.manifest?.organization.id;
    const own = (value: string | null | undefined, what: string) => {
      if (value != null && value !== org) throw invalid(`${what} belongs to another organization`);
    };
    const known = (set: Set<string>, value: string | null | undefined, what: string) => {
      if (value != null && !set.has(value)) throw invalid(`${what} ${value} is not in the export`);
    };

    switch (record.t) {
      case 'manifest':
        this.manifest = record.v;
        break;
      case 'organization':
        own(record.v.id, 'the organization');
        break;
      case 'app':
        own(record.v.organization, `app ${record.v.id}`);
        this.apps.add(record.v.id);
        break;
      case 'appAcceptedPayment':
        own(record.v.organization, `accepted payment ${record.v.id}`);
        known(this.apps, record.v.app, 'app');
        this.acceptedPayments.add(record.v.id);
        break;
      case 'webhookEndpoint':
        known(this.apps, record.v.app, 'app');
        this.endpoints.add(record.v.id);
        break;
      case 'appInvoice':
        own(record.v.organization, `invoice ${record.v.id}`);
        known(this.apps, record.v.app, 'app');
        known(this.acceptedPayments, record.v.acceptedPayment, 'accepted payment');
        this.invoices.add(record.v.id);
        break;
      case 'transaction':
        own(record.v.owner, `transaction ${record.v.txKey}`);
        known(this.apps, record.v.app, 'app');
        known(this.invoices, record.v.appInvoiceId, 'invoice');
        break;
      case 'webhookDelivery':
        known(this.endpoints, record.v.endpoint, 'webhook endpoint');
        break;
      case 'end':
        break;
    }
  }
}

/**
 * Reads an export record by record, without holding it in memory.
 *
 * @throws CloudTransferError from the envelope, `too-large` past `limits`, `invalid-record` for a record that breaks
 * the format, `corrupt` for a damaged or incomplete export
 */
export async function* readExport(
  body: ReadableStream<Uint8Array>,
  key: Uint8Array,
  limits: ReadLimits = DEFAULT_READ_LIMITS,
): AsyncGenerator<ExportRecord> {
  const reader = openEnvelope(body, key)
    .pipeThrough(asBytes(new DecompressionStream('gzip')))
    .getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const gate = new RecordGate();
  let buffer = Buffer.alloc(0);
  let total = 0;
  let line = 0;

  const accept = (bytes: Buffer): ExportRecord => {
    line += 1;
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(bytes));
    } catch {
      throw new CloudTransferError('invalid-record', `Line ${line}: not a JSON record`);
    }
    return gate.accept(raw, line);
  };

  const tooLarge = (message: string) => new CloudTransferError('too-large', message);
  let finished = false;

  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (error instanceof CloudTransferError) throw error;
        throw new CloudTransferError('corrupt', 'The export is damaged: its content cannot be unpacked.');
      }
      if (chunk.done) break;

      total += chunk.value.length;
      if (total > limits.maxDecompressedBytes) throw tooLarge('The export is larger than this node accepts.');
      buffer = buffer.length === 0 ? Buffer.from(chunk.value) : Buffer.concat([buffer, chunk.value]);

      let newline = buffer.indexOf(0x0a);
      while (newline !== -1) {
        const bytes = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);
        if (bytes.length > limits.maxLineBytes) throw tooLarge(`Line ${line + 1} is larger than this node accepts.`);
        if (bytes.length > 0) yield accept(bytes);
        newline = buffer.indexOf(0x0a);
      }
      if (buffer.length > limits.maxLineBytes) throw tooLarge(`Line ${line + 1} is larger than this node accepts.`);
    }
    if (buffer.length > 0) yield accept(buffer);
    gate.finish();
    finished = true;
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
  }
}
