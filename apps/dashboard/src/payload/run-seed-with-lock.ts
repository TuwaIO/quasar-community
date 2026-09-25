import { sql } from 'drizzle-orm';
import { getPayload, Payload } from 'payload';

import configPromise from '../payload.config';

const SEED_LOCK_ID = 88429184; // Unique 32-bit advisory lock key for Quasar seed

/**
 * Shared Payload init + distributed Postgres advisory lock + seed execution.
 * Extracted from seed-runner.ts so that seed-runner.community.ts can run a
 * different seed function through the exact same safe execution path,
 * without duplicating the init/lock logic.
 */
export async function runSeedWithLock(seedFn: (payload: Payload) => Promise<void>): Promise<void> {
  console.log('[SeedRunner] Initializing Payload instance for seed execution...');
  let payload: any;

  try {
    payload = await getPayload({ config: configPromise });
  } catch (initErr) {
    console.error('[SeedRunner] FATAL: Failed to initialize Payload CMS:', initErr);
    process.exit(1);
  }

  let lockAcquired = false;

  try {
    console.log('[SeedRunner] Attempting to acquire distributed PostgreSQL advisory lock...');
    const result: any = await payload.db.drizzle.execute(
      sql`SELECT pg_try_advisory_lock(${sql.raw(String(SEED_LOCK_ID))}) AS acquired`,
    );

    const rows = result.rows || result;
    const acquired = rows?.[0]?.acquired === true || rows?.[0]?.acquired === 't' || rows?.[0]?.acquired === 1;

    if (!acquired) {
      console.log(
        '[SeedRunner] Notice: Another seed process is currently running or holding the lock. Exiting cleanly without error.',
      );
      process.exit(0);
    }

    lockAcquired = true;
    console.log('[SeedRunner] Advisory lock acquired successfully. Executing seed...');

    await seedFn(payload);

    console.log('[SeedRunner] Seed completed successfully.');
  } catch (error) {
    console.error('[SeedRunner] ERROR: Seed execution failed:', error);
    process.exitCode = 1;
  } finally {
    if (lockAcquired && payload?.db?.drizzle) {
      try {
        console.log('[SeedRunner] Releasing distributed advisory lock...');
        await payload.db.drizzle.execute(sql`SELECT pg_advisory_unlock(${sql.raw(String(SEED_LOCK_ID))})`);
        console.log('[SeedRunner] Advisory lock released.');
      } catch (unlockErr) {
        console.error('[SeedRunner] WARNING: Failed to release advisory lock cleanly:', unlockErr);
      }
    }
  }

  process.exit(process.exitCode || 0);
}
