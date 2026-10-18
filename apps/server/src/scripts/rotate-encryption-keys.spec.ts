import { decrypt, encrypt } from '@tuwaio/shared/encryption';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as schema from '../database/schema/index';
import { decryptWithKey, encryptWithKey, parseKey, ROTATED_FIELDS } from './rotate-encryption-keys';

const OLD_KEY_HEX = 'a'.repeat(64);
const NEW_KEY_HEX = 'b'.repeat(64);

describe('rotate-encryption-keys', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the values the app encrypted with the old key', () => {
    vi.stubEnv('ENCRYPTION_KEY', OLD_KEY_HEX);
    const stored = encrypt('sk_live_secret');

    expect(decryptWithKey(stored, parseKey(OLD_KEY_HEX, 'OLD_ENCRYPTION_KEY'))).toBe('sk_live_secret');
  });

  it('writes values the app decrypts with the new key', () => {
    const rotated = encryptWithKey('sk_live_secret', parseKey(NEW_KEY_HEX, 'NEW_ENCRYPTION_KEY'));

    vi.stubEnv('ENCRYPTION_KEY', NEW_KEY_HEX);
    expect(decrypt(rotated)).toBe('sk_live_secret');
  });

  // Every field stored with `qenc:` must be rotated, or it can no longer be read after the switch to the new key
  it('rotates the keys of apps and those sent with transactions', () => {
    const rotated = ROTATED_FIELDS.map(([table, field]) => [table, field]);

    expect(rotated).toEqual(
      expect.arrayContaining([
        [schema.apps, 'pimlicoApiKey'],
        [schema.transactions, 'bundlerUrl'],
        [schema.transactions, 'pimlicoApiKey'],
        [schema.apps, 'secretKey'],
        [schema.appsRpcConfigs, 'rpcUrl'],
      ]),
    );
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => parseKey('abc', 'NEW_ENCRYPTION_KEY')).toThrow('NEW_ENCRYPTION_KEY must be 32 bytes (hex or raw)');
    expect(() => parseKey(undefined, 'NEW_ENCRYPTION_KEY')).toThrow('NEW_ENCRYPTION_KEY is not defined');
  });
});
