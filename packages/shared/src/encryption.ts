import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const PREFIX = 'qenc:';

/**
 * Validates and retrieves the encryption key from environment variables.
 * Key must be a 32-byte hex string (64 characters) or a 32-byte raw string.
 */
export function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY is not defined in environment variables');
  }

  // Support hex-encoded 32-byte key
  const buffer = Buffer.from(key, 'hex');
  if (buffer.length === 32) {
    return buffer;
  }

  // Fallback check for raw 32-byte string if not hex
  if (key.length === 32) {
    return Buffer.from(key, 'utf8');
  }

  throw new Error('ENCRYPTION_KEY must be a 32-byte hex string (64 characters) or a 32-byte raw string');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a string formatted as: qenc:iv:authTag:encryptedContent
 */
export function encrypt(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') return text || '';

  // If already encrypted with our prefix, don't encrypt again
  if (text.startsWith(PREFIX)) {
    return text;
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a string formatted as: qenc:iv:authTag:encryptedContent
 * If the string is not encrypted (does not have the prefix) or decryption fails,
 * it returns the original string.
 */
export function decrypt(encryptedText: string | null | undefined): string {
  if (!encryptedText || typeof encryptedText !== 'string' || !encryptedText.startsWith(PREFIX)) {
    return encryptedText || '';
  }

  try {
    const parts = encryptedText.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed cipher text structure');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
