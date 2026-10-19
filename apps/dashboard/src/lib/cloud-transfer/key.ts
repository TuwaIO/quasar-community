import { randomBytes } from 'node:crypto';

import { CloudTransferError } from './errors';

/**
 * The key of one export: 32 random bytes, shown once as `QEX1-` and 13 groups of four Crockford base32 characters.
 * Random rather than chosen by the owner, so it needs no key derivation and cannot be weak.
 */
const IMPORT_KEY_BYTES = 32;

const PREFIX = 'QEX1';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// 256 bits in 5-bit characters: 51 full characters and one that carries the last bit and 4 zero bits
const ENCODED_LENGTH = Math.ceil((IMPORT_KEY_BYTES * 8) / 5);

export function generateImportKey(): { key: Uint8Array; display: string } {
  const key = new Uint8Array(randomBytes(IMPORT_KEY_BYTES));
  return { key, display: formatImportKey(key) };
}

export function formatImportKey(key: Uint8Array): string {
  if (key.length !== IMPORT_KEY_BYTES) throw new Error(`An import key has ${IMPORT_KEY_BYTES} bytes`);
  let encoded = '';
  let value = 0;
  let bits = 0;
  for (const byte of key) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) encoded += ALPHABET[(value << (5 - bits)) & 31];
  return [PREFIX, ...(encoded.match(/.{1,4}/g) ?? [])].join('-');
}

/**
 * Reads a key as the owner pasted or typed it: any letter case, dashes or spaces anywhere, and the Crockford
 * look-alikes O for 0 and I or L for 1.
 *
 * @throws CloudTransferError `invalid-key`
 */
export function parseImportKey(input: string): Uint8Array {
  const invalid = () =>
    new CloudTransferError('invalid-key', 'This is not an import key. It starts with QEX1- and has 13 groups of 4.');

  const compact = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
  if (!compact.startsWith(PREFIX)) throw invalid();
  const body = compact.slice(PREFIX.length).replace(/O/g, '0').replace(/[IL]/g, '1');
  if (body.length !== ENCODED_LENGTH) throw invalid();

  const key = new Uint8Array(IMPORT_KEY_BYTES);
  let length = 0;
  let value = 0;
  let bits = 0;
  for (const char of body) {
    const digit = ALPHABET.indexOf(char);
    if (digit === -1) throw invalid();
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      key[length++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  // The padding bits of the last character are zero in every key this module writes
  if (length !== IMPORT_KEY_BYTES || value !== 0) throw invalid();
  return key;
}
