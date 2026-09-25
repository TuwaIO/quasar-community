import { postgresAdapter } from '@payloadcms/db-postgres';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import path from 'path';
import { fileURLToPath } from 'url';


const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export const dbAdapter = postgresAdapter({
  pool: {
    connectionString: process.env.DATABASE_URL || '',
    max: process.env.PAYLOAD_DATABASE_POOL_MAX
      ? parseInt(process.env.PAYLOAD_DATABASE_POOL_MAX, 10)
      : process.env.DATABASE_POOL_MAX
        ? parseInt(process.env.DATABASE_POOL_MAX, 10)
        : 4,
    connectionTimeoutMillis: process.env.DATABASE_POOL_TIMEOUT ? parseInt(process.env.DATABASE_POOL_TIMEOUT, 10) : 5000,
    idleTimeoutMillis: process.env.DATABASE_POOL_IDLE_TIMEOUT
      ? parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT, 10)
      : 10000,
  },
  migrationDir: path.resolve(dirname, '../migrations'),
  push: false,
});

export const editorAdapter = lexicalEditor();

