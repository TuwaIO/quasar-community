import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decrypt, encrypt, getEncryptionKey } from './encryption';

describe('Encryption Utility', () => {
  const testKey = '0'.repeat(64); // 32 bytes hex
  const testUrl = 'https://eth-mainnet.g.alchemy.com/v2/test-key';

  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', testKey);
  });

  it('should encrypt and decrypt a string correctly', () => {
    const encrypted = encrypt(testUrl);
    expect(encrypted).toContain('qenc:');

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(testUrl);
  });

  it('should not double-encrypt if already prefixed', () => {
    const firstEncryption = encrypt(testUrl);
    const secondEncryption = encrypt(firstEncryption);
    expect(secondEncryption).toBe(firstEncryption);
  });

  it('should return empty string for null/undefined/empty input', () => {
    expect(encrypt(null)).toBe('');
    expect(encrypt(undefined)).toBe('');
    expect(encrypt('')).toBe('');

    expect(decrypt(null)).toBe('');
    expect(decrypt(undefined)).toBe('');
    expect(decrypt('')).toBe('');
  });

  it('should return original string if decryption fails or not encrypted', () => {
    expect(decrypt('not-encrypted')).toBe('not-encrypted');
    expect(decrypt('qenc:invalid:format')).toBe('qenc:invalid:format');
  });

  it('should fail decryption and return original string if the auth tag is truncated', () => {
    const encrypted = encrypt(testUrl);
    const parts = encrypted.slice('qenc:'.length).split(':');
    // Truncate the auth tag to 8 bytes (16 hex chars)
    parts[1] = parts[1].slice(0, 16);
    const corrupted = `qenc:${parts.join(':')}`;
    expect(decrypt(corrupted)).toBe(corrupted);
  });

  it('should fail decryption and return original string if the ciphertext is corrupted', () => {
    const encrypted = encrypt(testUrl);
    const parts = encrypted.slice('qenc:'.length).split(':');
    // Corrupt the ciphertext by changing a char guaranteed to be different
    parts[2] = parts[2][0] === '0' ? '1' + parts[2].slice(1) : '0' + parts[2].slice(1);
    const corrupted = `qenc:${parts.join(':')}`;
    expect(decrypt(corrupted)).toBe(corrupted);
  });

  it('should fail decryption and return original string if IV length is invalid', () => {
    const encrypted = encrypt(testUrl);
    const parts = encrypted.slice('qenc:'.length).split(':');
    // Shorten the IV
    parts[0] = parts[0].slice(0, 10);
    const corrupted = `qenc:${parts.join(':')}`;
    expect(decrypt(corrupted)).toBe(corrupted);
  });

  it('should throw error if ENCRYPTION_KEY is invalid length', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'short');
    expect(() => getEncryptionKey()).toThrow('ENCRYPTION_KEY must be a 32-byte hex string');
  });

  it('should throw error if ENCRYPTION_KEY is missing', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => getEncryptionKey()).toThrow('ENCRYPTION_KEY is not defined');
  });
});
