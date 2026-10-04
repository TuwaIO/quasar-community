// @vitest-environment node
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createEnvelopeEncryptor, openEnvelope } from '@/lib/cloud-transfer/envelope';
import { CloudTransferError } from '@/lib/cloud-transfer/errors';
import { formatImportKey, generateImportKey, parseImportKey } from '@/lib/cloud-transfer/key';

/** Feeds `bytes` in pieces of `pieceSize` and collects the whole output. */
async function pipe(stream: TransformStream<Uint8Array, Uint8Array>, bytes: Uint8Array, pieceSize = 7_000) {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += pieceSize) {
        controller.enqueue(bytes.slice(offset, offset + pieceSize));
      }
      controller.close();
    },
  });
  return collect(input.pipeThrough(stream));
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return new Uint8Array(Buffer.concat(parts));
}

const streamOf = (bytes: Uint8Array, pieceSize = 5_000) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += pieceSize) {
        controller.enqueue(bytes.slice(offset, offset + pieceSize));
      }
      controller.close();
    },
  });

async function errorOf(promise: Promise<unknown>): Promise<CloudTransferError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CloudTransferError) return error;
    throw error;
  }
  throw new Error('expected a CloudTransferError');
}

const CHUNK = 1024;

async function seal(key: Uint8Array, plaintext: Uint8Array) {
  return pipe(createEnvelopeEncryptor(key, { chunkSize: CHUNK }), plaintext);
}

describe('import key', () => {
  it('shows 32 random bytes as QEX1- and 13 groups of Crockford base32', () => {
    const { key, display } = generateImportKey();
    expect(key).toHaveLength(32);
    expect(display).toMatch(/^QEX1(-[0-9A-HJKMNP-TV-Z]{4}){13}$/);
    expect(Buffer.from(parseImportKey(display)).equals(Buffer.from(key))).toBe(true);
  });

  it('reads a key typed loosely: lower case, spaces instead of dashes, O for 0 and I or L for 1', () => {
    const key = new Uint8Array(32).fill(0);
    key[0] = 0b00001_000;
    const display = formatImportKey(key);
    expect(display.startsWith('QEX1-0000')).toBe(false);
    const [prefix, ...groups] = display.split('-');
    const loose = `${prefix.toLowerCase()} ${groups.join(' ').toLowerCase().replaceAll('0', 'o').replaceAll('1', 'l')}`;
    expect(Buffer.from(parseImportKey(loose)).equals(Buffer.from(key))).toBe(true);
  });

  it.each([
    '',
    'QEX1-ABCD',
    'QEX2' + generateImportKey().display.slice(4),
    generateImportKey().display + 'A',
    'QEX1-' + 'U'.repeat(52),
  ])('rejects %j', (value) => {
    expect(() => parseImportKey(value)).toThrow(CloudTransferError);
  });

  it('rejects a key whose padding bits are set, so every key has one spelling', () => {
    const display = formatImportKey(new Uint8Array(32));
    expect(() => parseImportKey(display.slice(0, -1) + '1')).toThrow(CloudTransferError);
  });
});

describe('envelope', () => {
  it.each([0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 50_000])('round-trips %i bytes', async (size) => {
    const { key } = generateImportKey();
    const plaintext = new Uint8Array(randomBytes(size));
    const sealed = await seal(key, plaintext);
    expect(Buffer.from(sealed.subarray(0, 5)).toString()).toBe('QEX1\n');
    const opened = await collect(openEnvelope(streamOf(sealed), key));
    expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('reports a wrong key before decrypting anything', async () => {
    const sealed = await seal(generateImportKey().key, new Uint8Array(randomBytes(3000)));
    const error = await errorOf(collect(openEnvelope(streamOf(sealed), generateImportKey().key)));
    expect(error.code).toBe('wrong-key');
  });

  it('reports a changed byte in a frame as a damaged file', async () => {
    const { key } = generateImportKey();
    const sealed = await seal(key, new Uint8Array(randomBytes(3000)));
    sealed[sealed.length - 40] ^= 0x01;
    expect((await errorOf(collect(openEnvelope(streamOf(sealed), key)))).code).toBe('corrupt');
  });

  it('reports a file cut before its final frame as incomplete', async () => {
    const { key } = generateImportKey();
    const sealed = await seal(key, new Uint8Array(randomBytes(CHUNK * 3)));
    // the last frame holds no data (the plaintext is a multiple of the chunk size): 1 + 4 + 16 bytes
    const cut = sealed.subarray(0, sealed.length - 21);
    const error = await errorOf(collect(openEnvelope(streamOf(cut), key)));
    expect(error.code).toBe('corrupt');
    expect(error.message).toMatch(/incomplete/i);
  });

  it('rejects frames in another order', async () => {
    const { key } = generateImportKey();
    const plaintext = new Uint8Array(randomBytes(CHUNK * 2 + 10));
    const sealed = await seal(key, plaintext);
    const headerEnd = 5 + 4 + new DataView(sealed.buffer, sealed.byteOffset + 5, 4).getUint32(0);
    const frame = 1 + 4 + CHUNK + 16;
    const first = sealed.slice(headerEnd, headerEnd + frame);
    const second = sealed.slice(headerEnd + frame, headerEnd + 2 * frame);
    const swapped = new Uint8Array(sealed);
    swapped.set(second, headerEnd);
    swapped.set(first, headerEnd + frame);
    expect((await errorOf(collect(openEnvelope(streamOf(swapped), key)))).code).toBe('corrupt');
  });

  it('rejects bytes after the final frame', async () => {
    const { key } = generateImportKey();
    const sealed = await seal(key, new Uint8Array(randomBytes(100)));
    const padded = new Uint8Array([...sealed, 0]);
    expect((await errorOf(collect(openEnvelope(streamOf(padded), key)))).code).toBe('corrupt');
  });

  it('rejects a file that is not a Quasar export', async () => {
    const error = await errorOf(
      collect(openEnvelope(streamOf(new TextEncoder().encode('{"hello":1}\n')), generateImportKey().key)),
    );
    expect(error.code).toBe('not-an-export');
  });

  it('rejects an export from a newer format version', async () => {
    const { key } = generateImportKey();
    const sealed = await seal(key, new Uint8Array(10));
    const headerLength = new DataView(sealed.buffer, sealed.byteOffset + 5, 4).getUint32(0);
    const header = JSON.parse(Buffer.from(sealed.subarray(9, 9 + headerLength)).toString());
    const newer = Buffer.from(JSON.stringify({ ...header, version: 99 }));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(newer.length);
    const rewritten = Buffer.concat([
      Buffer.from('QEX1\n'),
      length,
      newer,
      Buffer.from(sealed.subarray(9 + headerLength)),
    ]);
    const error = await errorOf(collect(openEnvelope(streamOf(new Uint8Array(rewritten)), key)));
    expect(error.code).toBe('unsupported-version');
  });
});
