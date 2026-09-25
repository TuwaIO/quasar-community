// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

/**
 * `transactions` and `webhook_deliveries` are range-partitioned by
 * `created_at` (scripts/transform-init-migration.ts rewrites the init
 * migration for it). The Payload config knows nothing about partitions, so
 * `payload migrate:create` can emit statements that are valid for the config
 * and wrong for the database: swapping the composite (id, created_at) primary
 * key for a single-column one, restoring foreign keys to these tables, or a
 * unique index without the partition key. Postgres rejects the last two on a
 * partitioned table; the first silently breaks the partitioning contract.
 *
 * These checks fail on any such statement in a migration newer than init, so
 * it is caught in `pnpm test` rather than during a production deploy. The fix
 * is to delete the offending lines from the generated migration — see
 * AGENTS.md, "Creating a Payload migration".
 */

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const PARTITIONED = ['transactions', 'webhook_deliveries'];
const TABLES = PARTITIONED.join('|');

const migrationFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  .sort();

const laterMigrations = migrationFiles.filter((f) => !f.endsWith('_init.ts'));

/** SQL without `//`, `/* *\/` and `--` comments, so prose never matches. */
function sqlOf(file: string): string {
  return fs
    .readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/--.*$/gm, '');
}

describe('Payload migrations vs. partitioned tables', () => {
  it('has exactly one init migration, and it is the first', () => {
    const inits = migrationFiles.filter((f) => f.endsWith('_init.ts'));
    expect(inits).toHaveLength(1);
    expect(migrationFiles[0]).toBe(inits[0]);
  });

  it.each(laterMigrations)('%s leaves the partitioned primary keys alone', (file) => {
    const pk = new RegExp(
      `ALTER TABLE "(${TABLES})" (ADD PRIMARY KEY|ADD CONSTRAINT "[^"]+" PRIMARY KEY|DROP CONSTRAINT "[^"]*(_pk|_pkey)")`,
      'g',
    );
    expect(sqlOf(file).match(pk) ?? []).toEqual([]);
  });

  it.each(laterMigrations)('%s adds no foreign keys to partitioned tables', (file) => {
    const fk = new RegExp(`REFERENCES "public"\\."(${TABLES})"`, 'g');
    expect(sqlOf(file).match(fk) ?? []).toEqual([]);
  });

  it.each(laterMigrations)('%s includes created_at in every unique index on a partitioned table', (file) => {
    const unique = new RegExp(`CREATE UNIQUE INDEX "[^"]+" ON "(${TABLES})"[^(]*\\(([^)]*)\\)`, 'g');
    const offending = [...sqlOf(file).matchAll(unique)]
      .filter(([, , columns]) => !columns.includes('"created_at"'))
      .map(([statement]) => statement);
    expect(offending).toEqual([]);
  });

  // The newest snapshot is what the next `migrate:create` diffs against. If it
  // describes the partitioned shape (as the transformed init snapshot does),
  // every future migration re-emits the statements above. It must describe the
  // config instead: a plain primary key on `id`.
  it('keeps the newest JSON snapshot in the shape of the Payload config', () => {
    const snapshots = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();
    const newest = snapshots[snapshots.length - 1];
    if (newest.endsWith('_init.json')) return;

    const json = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, newest), 'utf8'));
    for (const table of PARTITIONED) {
      const t = json.tables[`public.${table}`];
      expect(t, `${newest}: public.${table}`).toBeDefined();
      expect(t.columns.id.primaryKey, `${newest}: ${table}.id`).toBe(true);
      expect(Object.keys(t.compositePrimaryKeys ?? {}), `${newest}: ${table} composite PK`).toEqual([]);
    }
  });
});
