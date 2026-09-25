import { getEncryptionKey } from '@tuwaio/shared/encryption';
import path from 'path';
import { buildConfig } from 'payload';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

import { dbAdapter, editorAdapter } from './payload/adapters';
import { adminConfig } from './payload/admin';
import { collections } from './payload/collections';
import { globals } from './payload/globals';
import { plugins } from './payload/plugins';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

// Neutralize libheif vulnerability in sharp (GHSA-rgj7-g3m4-5g8c)
if (typeof sharp.block === 'function') {
  sharp.block({ operation: ['VipsForeignLoadHeif'] });
}

// Validate encryption key on startup
try {
  getEncryptionKey();
} catch (error) {
  console.error('\x1b[31m%s\x1b[0m', '[FATAL] Encryption setup failed:');
  console.error('\x1b[31m%s\x1b[0m', (error as Error).message);
  process.exit(1);
}

if (!process.env.PAYLOAD_SECRET || process.env.PAYLOAD_SECRET.length < 32) {
  console.error('\x1b[31m%s\x1b[0m', '[FATAL] PAYLOAD_SECRET must be at least 32 characters long.');
  process.exit(1);
}

export default buildConfig({
  admin: adminConfig,
  collections,
  globals,
  editor: editorAdapter,
  graphQL: { disable: true },
  secret: process.env.PAYLOAD_SECRET || '',
  // serverURL is required for Payload's built-in email verification links and internal auth requests.
  // Must match NEXT_PUBLIC_SERVER_URL (e.g. https://quasar.example.com in production).
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
  cors: [
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
    'https://safe.global',
    'https://app.safe.global',
    ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : []),
  ].filter(Boolean),
  csrf: [
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
    'https://safe.global',
    'https://app.safe.global',
    ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000', 'http://127.0.0.1:3000'] : []),
  ].filter(Boolean),
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: dbAdapter,

  sharp,
  plugins,
});
