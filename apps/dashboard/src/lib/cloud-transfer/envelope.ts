import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { CloudTransferError } from './errors';

/**
 * The encrypted envelope of a Quasar export (`.qex`), format described in
 * open-source-plans/11-cloud-to-community-migration.md §5.2:
 *
 *   "QEX1\n" <header length: uint32 BE> <header JSON> <frame>*
 *   frame = <flag: uint8, 1 on the final frame> <length: uint32 BE> <AES-256-GCM ciphertext + 16-byte tag>
 *
 * Every frame but the last carries exactly `chunkSize` bytes. The nonce is the frame number, which is unique because
 * every export has its own random key. The additional data of a frame binds it to the header, its number and its
 * flag, so a changed, reordered, dropped or cut frame fails authentication or the final-frame check.
 */

const EXPORT_FORMAT = 'quasar-export';
/** Highest format version this node writes and reads */
const EXPORT_VERSION = 1;
const DEFAULT_CHUNK_SIZE = 64 * 1024;

const MAGIC = Buffer.from('QEX1\n');
const MAX_HEADER_BYTES = 4096;
const MIN_CHUNK_SIZE = 256;
const MAX_CHUNK_SIZE = 1024 * 1024;
const TAG_BYTES = 16;
const KEY_CHECK_LABEL = 'qex-key-check';

export interface EnvelopeHeader {
  format: typeof EXPORT_FORMAT;
  version: number;
  cipher: 'aes-256-gcm';
  chunkSize: number;
  /** First 8 bytes of HMAC-SHA256(key, "qex-key-check"), hex: tells a wrong key from a damaged file */
  keyCheck: string;
  createdAt: string;
}

const keyCheckOf = (key: Uint8Array) =>
  createHmac('sha256', key).update(KEY_CHECK_LABEL).digest().subarray(0, 8).toString('hex');

const uint32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};

const nonceOf = (index: number) => Buffer.concat([Buffer.alloc(8), uint32(index)]);

const additionalData = (headerDigest: Buffer, index: number, final: boolean) =>
  Buffer.concat([headerDigest, uint32(index), Buffer.from([final ? 1 : 0])]);

/** Encrypts a byte stream into an export envelope. */
export function createEnvelopeEncryptor(
  key: Uint8Array,
  options: { chunkSize?: number; now?: Date } = {},
): TransformStream<Uint8Array, Uint8Array> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const header: EnvelopeHeader = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    cipher: 'aes-256-gcm',
    chunkSize,
    keyCheck: keyCheckOf(key),
    createdAt: (options.now ?? new Date()).toISOString(),
  };
  const headerBytes = Buffer.from(JSON.stringify(header));
  const headerDigest = createHash('sha256').update(headerBytes).digest();

  let pending: Buffer[] = [];
  let pendingLength = 0;
  let index = 0;

  const frame = (plaintext: Buffer, final: boolean): Uint8Array => {
    const cipher = createCipheriv('aes-256-gcm', key, nonceOf(index), { authTagLength: TAG_BYTES });
    cipher.setAAD(additionalData(headerDigest, index, final));
    const sealed = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    index += 1;
    return new Uint8Array(Buffer.concat([Buffer.from([final ? 1 : 0]), uint32(sealed.length), sealed]));
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(Buffer.concat([MAGIC, uint32(headerBytes.length), headerBytes])));
    },
    transform(chunk, controller) {
      pending.push(Buffer.from(chunk));
      pendingLength += chunk.length;
      if (pendingLength < chunkSize) return;
      let all = Buffer.concat(pending);
      while (all.length >= chunkSize) {
        controller.enqueue(frame(all.subarray(0, chunkSize), false));
        all = all.subarray(chunkSize);
      }
      pending = all.length > 0 ? [all] : [];
      pendingLength = all.length;
    },
    flush(controller) {
      controller.enqueue(frame(Buffer.concat(pending), true));
    },
  });
}

/** Reads exact byte counts from a stream. */
class ByteReader {
  private buffer = Buffer.alloc(0);
  private ended = false;

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  /** `count` bytes, or `null` when the stream ended exactly here; throws when it ended in the middle. */
  async read(count: number): Promise<Buffer | null> {
    while (this.buffer.length < count && !this.ended) {
      const { value, done } = await this.reader.read();
      if (done) this.ended = true;
      else this.buffer = Buffer.concat([this.buffer, Buffer.from(value)]);
    }
    if (this.buffer.length === 0 && this.ended) return null;
    if (this.buffer.length < count) {
      throw new CloudTransferError('corrupt', 'The export is incomplete: the file ends in the middle of a frame.');
    }
    const bytes = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return bytes;
  }

  cancel(reason?: unknown) {
    return this.reader.cancel(reason);
  }
}

function parseHeader(bytes: Buffer): EnvelopeHeader {
  const notAnExport = () => new CloudTransferError('not-an-export', 'This file is not a Quasar export.');
  let header: Partial<EnvelopeHeader>;
  try {
    header = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw notAnExport();
  }
  if (header?.format !== EXPORT_FORMAT || !Number.isInteger(header.version) || (header.version ?? 0) < 1) {
    throw notAnExport();
  }
  if ((header.version ?? 0) > EXPORT_VERSION) {
    throw new CloudTransferError(
      'unsupported-version',
      `This export uses format version ${header.version}; this node reads up to version ${EXPORT_VERSION}. Update the Community Edition and import it again.`,
    );
  }
  if (
    header.cipher !== 'aes-256-gcm' ||
    !Number.isInteger(header.chunkSize) ||
    (header.chunkSize ?? 0) < MIN_CHUNK_SIZE ||
    (header.chunkSize ?? 0) > MAX_CHUNK_SIZE ||
    typeof header.keyCheck !== 'string' ||
    !/^[0-9a-f]{16}$/.test(header.keyCheck)
  ) {
    throw notAnExport();
  }
  return header as EnvelopeHeader;
}

/**
 * Decrypts an export envelope. The returned stream errors with a {@link CloudTransferError}: `not-an-export`,
 * `unsupported-version`, `wrong-key` (before any frame is decrypted) or `corrupt`.
 */
export function openEnvelope(input: ReadableStream<Uint8Array>, key: Uint8Array): ReadableStream<Uint8Array> {
  const source = new ByteReader(input.getReader());
  let header: EnvelopeHeader | null = null;
  let headerDigest = Buffer.alloc(0);
  let index = 0;

  const readHeader = async () => {
    const notAnExport = () => new CloudTransferError('not-an-export', 'This file is not a Quasar export.');
    let magic: Buffer | null;
    let length: Buffer | null;
    try {
      magic = await source.read(MAGIC.length);
      length = magic?.equals(MAGIC) ? await source.read(4) : null;
    } catch {
      throw notAnExport();
    }
    if (!magic?.equals(MAGIC) || !length) throw notAnExport();
    const headerLength = length.readUInt32BE(0);
    if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) throw notAnExport();
    const headerBytes = await source.read(headerLength);
    if (!headerBytes) throw notAnExport();
    const parsed = parseHeader(headerBytes);
    if (!timingSafeEqual(Buffer.from(parsed.keyCheck, 'hex'), Buffer.from(keyCheckOf(key), 'hex'))) {
      throw new CloudTransferError('wrong-key', 'The import key does not match this export.');
    }
    headerDigest = createHash('sha256').update(headerBytes).digest();
    header = parsed;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!header) await readHeader();
      const { chunkSize } = header as unknown as EnvelopeHeader;

      const flag = await source.read(1);
      if (!flag) {
        throw new CloudTransferError('corrupt', 'The export is incomplete: it ends before its final frame.');
      }
      if (flag[0] !== 0 && flag[0] !== 1) throw new CloudTransferError('corrupt', 'The export is damaged.');
      const final = flag[0] === 1;

      const lengthBytes = await source.read(4);
      if (!lengthBytes) throw new CloudTransferError('corrupt', 'The export is incomplete.');
      const length = lengthBytes.readUInt32BE(0);
      const valid = final ? length >= TAG_BYTES && length <= chunkSize + TAG_BYTES : length === chunkSize + TAG_BYTES;
      if (!valid) throw new CloudTransferError('corrupt', 'The export is damaged.');

      const sealed = await source.read(length);
      if (!sealed) throw new CloudTransferError('corrupt', 'The export is incomplete.');

      let plaintext: Buffer;
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, nonceOf(index), { authTagLength: TAG_BYTES });
        decipher.setAAD(additionalData(headerDigest, index, final));
        decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
        plaintext = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
      } catch {
        throw new CloudTransferError('corrupt', 'The export is damaged: a part of it does not match its signature.');
      }
      index += 1;

      if (plaintext.length > 0) controller.enqueue(new Uint8Array(plaintext));
      if (final) {
        if ((await source.read(1)) !== null) {
          throw new CloudTransferError('corrupt', 'The export is damaged: there is data after its end.');
        }
        controller.close();
      }
    },
    cancel(reason) {
      return source.cancel(reason);
    },
  });
}
