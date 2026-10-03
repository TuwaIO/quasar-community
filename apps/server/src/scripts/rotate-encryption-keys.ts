/**
 * Re-encrypts every `qenc:` field of the database from OLD_ENCRYPTION_KEY to NEW_ENCRYPTION_KEY
 * (docs/runbooks/operations.md, "Rotation of Dashboard Encryption Key").
 *
 * From the workspace root, with the root .env as the fallback for DATABASE_URL:
 *   OLD_ENCRYPTION_KEY=<old> NEW_ENCRYPTION_KEY=<new> pnpm db:rotate-keys
 *
 * Inside the running engine container, where DATABASE_URL is already set:
 *   docker compose exec -e OLD_ENCRYPTION_KEY=<old> -e NEW_ENCRYPTION_KEY=<new> quasar-nest-api \
 *     node dist/scripts/rotate-encryption-keys.js
 *
 * It lives in the engine package, not in the root scripts/: it needs `pg`, `drizzle-orm` and the engine's Drizzle
 * schema, which do not resolve from the repository root.
 */
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../database/schema/index';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const PREFIX = 'qenc:';

/** Decrypts a `qenc:` value with the given key; a value without the prefix is returned as it is. */
export function decryptWithKey(encryptedText: string, keyBuffer: Buffer): string {
  if (!encryptedText.startsWith(PREFIX)) return encryptedText;

  try {
    const parts = encryptedText.slice(PREFIX.length).split(':');
    if (parts.length !== 3) return encryptedText;

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

/** Encrypts a value with the given key, in the `qenc:iv:authTag:content` format of `@tuwaio/shared/encryption`. */
export function encryptWithKey(text: string, keyBuffer: Buffer): string {
  if (!text) return '';

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/** Reads a 32-byte key given as 64 hex characters or as 32 raw characters, like `getEncryptionKey`. */
export function parseKey(key: string | undefined, name: string): Buffer {
  if (!key) throw new Error(`${name} is not defined`);
  const buffer = Buffer.from(key, 'hex');
  if (buffer.length === 32) return buffer;
  if (key.length === 32) return Buffer.from(key, 'utf8');
  throw new Error(`${name} must be 32 bytes (hex or raw)`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not defined');

  const oldKey = parseKey(process.env.OLD_ENCRYPTION_KEY, 'OLD_ENCRYPTION_KEY');
  const newKey = parseKey(process.env.NEW_ENCRYPTION_KEY, 'NEW_ENCRYPTION_KEY');

  console.log('--- Encryption Key Rotation Utility ---');
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema }) as any;

  /**
   * Helper to rotate a field in a table
   */
  async function rotateTableField(table: any, fieldName: string, label: string) {
    console.log(`\nChecking ${label}...`);
    const records = (await db.select().from(table)) as any[];
    console.log(`Found ${records.length} records.`);

    let success = 0;
    let skip = 0;
    let fail = 0;

    for (const record of records) {
      try {
        const currentValue = record[fieldName];
        if (!currentValue || !currentValue.startsWith(PREFIX)) {
          skip++;
          continue;
        }

        let decrypted: string;
        try {
          decrypted = decryptWithKey(currentValue, oldKey);
        } catch (oldKeyError) {
          // Already on the new key: a re-run after an incomplete rotation skips what the last run did
          try {
            decryptWithKey(currentValue, newKey);
          } catch {
            throw oldKeyError;
          }
          skip++;
          continue;
        }
        const reEncrypted = encryptWithKey(decrypted, newKey);

        await db
          .update(table)
          .set({ [fieldName]: reEncrypted })
          .where(eq(table.id, record.id));

        success++;
      } catch (err) {
        console.error('[FAIL] Record:', record.id, err instanceof Error ? err.message : String(err));
        fail++;
      }
    }
    console.log(`Results for ${label}: Success: ${success}, Skipped: ${skip}, Failed: ${fail}`);
    return { success, skip, fail };
  }

  const results = [
    // 1. Rotate Apps Sensitive Fields
    await rotateTableField(schema.apps, 'secretKey', 'Apps (Secret Key)'),
    await rotateTableField(schema.apps, 'alchemyApiKey', 'Apps (Alchemy API Key)'),
    await rotateTableField(schema.apps, 'quickNodeApiKey', 'Apps (QuickNode API Key)'),
    await rotateTableField(schema.apps, 'gelatoApiKey', 'Apps (Gelato API Key)'),

    // 2. Rotate Webhook Signing Secrets
    await rotateTableField(schema.webhookEndpoints, 'signingSecret', 'Webhooks (Signing Secrets)'),

    // 3. Rotate User Security Data
    await rotateTableField(schema.users, 'twoFactorSecret', 'Users (2FA Secrets)'),
    await rotateTableField(schema.users, 'backupCode', 'Users (Backup Codes)'),

    // 4. Rotate RPC URLs
    await rotateTableField(schema.appsRpcConfigs, 'rpcUrl', 'RPC Configurations'),
  ];
  await pool.end();

  // A failed record is still encrypted with the old key: switching ENCRYPTION_KEY now would make it unreadable
  const failed = results.reduce((sum, result) => sum + result.fail, 0);
  if (failed > 0) {
    console.error(
      `\n--- Rotation INCOMPLETE: ${failed} record(s) failed. Keep the old ENCRYPTION_KEY, fix the cause and run again ---`,
    );
    process.exitCode = 1;
    return;
  }
  console.log('\n--- Rotation Completed ---');
}

// Runs only as a script (tsx or node), not when the spec imports the helpers
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal Error:', err);
    process.exit(1);
  });
}
