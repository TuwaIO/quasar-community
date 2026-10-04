// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

/**
 * Payload gives every relationship column `ON DELETE set null`, and a required
 * relationship a `NOT NULL` as well. Postgres cannot satisfy both: deleting the
 * parent tries to write NULL into the child and fails. The collection hooks
 * delete the children first, which works for rows only the dashboard writes.
 *
 * `webhook_deliveries` is written by the engine while the dashboard deletes an
 * endpoint, so a delivery recorded between the hook and the endpoint's own
 * DELETE made the deletion fail. Its foreign key cascades instead, in SQL that
 * Payload cannot express in the config. A squash regenerates the init
 * migration with `set null`; scripts/transform-init-migration.ts puts the
 * cascade back, and this check fails if neither the init nor a later migration
 * does.
 */

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

// One literal pattern per key: the community Semgrep ruleset blocks RegExps built from variables
const CASCADES = [
  {
    name: 'webhook_deliveries_endpoint_id_webhook_endpoints_id_fk',
    statement: /ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY [^;]*/g,
  },
];

const migrationFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
  .sort();

/** The `up` SQL of a migration without comments: `down` restores the old action. */
function upSqlOf(file: string): string {
  const source = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const down = source.indexOf('export async function down');
  return (down === -1 ? source : source.slice(0, down))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/--.*$/gm, '');
}

describe('foreign keys that cascade outside the Payload config', () => {
  it.each(CASCADES)(
    '$name is created with ON DELETE cascade by the newest migration that creates it',
    ({ name, statement }) => {
      const created = migrationFiles.flatMap((file) =>
        [...upSqlOf(file).matchAll(statement)].map(([sql]) => ({ file, sql })),
      );

      expect(created.length, `no migration creates ${name}`).toBeGreaterThan(0);
      const newest = created[created.length - 1];
      expect(newest.sql, newest.file).toMatch(/ON DELETE cascade/i);
    },
  );
});
