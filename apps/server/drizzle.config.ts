import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  out: './src/database/schema',
  schemaFilter: ['public'],
  dbCredentials: {
    // @ts-expect-error - process.env.DATABASE_URL is expected to be defined
    url: process.env.DATABASE_URL!,
  },
});
