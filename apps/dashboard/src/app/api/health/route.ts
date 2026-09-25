import configPromise from '@payload-config';
import { NextResponse } from 'next/server';
import { getPayload } from 'payload';

/**
 * Deep health check endpoint.
 * Verifies that the application can connect to PostgreSQL (via Payload)
 * and returns a structured status response.
 *
 * Uses Payload Local API which bypasses access control by default.
 *
 * Used by: Docker healthcheck, CI/CD deploy pipeline.
 */
export async function GET() {
  const checks: Record<string, 'ok' | 'error'> = {};

  try {
    const payload = await getPayload({ config: configPromise });
    // Race DB ping against a 5s timeout to prevent hanging during cold start
    await Promise.race([
      payload.db.drizzle.execute('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout')), 5000)),
    ]);
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  try {
    const { redis, redisApi } = await import('@/lib/redis');
    const [pongUi, pongApi] = await Promise.all([
      Promise.race([
        redis.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('redis ui timeout')), 5000)),
      ]).catch(() => 'error'),
      Promise.race([
        redisApi.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('redis api timeout')), 5000)),
      ]).catch(() => 'error'),
    ]);

    checks.redisUi = pongUi === 'PONG' ? 'ok' : 'error';
    checks.redisApi = pongApi === 'PONG' ? 'ok' : 'error';
  } catch {
    checks.redisUi = 'error';
    checks.redisApi = 'error';
  }

  const allOk = checks.database === 'ok' && checks.redisApi === 'ok' && checks.redisUi === 'ok';

  return NextResponse.json({ status: allOk ? 'healthy' : 'degraded', checks }, { status: allOk ? 200 : 503 });
}
