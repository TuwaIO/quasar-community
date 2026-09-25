'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.getEncryptionKey = getEncryptionKey;
exports.encrypt = encrypt;
exports.decrypt = decrypt;
const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const PREFIX = 'qenc:';
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY is not defined in environment variables');
  }
  const buffer = Buffer.from(key, 'hex');
  if (buffer.length === 32) {
    return buffer;
  }
  if (key.length === 32) {
    return Buffer.from(key, 'utf8');
  }
  throw new Error('ENCRYPTION_KEY must be a 32-byte hex string (64 characters) or a 32-byte raw string');
}
function encrypt(text) {
  if (!text || typeof text !== 'string') return text || '';
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
function decrypt(encryptedText) {
  if (!encryptedText || typeof encryptedText !== 'string' || !encryptedText.startsWith(PREFIX)) {
    return encryptedText || '';
  }
  try {
    const parts = encryptedText.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
      return encryptedText;
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
    console.warn(
      '[ENCRYPTION] Decryption failed, returning original text:',
      error instanceof Error ? error.message : String(error),
    );
    return encryptedText;
  }
}
//# sourceMappingURL=encryption.js.map
